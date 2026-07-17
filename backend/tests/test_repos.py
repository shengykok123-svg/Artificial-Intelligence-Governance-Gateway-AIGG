"""One suite, both implementations, identical behaviour asserted.

If a test here passes on memory and fails on postgres, the abstraction has a
hole in it and some module upstream is going to fall through that hole on
day four. That is what this file is for.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.repo.base import AuditRecord, RuleRow, TokenEntry, UserRow
from tests.conftest import seed_rules, seed_users

NOW = datetime(2026, 7, 17, 9, 0, tzinfo=timezone.utc)


def rec(**kw) -> AuditRecord:
    base = dict(
        log_id="", user_id="siti.finance@acme.my", ts=NOW,
        target_host="chatgpt.com", prompt_text="IC 880412-08-5561",
        filename=None, data_classes=["MYKAD"], decision="redact",
        reason="MYKAD to a public AI tool.", status="auto",
        reviewer=None, reviewed_at=None, remark=None, map_id="m-1",
        user_department="finance", content_department="finance",
        department_confidence=0.81,
    )
    base.update(kw)
    return AuditRecord(**base)


# --------------------------------------------------------------------------
# AuditRepo
# --------------------------------------------------------------------------

def test_create_assigns_a_log_id_when_blank(repos):
    log_id = repos.audit.create(rec())
    assert log_id
    assert repos.audit.get(log_id) is not None


def test_create_honours_a_supplied_log_id(repos):
    assert repos.audit.create(rec(log_id="fixed-1")) == "fixed-1"


def test_round_trip_preserves_every_field(repos):
    log_id = repos.audit.create(rec(
        log_id="rt-1", filename="payroll.xlsx",
        data_classes=["MYKAD", "SALARY"], decision="hold", status="pending",
        content_department="hr", department_confidence=0.66,
    ))
    got = repos.audit.get(log_id)
    assert got.user_id == "siti.finance@acme.my"
    assert got.filename == "payroll.xlsx"
    assert sorted(got.data_classes) == ["MYKAD", "SALARY"]
    assert got.decision == "hold"
    assert got.status == "pending"
    assert got.map_id == "m-1"
    # user finance, content hr -- the column worth looking at.
    assert got.user_department == "finance"
    assert got.content_department == "hr"
    assert got.department_confidence == pytest.approx(0.66)


def test_get_unknown_returns_none(repos):
    assert repos.audit.get("does-not-exist") is None


def test_data_classes_are_deduplicated(repos):
    # SD-3: the composite PK on audit_data_classes means the same class
    # cannot land twice. Memory must agree, or postgres blows up in week two.
    log_id = repos.audit.create(rec(data_classes=["MYKAD", "MYKAD", "EMAIL"]))
    assert sorted(repos.audit.get(log_id).data_classes) == ["EMAIL", "MYKAD"]


def test_empty_data_classes_round_trip(repos):
    log_id = repos.audit.create(rec(data_classes=[], decision="allow"))
    assert repos.audit.get(log_id).data_classes == []


def test_list_is_newest_first_and_paginates(repos):
    for i in range(5):
        repos.audit.create(rec(log_id=f"p-{i}", ts=NOW - timedelta(hours=i)))
    page, total = repos.audit.list(limit=2, offset=0)
    assert total == 5
    assert [r.log_id for r in page] == ["p-0", "p-1"]

    page, total = repos.audit.list(limit=2, offset=4)
    assert total == 5           # total ignores limit/offset, M6 pages on it
    assert [r.log_id for r in page] == ["p-4"]


def test_list_filters(repos):
    repos.audit.create(rec(log_id="a", decision="allow", status="auto"))
    repos.audit.create(rec(log_id="h", decision="hold", status="pending"))
    repos.audit.create(rec(log_id="d", decision="deny", status="auto"))

    page, total = repos.audit.list(limit=50, offset=0, status="pending")
    assert total == 1 and page[0].log_id == "h"

    page, total = repos.audit.list(limit=50, offset=0, decision="allow")
    assert total == 1 and page[0].log_id == "a"

    _, total = repos.audit.list(limit=50, offset=0,
                                status="auto", decision="deny")
    assert total == 1


# --------------------------------------------------------------------------
# AuditRepo.list -- cross_department_only (M6's cross-department view)
# --------------------------------------------------------------------------

def test_cross_department_only_returns_only_matching_rows(repos):
    repos.audit.create(rec(log_id="same", user_department="finance",
                           content_department="finance",
                           department_confidence=0.95))
    repos.audit.create(rec(log_id="cross", user_department="finance",
                           content_department="hr",
                           department_confidence=0.61))
    # Boundary: exactly 0.6 is NOT cross-department -- pinned per the
    # contract in app/repo/base.py, not left to whatever the seed happens
    # to produce.
    repos.audit.create(rec(log_id="boundary", user_department="finance",
                           content_department="hr",
                           department_confidence=0.6))
    repos.audit.create(rec(log_id="no-content-dept", user_department="finance",
                           content_department=None,
                           department_confidence=0.9))
    repos.audit.create(rec(log_id="no-user-dept", user_department=None,
                           content_department="hr",
                           department_confidence=0.9))

    page, total = repos.audit.list(limit=50, offset=0,
                                   cross_department_only=True)
    assert total == 1
    assert [r.log_id for r in page] == ["cross"]


def test_cross_department_only_composes_with_decision_filter(repos):
    repos.audit.create(rec(log_id="cross-hold", decision="hold",
                           user_department="finance",
                           content_department="hr",
                           department_confidence=0.9))
    repos.audit.create(rec(log_id="cross-allow", decision="allow",
                           user_department="finance",
                           content_department="hr",
                           department_confidence=0.9))
    repos.audit.create(rec(log_id="same-hold", decision="hold",
                           user_department="finance",
                           content_department="finance",
                           department_confidence=0.9))

    page, total = repos.audit.list(limit=50, offset=0,
                                   cross_department_only=True, decision="hold")
    assert total == 1
    assert [r.log_id for r in page] == ["cross-hold"]


def test_cross_department_only_false_is_unchanged(repos):
    repos.audit.create(rec(log_id="same", user_department="finance",
                           content_department="finance"))
    repos.audit.create(rec(log_id="cross", user_department="finance",
                           content_department="hr",
                           department_confidence=0.9))

    _, implicit_total = repos.audit.list(limit=50, offset=0)
    _, explicit_total = repos.audit.list(limit=50, offset=0,
                                         cross_department_only=False)
    assert implicit_total == explicit_total == 2


def test_cross_department_only_total_reflects_filter_not_page_size(repos):
    # The bug this whole change exists to prevent: a client-side toggle over
    # one page filters the PAGE, not the LOG. total has to prove it didn't --
    # 1 of 3 mismatches on a 20-row page looks completely correct and is not.
    for i in range(5):
        repos.audit.create(rec(log_id=f"cross-{i}", user_department="finance",
                               content_department="hr",
                               department_confidence=0.9))
    for i in range(25):
        repos.audit.create(rec(log_id=f"same-{i}", user_department="finance",
                               content_department="finance"))

    page, total = repos.audit.list(limit=2, offset=0,
                                   cross_department_only=True)
    assert total == 5             # not 30, and not 2
    assert len(page) == 2


def test_cross_department_only_against_real_seed_data(repos):
    # Assert against what the seed really produces, not a number copied out
    # of a prompt: recompute the predicate independently and compare.
    from app.seed import _audit_rows

    for row in _audit_rows():
        repos.audit.create(row)

    def is_cross_department(r) -> bool:
        return (
            r.content_department is not None
            and r.user_department is not None
            and r.content_department != r.user_department
            and r.department_confidence > 0.6
        )

    everything, everything_total = repos.audit.list(limit=1000, offset=0)
    assert everything_total == 30
    expected_ids = {r.log_id for r in everything if is_cross_department(r)}
    assert expected_ids   # the seed plants mismatches on purpose -- not empty

    filtered, filtered_total = repos.audit.list(limit=1000, offset=0,
                                                 cross_department_only=True)
    assert filtered_total == len(expected_ids)
    assert {r.log_id for r in filtered} == expected_ids
    assert all(is_cross_department(r) for r in filtered)


def test_set_decision_approve(repos):
    repos.audit.create(rec(log_id="q-1", decision="hold", status="pending"))
    out = repos.audit.set_decision("q-1", approve=True,
                                   reviewer="admin@acme.my", remark="ok")
    assert out.status == "approved"
    assert out.reviewer == "admin@acme.my"
    assert out.remark == "ok"
    assert out.reviewed_at is not None
    # The verdict is a historical fact. Only the review outcome moves.
    assert out.decision == "hold"
    assert repos.audit.get("q-1").status == "approved"


def test_set_decision_deny(repos):
    repos.audit.create(rec(log_id="q-2", decision="hold", status="pending"))
    out = repos.audit.set_decision("q-2", approve=False,
                                   reviewer="admin@acme.my", remark="no")
    assert out.status == "denied"


def test_set_decision_unknown_raises(repos):
    with pytest.raises(KeyError):
        repos.audit.set_decision("nope", approve=True, reviewer="a", remark="")


def test_mutating_a_returned_record_does_not_touch_storage(repos):
    # Memory hands out objects; postgres hands out fresh DTOs. If memory
    # leaks a reference, M1 mutates the "database" by accident and the two
    # backends stop agreeing.
    repos.audit.create(rec(log_id="iso-1"))
    got = repos.audit.get("iso-1")
    got.decision = "deny"
    got.data_classes.append("SECRET")
    assert repos.audit.get("iso-1").decision == "redact"
    assert repos.audit.get("iso-1").data_classes == ["MYKAD"]


# --------------------------------------------------------------------------
# stats -- M6 polls this every 3 seconds
# --------------------------------------------------------------------------

def test_stats_by_decision(repos):
    for d in ["allow", "allow", "redact", "hold", "deny"]:
        repos.audit.create(rec(decision=d))
    assert repos.audit.stats().by_decision == {
        "allow": 2, "redact": 1, "hold": 1, "deny": 1,
    }


def test_stats_by_day(repos):
    repos.audit.create(rec(decision="allow", ts=NOW))
    repos.audit.create(rec(decision="allow", ts=NOW - timedelta(hours=2)))
    repos.audit.create(rec(decision="deny", ts=NOW - timedelta(days=1)))
    assert repos.audit.stats().by_day == [
        ("2026-07-16", "deny", 1),
        ("2026-07-17", "allow", 2),
    ]


def test_stats_top_data_classes_counts_prompts_not_rows(repos):
    repos.audit.create(rec(data_classes=["MYKAD", "EMAIL"]))
    repos.audit.create(rec(data_classes=["MYKAD"]))
    repos.audit.create(rec(data_classes=["MYKAD", "SALARY"]))
    assert repos.audit.stats().top_data_classes == [
        ("MYKAD", 3), ("EMAIL", 1), ("SALARY", 1),  # count desc, then key asc
    ]


def test_stats_top_users_counts_risk_events_only(repos):
    repos.audit.create(rec(user_id="wei.eng@acme.my", decision="deny"))
    repos.audit.create(rec(user_id="wei.eng@acme.my", decision="redact"))
    repos.audit.create(rec(user_id="aiman.hr@acme.my", decision="hold"))
    # Fifty clean prompts should not make somebody the riskiest person here.
    for _ in range(50):
        repos.audit.create(rec(user_id="siti.finance@acme.my",
                               decision="allow", data_classes=[]))
    assert repos.audit.stats().top_users == [
        ("wei.eng@acme.my", 2), ("aiman.hr@acme.my", 1),
    ]


def test_stats_on_an_empty_database(repos):
    s = repos.audit.stats()
    assert s.by_decision == {} and s.by_day == []
    assert s.top_data_classes == [] and s.top_users == []


# --------------------------------------------------------------------------
# VaultRepo
# --------------------------------------------------------------------------

def test_vault_round_trip(repos):
    entries = [TokenEntry("[MYKAD_1]", b"\x01\x02cipher"),
               TokenEntry("[PERSON_1]", b"\xff\x00bytes")]
    repos.vault.put_map("map-1", entries)
    got = {e.token: e.ciphertext for e in repos.vault.get_map("map-1")}
    assert got == {"[MYKAD_1]": b"\x01\x02cipher",
                   "[PERSON_1]": b"\xff\x00bytes"}


def test_vault_unknown_map_is_empty_not_an_error(repos):
    assert repos.vault.get_map("never-written") == []


def test_vault_put_map_replaces(repos):
    repos.vault.put_map("map-2", [TokenEntry("[A_1]", b"old")])
    repos.vault.put_map("map-2", [TokenEntry("[B_1]", b"new")])
    assert [e.token for e in repos.vault.get_map("map-2")] == ["[B_1]"]


def test_vault_maps_are_isolated(repos):
    repos.vault.put_map("m1", [TokenEntry("[A_1]", b"a")])
    repos.vault.put_map("m2", [TokenEntry("[B_1]", b"b")])
    assert len(repos.vault.get_map("m1")) == 1
    assert len(repos.vault.get_map("m2")) == 1


# --------------------------------------------------------------------------
# RuleRepo
# --------------------------------------------------------------------------

def test_rules_round_trip(repos):
    rows = [
        RuleRow("MYKAD", "PUBLIC_AI", "*", "*", "redact"),
        RuleRow("SECRET", "PUBLIC_AI", "*", "*", "deny"),
    ]
    seed_rules(repos, rows)
    got = repos.rules.all()
    assert len(got) == 2
    assert got[0] == RuleRow("MYKAD", "PUBLIC_AI", "*", "*", "redact")


def test_rules_empty(repos):
    assert repos.rules.all() == []


def test_rules_yaml_seeds_the_table(repos):
    # rules.yaml is seed data: this is the one path that reads it. M3 never
    # does. Changing a rule is a row edit, not a redeploy.
    from app.seed import load_rules_yaml
    rows = load_rules_yaml()
    assert len(rows) == 15
    seed_rules(repos, rows)
    assert len(repos.rules.all()) == 15
    assert any(r.data_class == "SECRET" and r.decision == "deny"
               for r in repos.rules.all())


# --------------------------------------------------------------------------
# ToolRepo -- the shadow AI story
# --------------------------------------------------------------------------

def test_register_unknown_host_is_public_and_unapproved(repos):
    tool = repos.tools.register("claude.ai")
    assert tool.host == "claude.ai"
    assert tool.tier == "PUBLIC_AI"
    assert tool.status == "unapproved"
    assert tool.approved_by is None
    # Nobody configured anything in advance; it is in the registry now.
    assert repos.tools.by_host("claude.ai") is not None


def test_register_is_idempotent_and_does_not_reset_approval(repos):
    repos.tools.register("chatgpt.com")
    repos.tools._set_status("chatgpt.com", "approved", "admin@acme.my")
    again = repos.tools.register("chatgpt.com")
    assert again.status == "approved"
    assert again.approved_by == "admin@acme.my"


def test_register_unknown_host_sets_first_seen_to_roughly_now(repos):
    before = datetime.now(timezone.utc)
    tool = repos.tools.register("brand-new.ai")
    after = datetime.now(timezone.utc)
    assert before <= tool.first_seen <= after


def test_register_known_host_does_not_move_first_seen(repos):
    first = repos.tools.register("chatgpt.com")
    # register() happens on every single prompt to a known host -- if this
    # moved, the column would mean "last seen", not "first seen".
    again = repos.tools.register("chatgpt.com")
    assert again.first_seen == first.first_seen

    repos.tools._set_status("chatgpt.com", "approved", "admin@acme.my")
    approved = repos.tools.by_host("chatgpt.com")
    assert approved.first_seen == first.first_seen


def test_by_host_unknown_returns_none(repos):
    assert repos.tools.by_host("nothing.example") is None


def test_all_sorts_shadow_ai_to_the_top(repos):
    repos.tools.register("chatgpt.com")
    repos.tools._set_status("chatgpt.com", "approved", "admin@acme.my")
    repos.tools.register("zzz-unknown.ai")
    repos.tools.register("blocked.ai")
    repos.tools._set_status("blocked.ai", "blocked", "admin@acme.my")

    assert [t.host for t in repos.tools.all()] == [
        "blocked.ai", "zzz-unknown.ai", "chatgpt.com",
    ]


def test_set_status_records_who_and_when(repos):
    repos.tools.register("copilot.microsoft.com")
    out = repos.tools._set_status("copilot.microsoft.com", "approved",
                                  "admin@acme.my")
    assert out.status == "approved"
    assert out.approved_by == "admin@acme.my"
    assert out.approved_at is not None


# --------------------------------------------------------------------------
# UserRepo -- SD-2. M1 keys role and department off user_id, never a header.
# --------------------------------------------------------------------------

def test_user_by_id_round_trip(repos):
    seed_users(repos, [
        UserRow("admin@acme.my", "admin", "legal"),
        UserRow("wei.eng@acme.my", "staff", "engineering"),
    ])
    got = repos.users.by_id("wei.eng@acme.my")
    assert got == UserRow("wei.eng@acme.my", "staff", "engineering")
    assert repos.users.by_id("admin@acme.my").role == "admin"


def test_user_by_id_unknown_returns_none(repos):
    # M1 decides what an unknown user means. This layer does not.
    assert repos.users.by_id("ghost@acme.my") is None


def test_user_by_id_on_an_empty_table(repos):
    assert repos.users.by_id("anyone@acme.my") is None


def test_mutating_a_returned_user_does_not_touch_storage(repos):
    seed_users(repos, [UserRow("siti.finance@acme.my", "staff", "finance")])
    got = repos.users.by_id("siti.finance@acme.my")
    got.role = "admin"          # a self-issued permission, if this stuck
    assert repos.users.by_id("siti.finance@acme.my").role == "staff"


def test_seeded_users_are_reachable_through_the_repo(repos):
    from app.seed import USERS
    seed_users(repos, [UserRow(u, r, d) for u, r, d in USERS])
    # The four seeded users are exactly what M1 will resolve against.
    assert repos.users.by_id("admin@acme.my").role == "admin"
    assert repos.users.by_id("aiman.hr@acme.my").department == "hr"
    assert repos.users.by_id("wei.eng@acme.my").department == "engineering"
