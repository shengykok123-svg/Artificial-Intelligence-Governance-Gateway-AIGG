"""M1 pipeline tests: one per verdict, the hold->approve->unblock loop, the
error mappings, SD-1, and the ENV=demo guard. Tests run with the configured
local module frame and REPO_BACKEND=memory -- no Docker.
"""

from __future__ import annotations

import base64
import io

import pytest
from docx import Document as DocxDocument
from fastapi.testclient import TestClient

from app.main import API_KEY, _check_demo_guard, app
from app.repo import reset_memory_repos

HEADERS = {"X-Api-Key": API_KEY}


@pytest.fixture(autouse=True)
def _fresh_repos():
    """The memory backend is a process-wide singleton (state has to survive
    between requests) -- reset it around every test so they cannot see each
    other's audit rows."""
    reset_memory_repos()
    yield
    reset_memory_repos()


@pytest.fixture
def client():
    return TestClient(app)


def inspect(client: TestClient, **overrides):
    body = {
        "user_id": "wei.eng@acme.my",
        "target_host": "chatgpt.com",
        "prompt": "hello",
        **overrides,
    }
    return client.post("/v1/inspect", headers=HEADERS, json=body)


# --------------------------------------------------------------------------
# One test per verdict
# --------------------------------------------------------------------------


def test_allow(client: TestClient) -> None:
    r = inspect(client, prompt="Turn this into bullet points for the standup.")
    assert r.status_code == 200
    body = r.json()
    assert body["decision"] == "allow"
    assert body["redacted_prompt"] is None
    assert body["redacted_attachments"] == []
    assert body["data_classes"] == []

    logs = client.get("/v1/logs", headers=HEADERS, params={"limit": 200}).json()
    assert any(x["log_id"] == body["log_id"] for x in logs["items"])


def test_deny(client: TestClient) -> None:
    r = inspect(client,
                prompt="Debug this: OPENAI_API_KEY=sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d")
    body = r.json()
    assert body["decision"] == "deny"
    assert "SECRET" in body["data_classes"]
    assert "SECRET" in body["reason"]


def test_redact(client: TestClient) -> None:
    r = inspect(
        client, user_id="aiman.hr@acme.my",
        prompt="Summarise this employee grievance from Encik Rahman, "
               "IC 880412-08-5561.",
    )
    body = r.json()
    assert body["decision"] == "redact"
    assert "MYKAD" in body["data_classes"]
    assert body["redacted_prompt"] is not None
    assert "880412-08-5561" not in body["redacted_prompt"]
    assert "[MYKAD_1]" in body["redacted_prompt"]


def test_hold(client: TestClient) -> None:
    r = inspect(
        client, user_id="aiman.hr@acme.my",
        prompt="Draft a reply to the payroll query. "
               "Gaji bulanan RM 8,500 for grade M3.",
    )
    body = r.json()
    assert body["decision"] == "hold"
    assert "SALARY" in body["data_classes"]
    assert body["redacted_prompt"] is None


# --------------------------------------------------------------------------
# SD-1: the original value must never reach the audit row.
# --------------------------------------------------------------------------


def test_sd1_original_never_in_audit_record(client: TestClient) -> None:
    original = "880412-08-5561"
    r = inspect(
        client, user_id="aiman.hr@acme.my",
        prompt=f"Summarise this employee grievance from Encik Rahman, IC {original}.",
    )
    log_id = r.json()["log_id"]

    logs = client.get("/v1/logs", headers=HEADERS, params={"limit": 200}).json()
    row = next(x for x in logs["items"] if x["log_id"] == log_id)

    assert original not in row["prompt_text"]
    assert row["map_id"] is not None


# --------------------------------------------------------------------------
# THE loop: hold -> approve -> unblock.
# --------------------------------------------------------------------------


def test_hold_approve_unblock_loop(client: TestClient) -> None:
    r = inspect(
        client, user_id="aiman.hr@acme.my",
        prompt="Draft a reply to the payroll query. "
               "Gaji bulanan RM 8,500 for grade M3.",
    )
    body = r.json()
    log_id = body["log_id"]
    assert body["decision"] == "hold"

    status = client.get(f"/v1/inspect/{log_id}", headers=HEADERS).json()
    assert status == {"decision": "hold", "status": "pending"}

    pending = client.get("/v1/logs", headers=HEADERS,
                         params={"status": "pending", "limit": 200}).json()
    assert any(x["log_id"] == log_id for x in pending["items"])

    dec = client.post(f"/v1/logs/{log_id}/decision", headers=HEADERS,
                      json={"approve": True, "remark": "aggregate figures only"})
    assert dec.status_code == 200
    assert dec.json()["status"] == "approved"
    assert dec.json()["decision"] == "hold"   # the verdict is a historical fact

    unblocked = client.get(f"/v1/inspect/{log_id}", headers=HEADERS).json()
    assert unblocked == {"decision": "hold", "status": "approved"}


def test_hold_deny_review_sets_status_denied(client: TestClient) -> None:
    r = inspect(
        client, user_id="aiman.hr@acme.my",
        prompt="Draft a reply to the payroll query. "
               "Gaji bulanan RM 8,500 for grade M3.",
    )
    log_id = r.json()["log_id"]

    dec = client.post(f"/v1/logs/{log_id}/decision", headers=HEADERS,
                      json={"approve": False, "remark": "use the internal assistant"})
    assert dec.json()["status"] == "denied"

    status = client.get(f"/v1/inspect/{log_id}", headers=HEADERS).json()
    assert status["status"] == "denied"


# --------------------------------------------------------------------------
# Shadow AI: SD-7, auto-registered, never held on that account alone.
# --------------------------------------------------------------------------


def test_shadow_ai_registers_and_does_not_hold(client: TestClient) -> None:
    r = inspect(client, target_host="deepseek.com",
               prompt="harmless prompt about nothing sensitive")
    assert r.json()["decision"] == "allow"

    tools = client.get("/v1/tools", headers=HEADERS).json()
    row = next(t for t in tools if t["host"] == "deepseek.com")
    assert row["status"] == "unapproved"
    assert row["tier"] == "PUBLIC_AI"
    assert row["usage_count"] >= 1


def test_tools_include_first_seen(client: TestClient) -> None:
    tools = client.get("/v1/tools", headers=HEADERS).json()
    seeded = next(t for t in tools if t["host"] == "chatgpt.com")
    assert seeded["first_seen"] is not None  # rides along on asdict() for free

    inspect(client, target_host="brand-new-shadow.ai", prompt="hi")
    tools = client.get("/v1/tools", headers=HEADERS).json()
    fresh = next(t for t in tools if t["host"] == "brand-new-shadow.ai")
    assert fresh["first_seen"] is not None


# --------------------------------------------------------------------------
# cross_department_only (M6's cross-department view)
# --------------------------------------------------------------------------


def test_logs_cross_department_only_filters_and_totals_correctly(client: TestClient) -> None:
    def is_cross_department(row: dict) -> bool:
        return (
            row["content_department"] is not None
            and row["user_department"] is not None
            and row["content_department"] != row["user_department"]
            and row["department_confidence"] > 0.6
        )

    everything = client.get("/v1/logs", headers=HEADERS, params={"limit": 200}).json()
    assert everything["total"] == 30    # the seeded set, unfiltered
    expected_ids = {r["log_id"] for r in everything["items"] if is_cross_department(r)}
    assert expected_ids   # the seed plants mismatches on purpose

    filtered = client.get("/v1/logs", headers=HEADERS,
                          params={"limit": 200, "cross_department_only": "true"}).json()
    assert filtered["total"] == len(expected_ids)
    assert {r["log_id"] for r in filtered["items"]} == expected_ids


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------


def test_unknown_user_is_403(client: TestClient) -> None:
    r = inspect(client, user_id="nobody@acme.my")
    assert r.status_code == 403


def test_unsupported_file_is_415(client: TestClient) -> None:
    r = inspect(client, prompt="see attached", attachments=[
        {"filename": "x.pdf", "mime": "application/pdf",
         "content_b64": base64.b64encode(b"whatever").decode()},
    ])
    assert r.status_code == 415


def test_unknown_log_id_is_404(client: TestClient) -> None:
    r = client.get("/v1/inspect/does-not-exist", headers=HEADERS)
    assert r.status_code == 404

    r2 = client.post("/v1/logs/does-not-exist/decision", headers=HEADERS,
                     json={"approve": True, "remark": "x"})
    assert r2.status_code == 404

    r3 = client.post("/v1/tools/does-not-exist.example/decision", headers=HEADERS,
                     json={"status": "approved", "remark": "x"})
    assert r3.status_code == 404


def test_wrong_or_missing_api_key_is_403(client: TestClient) -> None:
    assert client.get("/v1/health", headers={"X-Api-Key": "wrong"}).status_code == 403
    assert client.get("/v1/health").status_code == 403


# --------------------------------------------------------------------------
# Text extraction round-trip through the mock plane.
# --------------------------------------------------------------------------


def test_supported_attachment_contributes_to_verdict(client: TestClient) -> None:
    content = base64.b64encode(b"RM 8,500 buried in a csv cell").decode()
    r = inspect(client, user_id="aiman.hr@acme.my",
               prompt="see attached", attachments=[
                   {"filename": "note.csv", "mime": "text/csv",
                    "content_b64": content},
               ])
    body = r.json()
    assert body["decision"] == "hold"
    assert "SALARY" in body["data_classes"]


def test_docx_attachment_contributes_to_verdict(client: TestClient) -> None:
    docx = DocxDocument()
    docx.add_paragraph("Compensation note: Gaji bulanan RM 8,500.")
    buf = io.BytesIO()
    docx.save(buf)

    r = inspect(client, user_id="aiman.hr@acme.my",
                prompt="see attached", attachments=[
                    {
                        "filename": "salary.docx",
                        "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "content_b64": base64.b64encode(buf.getvalue()).decode(),
                    },
                ])

    body = r.json()
    assert body["decision"] == "hold"
    assert "SALARY" in body["data_classes"]
    assert body["redacted_attachments"] == []


def test_text_attachment_redaction_returns_redacted_copy(client: TestClient) -> None:
    original = "Employee IC 880412-08-5561 needs a reply."
    r = inspect(client, user_id="aiman.hr@acme.my",
                prompt="see attached", attachments=[
                    {
                        "filename": "employee.txt",
                        "mime": "text/plain",
                        "content_b64": base64.b64encode(original.encode()).decode(),
                    },
                ])

    body = r.json()
    assert body["decision"] == "redact"
    assert "MYKAD" in body["data_classes"]
    assert body["redacted_prompt"] == "see attached"
    assert len(body["redacted_attachments"]) == 1

    redacted = body["redacted_attachments"][0]
    assert redacted["filename"] == "employee.redacted.txt"
    assert redacted["mime"] == "text/plain"

    redacted_text = base64.b64decode(redacted["content_b64"]).decode()
    assert "880412-08-5561" not in redacted_text
    assert "[MYKAD_1]" in redacted_text

    logs = client.get("/v1/logs", headers=HEADERS, params={"limit": 200}).json()
    row = next(x for x in logs["items"] if x["log_id"] == body["log_id"])
    assert row["map_id"] is not None


# --------------------------------------------------------------------------
# ENV=demo refuses to start with an active mock.
# --------------------------------------------------------------------------


def test_demo_guard_refuses_to_start_with_active_mocks() -> None:
    with pytest.raises(RuntimeError):
        _check_demo_guard("demo", {"M2"})


def test_demo_guard_allows_demo_with_no_mocks_left() -> None:
    _check_demo_guard("demo", set())


def test_demo_guard_allows_dev_with_mocks() -> None:
    _check_demo_guard("dev", {"M2", "M3", "M5", "M7", "M8"})
