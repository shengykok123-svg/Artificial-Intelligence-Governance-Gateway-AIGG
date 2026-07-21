"""Seed data.

The point of this file is that M6 has charts with something in them on day
one, and that the mismatch filter has something to find before M8 exists.

Deterministic: a fixed random seed, so the demo looks the same every time
you reset the database and nobody has to re-record a video because the bar
chart moved.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

from app.detect.rules import DEFAULT_PATTERNS
from app.repo.base import (
    AiTool,
    AuditRecord,
    DetectionPatternRow,
    RedactionClassRow,
    RuleRow,
    UserRow,
)

RULES_YAML = Path(__file__).parent / "policy" / "rules.yaml"

# Which data classes M2 (the regex detector) redacts, out of the box. Fully
# admin-editable from the dashboard's Redaction tab after this -- see
# RedactionRepo / the REGEX FLOOR note in backend/app/policy/engine.py.
ALWAYS_REDACT_CLASSES: list[str] = [
    "MYKAD", "EMAIL", "PHONE", "BANK_ACCT", "SALARY", "API_KEY", "PERSON",
]

# Human-readable "what this one matches" text for each built-in pattern,
# shown as the Remark on the Detection Patterns screen. Keyed by the exact
# (data_class, pattern) pair so API_KEY's two patterns each get their own
# remark. Not read by RulesDetector/decide() -- admin-facing only.
DEFAULT_PATTERN_REMARKS: dict[tuple[str, str], str] = {
    DEFAULT_PATTERNS[0]: "Malaysian IC number, format YYMMDD-PB-XXXX.",
    DEFAULT_PATTERNS[1]: "Standard email address shape.",
    DEFAULT_PATTERNS[2]: "Malaysian mobile number, format 01X-XXXXXXX(X).",
    DEFAULT_PATTERNS[3]: "'Account/acct/a-c' followed by a 7-24 digit account number.",
    DEFAULT_PATTERNS[4]: "RM currency amount, e.g. RM 8,500 or RM8500.00.",
    DEFAULT_PATTERNS[5]: "OpenAI/Anthropic-style API key shape (sk-... or sk-proj-...).",
    DEFAULT_PATTERNS[6]: "Cloud provider API key set via an env-style assignment, e.g. OPENAI_API_KEY=....",
    DEFAULT_PATTERNS[7]: "Honorific (Encik/Puan/Mr/Mrs/Ms/Dr) followed by a 1-3 word name.",
}


def load_rules_yaml() -> list[RuleRow]:
    """rules.yaml is SEED DATA. This function is the only thing that ever
    reads it. M3 reads the table."""
    data = yaml.safe_load(RULES_YAML.read_text())
    return [
        RuleRow(
            data_class=r["data_class"],
            ai_tool_tier=r["ai_tool_tier"],
            user_role=str(r["user_role"]),
            purpose=str(r["purpose"]),
            decision=r["decision"],
            min_confidence=float(r.get("min_confidence", 0.0)),
            content_department=str(r.get("content_department", "*")),
            require_purpose=bool(r.get("require_purpose", False)),
            detector=str(r.get("detector", "*")),
        )
        for r in data["rules"]
    ]


# SD-2: users is the source of truth for role and department.
USERS: list[tuple[str, str, str]] = [
    # (id, role, department)
    ("admin@acme.my", "admin", "legal"),
    ("siti.finance@acme.my", "staff", "finance"),
    ("aiman.hr@acme.my", "staff", "hr"),
    ("wei.eng@acme.my", "staff", "engineering"),
]

# The three tools we know about. Everything else arrives via register().
TOOLS: list[tuple[str, str, str]] = [
    ("chatgpt.com", "PUBLIC_AI", "approved"),
    ("gemini.google.com", "PUBLIC_AI", "approved"),
    ("copilot.microsoft.com", "PUBLIC_AI", "unapproved"),
]

STAFF_BY_DEPT = {dept: uid for uid, role, dept in USERS if role == "staff"}
_STAFF_IDS = list(STAFF_BY_DEPT.values())

# content_department is what the prompt is ABOUT (M8's job). It drives which
# user sends it, so that a mismatch is something we placed on purpose rather
# than an artefact of round-robining users against scenarios. Only the three
# departments that have a staff user appear here; "legal" is the admin, and
# giving legal content to a non-legal user would make every such row a
# mismatch by accident.
#
# (prompt, filename, data_classes, decision, reason, content_department)
_SCENARIOS: list[tuple[str, str | None, list[str], str, str, str | None]] = [
    ("Summarise this employee grievance from Encik Rahman, IC 880412-08-5561.",
     None, ["MYKAD", "PERSON"], "redact",
     "MYKAD to a public AI tool: values tokenised before send.", "hr"),
    ("Draft a reply to the payroll query. Gaji bulanan RM 8,500 for grade M3.",
     None, ["SALARY"], "deny",
     "SALARY to a public AI tool: blocked by policy.", "hr"),
    ("Debug this: OPENAI_API_KEY=sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d",
     None, ["API_KEY"], "deny",
     "Credential detected. Prompt blocked at the browser.", "engineering"),
    # content_department None: M8 returns (None, 0.0) below 0.40 rather than
    # guessing, and M6 renders that as an em dash. Seed the empty case too --
    # a demo where every row is confidently classified is a demo that lies.
    ("Rewrite this paragraph to be more concise, no client names in it.",
     None, [], "allow", "No sensitive data class detected.", None),
    ("Reconcile these vendor payments, Maybank account 5142 8890 3312.",
     "vendor_payments_q2.xlsx", ["BANK_ACCT"], "deny",
     "BANK_ACCT to a public AI tool: blocked by policy.",
     "finance"),
    ("Turn this into bullet points for the standup.",
     None, [], "allow", "No sensitive data class detected.", "engineering"),
    ("Draft the termination letter for Puan Nurul, contact 012-3456789.",
     "draft_letter.docx", ["PERSON", "PHONE"], "redact",
     "Personal data to a public AI tool: values tokenised before send.",
     "hr"),
    ("Our Q3 revenue dipped 40% against forecast, help me explain it.",
     None, ["DEPT_CONFIDENTIAL"], "hold",
     "High confidential internal-document signal: awaiting compliance review.",
     "finance"),
    ("Check my grammar on this internal announcement.",
     None, [], "allow", "No sensitive data class detected.", None),
    ("Email siti.abdullah@acme.my and confirm the audit date.",
     None, ["EMAIL"], "redact",
     "EMAIL to a public AI tool: values tokenised before send.", "finance"),
]

# Three rows in thirty -- 10%, on purpose, and each one a story a judge can
# read off the screen. Seed 60% mismatch and the filter finds nothing useful;
# a mismatch at 0.42 confidence is noise. Both failures look the same to M6.
_MISMATCH: dict[int, str] = {
    7:  "wei.eng@acme.my",       # engineer asking about Q3 revenue
    11: "wei.eng@acme.my",       # engineer with a prompt full of salary data
    26: "siti.finance@acme.my",  # finance staff pasting an HR termination letter
}

# Which held rows are already reviewed, so screen 2 has both a queue with work
# in it and a history that is not empty.
_REVIEWED: dict[int, bool] = {7: True, 27: False}  # log index -> approved?


def _audit_rows(n: int = 30) -> list[AuditRecord]:
    rng = random.Random(20260717)  # fixed: the demo must not shuffle
    now = datetime.now(timezone.utc)
    rows: list[AuditRecord] = []

    for i in range(n):
        prompt, filename, classes, decision, reason, content_dept = \
            _SCENARIOS[i % len(_SCENARIOS)]

        if content_dept is None:
            # Nothing to mismatch against.
            user_id = _STAFF_IDS[i % len(_STAFF_IDS)]
            confidence = 0.0
        elif i in _MISMATCH:
            user_id = _MISMATCH[i]
            confidence = round(rng.uniform(0.62, 0.91), 2)
        else:
            # The normal case: the person who owns the content sends it.
            user_id = STAFF_BY_DEPT[content_dept]
            confidence = round(rng.uniform(0.55, 0.88), 2)

        user_dept = next(d for u, _, d in USERS if u == user_id)
        host = ["chatgpt.com", "gemini.google.com",
                "copilot.microsoft.com"][i % 3]

        # Spread over seven days so M6's stacked bar has seven buckets.
        ts = now - timedelta(days=i % 7,
                             hours=rng.randint(0, 9),
                             minutes=rng.randint(0, 59))

        status = "pending" if decision == "hold" else "auto"
        reviewer = reviewed_at = remark = None
        if decision == "hold" and i in _REVIEWED:
            approved = _REVIEWED[i]
            status = "approved" if approved else "denied"
            reviewer = "admin@acme.my"
            reviewed_at = ts + timedelta(minutes=14)
            remark = ("Approved: aggregate figures only, no individual "
                      "salaries." if approved
                      else "Denied: use the internal assistant for payroll.")

        rows.append(AuditRecord(
            log_id=str(uuid.uuid4()),
            user_id=user_id,
            ts=ts,
            target_host=host,
            # SD-1: the full prompt. When decision == "redact" this is the
            # REDACTED text -- the original lives only in the vault.
            prompt_text=prompt,
            filename=filename,
            data_classes=classes,
            decision=decision,
            reason=reason,
            status=status,
            reviewer=reviewer,
            reviewed_at=reviewed_at,
            remark=remark,
            map_id=str(uuid.uuid4()) if decision == "redact" else None,
            user_department=user_dept,
            content_department=content_dept,
            department_confidence=confidence,
        ))
    return rows


# --------------------------------------------------------------------------


def seed_memory(repos) -> None:
    """Same data, memory backend. Keeps REPO_BACKEND=memory a real preview of
    the demo rather than an empty shell."""
    now = datetime.now(timezone.utc)
    repos.users._seed([UserRow(user_id=u, role=r, department=d)
                       for u, r, d in USERS])
    repos.rules._seed(load_rules_yaml())
    repos.redaction._seed([RedactionClassRow(data_class=c) for c in ALWAYS_REDACT_CLASSES])
    repos.patterns._seed([
        DetectionPatternRow(data_class=c, pattern=p, remark=DEFAULT_PATTERN_REMARKS.get((c, p), ""))
        for c, p in DEFAULT_PATTERNS
    ])
    repos.tools._seed([
        AiTool(host=h, tier=t, status=s,
               approved_by="admin@acme.my" if s == "approved" else None,
               approved_at=now if s == "approved" else None,
               first_seen=now - timedelta(days=30))
        for h, t, s in TOOLS
    ])

    for rec in _audit_rows():
        repos.audit.create(rec)


def seed_postgres(session) -> None:
    from app.models import AiToolRow, DetectionPattern, PolicyRule, RedactionClass, User
    from app.repo.postgres import PgAuditRepo

    now = datetime.now(timezone.utc)

    for uid, role, dept in USERS:
        session.add(User(id=uid, role=role, department=dept))

    for rule in load_rules_yaml():
        session.add(PolicyRule(
            data_class=rule.data_class,
            ai_tool_tier=rule.ai_tool_tier,
            user_role=rule.user_role,
            purpose=rule.purpose,
            decision=rule.decision,
            min_confidence=rule.min_confidence,
            content_department=rule.content_department,
            require_purpose=rule.require_purpose,
            detector=rule.detector,
        ))

    for data_class in ALWAYS_REDACT_CLASSES:
        session.add(RedactionClass(data_class=data_class))

    pattern_sequences: dict[str, int] = {}
    for data_class, pattern in DEFAULT_PATTERNS:
        pattern_sequences[data_class] = pattern_sequences.get(data_class, 0) + 1
        session.add(DetectionPattern(
            data_class=data_class, pattern=pattern,
            remark=DEFAULT_PATTERN_REMARKS.get((data_class, pattern), ""),
            sequence=pattern_sequences[data_class],
        ))

    for host, tier, status in TOOLS:
        session.add(AiToolRow(
            host=host, tier=tier, status=status,
            approved_by="admin@acme.my" if status == "approved" else None,
            approved_at=now if status == "approved" else None,
            first_seen=now - timedelta(days=30),
        ))

    session.commit()

    audit = PgAuditRepo(session)
    for rec in _audit_rows():
        audit.create(rec)
