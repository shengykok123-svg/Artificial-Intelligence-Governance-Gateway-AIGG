# M1  FastAPI app and routers. Consumes IF-9 (audit, vault, rules, tools, users). Produces IF-2, IF-3, IF-7, IF-10.

from __future__ import annotations

import os
import sys
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any, Callable

from dotenv import load_dotenv
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.detect.base import Classification, Detector, DocumentClassifier, Document, Span
from app.errors import Forbidden
from app.extract.files import UnsupportedFile
from app.policy.engine import PolicyContext, Verdict
from app.repo import Repos, get_repos
from app.repo.base import AuditRecord
from app.schemas import InspectRequest, InspectResponse

load_dotenv()

ENV = os.getenv("ENV", "dev")
API_KEY = os.getenv("API_KEY", "dev-key-change-me")
MOCK_MODULES: set[str] = {
    m.strip() for m in os.getenv("MOCK_MODULES", "M2,M3,M5,M7,M8").split(",")
    if m.strip()
}

# The default admin identity behind the dashboard's hardcoded login. Neither
# POST /v1/logs/{id}/decision nor POST /v1/tools/{host}/decision carries a
# reviewer/actor field on the wire (see schemas.py) -- there is exactly one
# login, and this is it. A real IdP-backed identity is future work.
DASHBOARD_ADMIN = "admin@acme.my"


def _check_demo_guard(env: str, mock_modules: set[str]) -> None:
    """A demo video recorded against mock detection would show redaction
    that never happened. That is not a bug, it is a false claim about the
    product -- refuse to start rather than let it happen by accident."""
    if env == "demo" and mock_modules:
        raise RuntimeError(
            f"ENV=demo refuses to start with MOCK_MODULES={sorted(mock_modules)} "
            "still active. Remove every landed module from MOCK_MODULES "
            "before recording a demo."
        )


_check_demo_guard(ENV, MOCK_MODULES)

print(
    f"[startup] ENV={ENV} MOCK_MODULES={sorted(MOCK_MODULES) or ['none']}",
    file=sys.stderr,
)


# --------------------------------------------------------------------------
# Loaders. Each reads MOCK_MODULES exactly once per call. This is the seam:
# when a module lands, its owner removes the ID here and the mock import
# disappears. Explicit selection, never a try/except ImportError fallback --
# a broken real module must fail loudly, not silently serve a mock.
# --------------------------------------------------------------------------


def get_rules_detector() -> Detector:
    if "M2" in MOCK_MODULES:
        from app.mocks import MockRulesDetector
        return MockRulesDetector()
    from app.detect.rules import RulesDetector
    return RulesDetector()


def get_embed_detector() -> Detector | DocumentClassifier:
    if "M8" in MOCK_MODULES:
        from app.mocks import MockEmbedDetector
        return MockEmbedDetector()
    from app.detect.embed import EmbedDetector
    return EmbedDetector()


def get_extractor() -> Callable[[str, str, str], Document]:
    if "M5" in MOCK_MODULES:
        from app.mocks import mock_extract
        return mock_extract
    from app.extract.files import extract
    return extract


def get_decider() -> Callable[[Classification, PolicyContext, list], Verdict]:
    if "M3" in MOCK_MODULES:
        from app.mocks import mock_decide
        return mock_decide
    from app.policy.engine import decide
    return decide


def get_tokeniser(vault: Any) -> Any:
    if "M7" in MOCK_MODULES:
        from app.mocks import MockTokeniser
        return MockTokeniser(vault)
    from app.vault.tokeniser import Tokeniser
    return Tokeniser(vault)


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------


def require_api_key(x_api_key: str | None = Header(None)) -> None:
    if x_api_key != API_KEY:
        raise HTTPException(status_code=403, detail="invalid API key")


app = FastAPI(title="AI Governance Gateway",
              dependencies=[Depends(require_api_key)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(UnsupportedFile)
def _unsupported_file_handler(request: Request, exc: UnsupportedFile) -> JSONResponse:
    return JSONResponse(status_code=415, content={"detail": str(exc)})


@app.exception_handler(Forbidden)
def _forbidden_handler(request: Request, exc: Forbidden) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": str(exc) or "forbidden"})


# --------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------


@app.post("/v1/inspect", response_model=InspectResponse)
def inspect(req: InspectRequest, repos: Repos = Depends(get_repos)) -> InspectResponse:
    # SD-2: role and department come from the users table, keyed by user_id.
    # Never a header -- a self-asserted role is a self-issued permission.
    user = repos.users.by_id(req.user_id)
    if user is None:
        raise Forbidden(f"unknown user_id {req.user_id!r}")

    # SD-7: an unknown host auto-registers as PUBLIC_AI/unapproved and is
    # never held on that account alone -- this is the shadow-AI story.
    tool = repos.tools.by_host(req.target_host)
    if tool is None:
        tool = repos.tools.register(req.target_host)

    extract = get_extractor()
    documents: list[Document] = [
        Document(text=req.prompt, source_filename=None, mime="text/plain")
    ]
    for att in req.attachments:
        documents.append(extract(att.filename, att.mime, att.content_b64))

    rules_detector = get_rules_detector()
    embed_detector = get_embed_detector()

    # Span.start/end are offsets into ONE Document's text. The prompt's own
    # spans are what get redacted back into the response (redacted_prompt is
    # a single field, and so is AuditRecord.prompt_text); attachment spans
    # still count toward the verdict via data_classes, but are never used to
    # slice the prompt string.
    prompt_doc = documents[0]
    prompt_spans = rules_detector.detect(prompt_doc) + embed_detector.detect(prompt_doc)

    all_spans: list[Span] = list(prompt_spans)
    for doc in documents[1:]:
        all_spans += rules_detector.detect(doc) + embed_detector.detect(doc)

    data_classes = sorted({span.data_class for span in all_spans})
    confidence = max((s.confidence for s in all_spans), default=0.0)

    combined_text = "\n".join(doc.text for doc in documents)
    content_department, department_confidence = embed_detector.classify(
        Document(text=combined_text, source_filename=None, mime="text/plain")
    )

    classification = Classification(
        data_classes=data_classes,
        confidence=confidence,
        spans=prompt_spans,
        content_department=content_department,
        department_confidence=department_confidence,
    )

    ctx = PolicyContext(
        user_role=user.role,
        department=user.department,
        ai_tool_tier=tool.tier,
        tool_status=tool.status,
        purpose=req.purpose,
        target_host=req.target_host,
    )

    decide = get_decider()
    verdict = decide(classification, ctx, repos.rules.all())

    redacted_prompt: str | None = None
    map_id: str | None = None
    prompt_text_for_audit = req.prompt

    if verdict.decision == "redact":
        tokeniser = get_tokeniser(repos.vault)
        redacted_prompt, map_id = tokeniser.tokenise(req.prompt, verdict.spans_to_redact)
        # SD-1: the audit row holds the REDACTED text; the original lives
        # only in the vault.
        prompt_text_for_audit = redacted_prompt

    status = "pending" if verdict.decision == "hold" else "auto"

    log_id = repos.audit.create(AuditRecord(
        log_id="",
        user_id=req.user_id,
        ts=datetime.now(timezone.utc),
        target_host=req.target_host,
        prompt_text=prompt_text_for_audit,
        filename=req.attachments[0].filename if req.attachments else None,
        data_classes=list(data_classes),
        decision=verdict.decision,
        reason=verdict.reason,
        status=status,
        reviewer=None,
        reviewed_at=None,
        remark=None,
        map_id=map_id,
        user_department=user.department,
        content_department=content_department,
        department_confidence=department_confidence,
    ))

    return InspectResponse(
        decision=verdict.decision,       # type: ignore[arg-type]
        log_id=log_id,
        data_classes=list(data_classes),
        redacted_prompt=redacted_prompt,
        reason=verdict.reason,
    )


# --------------------------------------------------------------------------
# Audit / approval loop
# --------------------------------------------------------------------------


@app.get("/v1/inspect/{log_id}")
def get_inspect_status(log_id: str, repos: Repos = Depends(get_repos)) -> dict:
    rec = repos.audit.get(log_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="unknown log_id")
    return {"decision": rec.decision, "status": rec.status}


@app.get("/v1/logs")
def list_logs(
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    decision: str | None = None,
    repos: Repos = Depends(get_repos),
) -> dict:
    rows, total = repos.audit.list(limit=limit, offset=offset,
                                   status=status, decision=decision)
    return {"items": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/v1/logs/{log_id}/decision")
def decide_log(
    log_id: str,
    approve: bool = Body(...),
    remark: str = Body(...),
    repos: Repos = Depends(get_repos),
) -> AuditRecord:
    try:
        return repos.audit.set_decision(
            log_id, approve=approve, reviewer=DASHBOARD_ADMIN, remark=remark,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown log_id")


@app.get("/v1/stats")
def stats(repos: Repos = Depends(get_repos)):
    return repos.audit.stats()


# --------------------------------------------------------------------------
# Policy and tools (IF-10)
# --------------------------------------------------------------------------


@app.get("/v1/rules")
def list_rules(repos: Repos = Depends(get_repos)):
    return repos.rules.all()


@app.get("/v1/tools")
def list_tools(repos: Repos = Depends(get_repos)) -> list[dict]:
    # TODO(team decision): no repo method returns a usage count. Stopgap --
    # page repos.audit.list() and count target_host in Python. At 30 seed
    # rows this is free; it will not be at 30,000.
    all_rows, _total = repos.audit.list(limit=10_000, offset=0)
    usage = Counter(row.target_host for row in all_rows)
    return [
        {**asdict(tool), "usage_count": usage.get(tool.host, 0)}
        for tool in repos.tools.all()
    ]


@app.post("/v1/tools/{host}/decision")
def decide_tool(
    host: str,
    status: str = Body(...),
    remark: str = Body(...),
    repos: Repos = Depends(get_repos),
):
    if repos.tools.by_host(host) is None:
        raise HTTPException(status_code=404, detail="unknown host")
    # _set_status is not on the ToolRepo protocol yet -- see the note in
    # app/repo/memory.py. Both backends implement it; M1 wires it here until
    # the team promotes it to IF-9. AiTool has no remark column (open
    # question, see docs/prompts/M1.md notes) -- accepted on the wire,
    # nowhere to persist it yet.
    del remark
    return repos.tools._set_status(host, status, DASHBOARD_ADMIN)  # type: ignore[attr-defined]


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------


@app.get("/v1/health")
def health() -> dict:
    return {"status": "ok", "mocked": sorted(MOCK_MODULES)}
