# M3 — paste-ready prompt (real decision engine + state & allow)

Fresh session. Paste **Part 1** (context block), then **Part 2** (task).

After this lands, `MOCK_MODULES` is empty and the whole system runs with
**zero mocks**: M0–M8 real, M9 opt-in.

---

## Part 1 — CONTEXT BLOCK

```
PROJECT
AI Governance Gateway. A Chrome extension plus a FastAPI policy plane that
inspects prompts and file attachments before they reach ChatGPT, Gemini or
Copilot. Verdicts: allow | redact | hold | deny, plus a require_purpose
flag ("state & allow"). Every event lands in an auditable log.

CURRENT STATE
M0 (DB, memory + postgres repos), M1 (API), M2 (regex detection),
M4 (extension), M5 (extraction), M6 (dashboard), M7 (vault), M8 (pgvector
similarity) are BUILT AND REAL. M9 (DeBERTa) is opt-in via
SEMANTIC_DETECTOR=m9_deberta. M3 is the ONLY mock left:
backend/app/mocks.py:mock_decide, selected by MOCK_MODULES=M3 in .env.

REPO LAYOUT (only touch the marked files)
  backend/app/policy/engine.py     M3 decide()               <- YOU (main)
  backend/app/policy/rules.yaml    seed rows                 <- YOU (extend)
  backend/app/models.py            PolicyRule, AuditLog      <- YOU (columns)
  backend/app/repo/base.py         RuleRow, AuditRecord      <- YOU (fields)
  backend/app/repo/memory.py       mirror the field changes  <- YOU
  backend/app/repo/postgres.py     mirror the field changes  <- YOU
  backend/app/schemas.py           InspectResponse, audit    <- YOU (fields)
  backend/app/seed.py              yaml loader for new cols  <- YOU
  backend/app/main.py              wire real decide, purge   <- YOU
  backend/app/mocks.py             DELETE mock_decide        <- YOU
  backend/tests/                   test_policy_engine.py     <- YOU (new)
  extension/src/types.ts           IF-2/IF-3 types           <- YOU
  extension/src/background.ts      resubmit-with-purpose     <- YOU
  extension/src/content.ts         purpose picker trigger    <- YOU
  extension/src/banner.ts          purpose picker UI         <- YOU
  dashboard/src/                   show purpose column       <- YOU (minor)
  .env.example                     MOCK_MODULES=, timeout    <- YOU

FROZEN CONTRACTS — never change these shapes
  backend/app/detect/base.py  Span, Document, Classification, Detector,
                              DocumentClassifier. Span.start/end are real
                              offsets into ONE Document.text.
  PolicyContext(user_role, department, ai_tool_tier, tool_status,
                purpose, target_host)   # frozen dataclass, keep as is

CLASSIFICATION INPUT (what decide() receives)
  Classification(
    data_classes: list[DataClass],   # union across prompt + attachments
    confidence: float,               # max span confidence overall
    spans: list[Span],               # PROMPT spans only (offset-valid)
    content_department: str | None,  # from M8/M9 classify()
    department_confidence: float)
  DataClass = PERSON | MYKAD | EMAIL | PHONE | BANK_ACCT | SALARY |
              SECRET | DEPT_CONFIDENTIAL
  Span.detector = "rules" (M2, confidence always 1.0)
                | "embed" (M8, cosine similarity)
                | "deberta" (M9, joint head confidence)

DESIGN RULES (repo-wide, do not violate)
  SD-2  role/department come from the users table, never a header.
  Only backend/app/repo/ may import app/models.py or open a session.
  M3 is a PURE FUNCTION: no I/O, no yaml read, no env read, no clock read
  except through arguments. Rules arrive as list[RuleRow] fetched by M1
  via repos.rules.all(). Policy is data: a compliance officer edits a row,
  never a file.
  A broken real module must fail loudly — never fall back to a mock.
```

---

## Part 2 — TASK

Implement the real M3 decision engine with the **state & allow** verdict
model, wire the extension two-pass purpose flow, extend the audit log, and
remove the last mock. Work in this order.

### 1. Schema and DTOs

`PolicyRule` (models.py) gains three columns, `RuleRow` (repo/base.py)
gains the same three fields, both repos mirror them:

```
min_confidence: float = 0.0        # rule matches only if best span
                                   # confidence for this class >= it
content_department: str = "*"      # "*" or finance|hr|legal|engineering;
                                   # matched against
                                   # Classification.content_department
require_purpose: bool = False      # "state & allow" flag
```

`AuditLog` / `AuditRecord` / audit schemas gain:

```
purpose: str = "GENERAL"           # what the employee attested
```

Schema is moving, so this is a reset_db.py change, NOT a migration.
Update `seed.py:load_rules_yaml()` to read the new keys with those
defaults so every existing yaml row still parses.

### 2. rules.yaml — seed the REVISED policy

Replace the whole `rules:` block with the policy below. Design principle:
**deny is reserved for cases where redaction destroys the task's purpose
or the event itself is an incident (credentials). Every other class gets
a path forward** — an unnecessary deny is a shadow-AI conversion.
Unlisted (class, tier) pairs resolve to allow via the no-candidate rule
in decide(); the rows below are the complete intended policy.

```yaml
rules:
  # ---------- PUBLIC_AI (ChatGPT, Gemini — external boundary) ----------
  # Tokenisable PII: reversible redaction, zero friction. PDPA answered.
  - {data_class: MYKAD,  ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*", decision: redact}
  - {data_class: EMAIL,  ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*", decision: redact}
  - {data_class: PHONE,  ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*", decision: redact}
  - {data_class: PERSON, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*", decision: redact}

  # SECRET: the one true deny. A leaked credential is an incident to
  # surface (rotate the key), not a field to mask. Purpose never overrides.
  - {data_class: SECRET, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*", decision: deny}

  # SALARY: maskable and legitimate in real work (budgets, job ads).
  # Masked amount + attested purpose instead of a blanket block.
  - {data_class: SALARY, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     decision: redact, require_purpose: true}

  # BANK_ACCT: structured, exact-span, perfectly maskable.
  - {data_class: BANK_ACCT, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*", decision: redact}

  # DEPT_CONFIDENTIAL: confidence-tiered (see §5.3 of the proposal).
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     min_confidence: 0.65, content_department: "*",
     decision: allow, require_purpose: true}          # mid: state & allow
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     min_confidence: 0.85, content_department: "*",
     decision: redact, require_purpose: true}         # high: auto-redact + state
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     min_confidence: 0.85, content_department: "@cross",
     decision: hold}                                  # high + cross-dept: ONLY hold
     # "@cross" sentinel: content_department is set AND != ctx.department

  # ---------- ENTERPRISE_AI (tenant agreement — one notch looser) ------
  - {data_class: MYKAD,  ai_tool_tier: ENTERPRISE_AI, user_role: "*", purpose: "*", decision: allow}
  - {data_class: EMAIL,  ai_tool_tier: ENTERPRISE_AI, user_role: "*", purpose: "*", decision: allow}
  - {data_class: PHONE,  ai_tool_tier: ENTERPRISE_AI, user_role: "*", purpose: "*", decision: allow}
  - {data_class: PERSON, ai_tool_tier: ENTERPRISE_AI, user_role: "*", purpose: "*", decision: allow}
  - {data_class: SECRET, ai_tool_tier: ENTERPRISE_AI, user_role: "*", purpose: "*", decision: redact}
  - {data_class: SALARY, ai_tool_tier: ENTERPRISE_AI, user_role: hr,      purpose: "*", decision: allow}
  - {data_class: SALARY, ai_tool_tier: ENTERPRISE_AI, user_role: finance, purpose: "*", decision: allow}
  - {data_class: SALARY, ai_tool_tier: ENTERPRISE_AI, user_role: "*",     purpose: "*", decision: redact}
  - {data_class: BANK_ACCT, ai_tool_tier: ENTERPRISE_AI, user_role: finance, purpose: "*", decision: allow}
  - {data_class: BANK_ACCT, ai_tool_tier: ENTERPRISE_AI, user_role: "*",     purpose: "*", decision: redact}
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: ENTERPRISE_AI, user_role: "*", purpose: "*",
     min_confidence: 0.65, content_department: "*",
     decision: allow, require_purpose: true}          # state & allow even at high conf

  # ---------- INTERNAL_AI (our own tool — trust it with our data) ------
  - {data_class: SECRET, ai_tool_tier: INTERNAL_AI, user_role: "*", purpose: "*", decision: redact}
  # everything else on INTERNAL_AI: allow (no row needed)
```

All fields absent from a row take the schema defaults
(`min_confidence: 0.0`, `content_department: "*"`,
`require_purpose: false`), so `load_rules_yaml()` must apply those
defaults. Note the policy intent: SALARY and BANK_ACCT are now
**redact**, not deny, on PUBLIC_AI — deny is reserved for SECRET.
This differs from the old demo table in mocks.py and README; the README
demo-string table must be updated to match (see Acceptance).

### 3. decide() in backend/app/policy/engine.py

Signature stays `decide(classification, ctx, rules) -> Verdict`. Extend
the frozen Verdict dataclass with one field:

```python
require_purpose: bool = False
```

Algorithm — deterministic, table-driven, pure:

1. Per detected `data_class`, compute `best_conf` = max confidence of
   spans of that class (attachment classes with no prompt span: use
   `classification.confidence`).
2. Candidate rules for that class:
   - `rule.data_class == data_class` (exact)
   - tier/role/purpose fields match ctx or are `"*"`
   - `best_conf >= rule.min_confidence`
   - content_department: `"*"` always matches; `"@cross"` matches iff
     `classification.content_department` is not None and differs from
     `ctx.department`; a literal department matches equality.
3. Most specific candidate wins. Specificity = count of non-wildcard
   fields, where `@cross`/literal department counts as non-wildcard and a
   higher `min_confidence` beats a lower one at equal wildcard count.
4. Ties break stricter: `deny(4) > hold(3) > redact(2) > allow(1)`.
5. No candidate for a class ⇒ that class contributes `allow` (and the
   reason notes the unmatched class — visible, not silent).
6. Final decision = strictest across all per-class winners.
   `require_purpose` = OR across all winning rules. Exception: when the
   final decision is `deny`, force `require_purpose = False` — never ask
   for a purpose on a request that will be blocked regardless.
7. `spans_to_redact`: when final decision is `redact`, the spans of every
   class whose winning rule said redact; otherwise `[]`. Never invent
   spans; only pass through `classification.spans`.
8. `reason`: one sentence naming the deciding class(es), detector,
   confidence and, if `require_purpose`, "purpose attestation required".

### 4. Two-pass purpose flow (API + extension)

`InspectResponse` gains `require_purpose: bool = False`. M1 passes
`Verdict.require_purpose` straight through and stores `req.purpose` on
the audit record.

Extension (IF-2 request already carries `purpose`, default `"GENERAL"`):

- Pass 1: submit as today with `purpose: "GENERAL"`.
- If response has `require_purpose: true` AND the stored purpose for this
  composer session is still `"GENERAL"`: block submission, show a
  **purpose picker banner** (banner.ts) with fixed options
  `data_analysis | drafting | translation | debugging | other (free text)`
  and a Continue button. Do not use window.prompt.
- Pass 2: resubmit the IDENTICAL prompt+attachments with the chosen
  purpose. Apply the pass-2 verdict exactly as verdicts are applied
  today: allow ⇒ submit original; redact ⇒ swap in redacted_prompt then
  submit; deny ⇒ block with reason; hold ⇒ existing poll flow.
- If pass 2 STILL returns require_purpose (misconfigured rule), treat as
  deny with the reason — never loop.
- Remember the chosen purpose per composer session so edits of the same
  message don't re-prompt.

### 5. Hold: prepared redaction + lazy timeout

Anti-shadow-AI rule: nobody waits unbounded.

- At inspect time, when the verdict is `hold`, ALSO run the M7
  tokenisation exactly as the redact path does, store map_id and the
  redacted prompt on the audit record, but return `decision: "hold"` with
  `redacted_prompt: null` (nothing is released yet).
- New env `HOLD_TIMEOUT_SECONDS=600` (0 = disabled).
- Lazy evaluation, no scheduler: inside `GET /v1/inspect/{log_id}`, if
  status is `pending` and `now - ts > HOLD_TIMEOUT_SECONDS`, downgrade:
  set status `approved`, remark `auto: hold timeout -> redact`, and
  return the stored redacted prompt. The extension already applies
  approved+redacted, so no new client state is needed.
- Admin approve/deny before the timeout behaves exactly as today.

### 6. Audit log + dashboard

- Audit list/detail API responses include `purpose`.
- Dashboard audit table: add a Purpose column; detail view shows purpose
  next to reason. One-line change per view — do not redesign.

### 7. Remove the last mock

- Delete `mock_decide` (and its DELETE-WHEN-M3-LANDS block) from
  mocks.py. `get_decider()` in main.py imports
  `app.policy.engine.decide` unconditionally.
- `.env.example`: `MOCK_MODULES=` (empty) + the new
  `HOLD_TIMEOUT_SECONDS=600`.
- `GET /v1/health` must report `mocked: []`. `ENV=demo` now boots.

### 8. Tests (pytest, table-driven, no HTTP/DB/model needed for decide)

`backend/tests/test_policy_engine.py`, minimum cases:

1. MYKAD @ PUBLIC_AI ⇒ redact, spans_to_redact == the MYKAD spans.
2. SECRET @ PUBLIC_AI ⇒ deny, require_purpose False even if another
   matched rule set it, spans_to_redact empty.
   SALARY @ PUBLIC_AI ⇒ redact + require_purpose True.
3. EMAIL + SECRET ⇒ deny (strictest wins).
4. DEPT_CONFIDENTIAL conf 0.74 ⇒ allow + require_purpose True.
5. DEPT_CONFIDENTIAL conf 0.91, content_department == ctx.department ⇒
   redact + require_purpose True (0.85 tier out-ranks 0.65 tier).
6. DEPT_CONFIDENTIAL conf 0.91, content finance, ctx.department
   marketing ⇒ hold (`@cross` beats the redact row on specificity).
7. SALARY @ ENTERPRISE_AI, role hr ⇒ allow (specific beats wildcard).
8. No spans ⇒ allow, require_purpose False.
9. Same inputs twice ⇒ identical Verdict (purity/determinism).
10. Unknown data_class with no rule ⇒ allow, reason mentions it.

Integration: extend the existing inspect tests — two-pass purpose flow
returns require_purpose then resolves on resubmit; hold timeout downgrade
via a monkeypatched clock; audit record contains the attested purpose.

### Acceptance

`MOCK_MODULES=` empty, `ENV=demo` boots, `/v1/health` shows no mocks, all
tests green, and on PUBLIC_AI the demo strings produce:
MyKad ⇒ redact; sk-proj key ⇒ deny; RM 8,500 ⇒ redact + purpose picker;
"account no: 1234 5678 9012" ⇒ redact; mid-similarity internal content ⇒
state & allow (purpose picker); high-similarity same-department ⇒ redact +
purpose picker; high-similarity cross-department ⇒ hold that auto-redacts
after the timeout; anything else ⇒ allow. Update the README demo-string
table to these verdicts so the recorded demo matches the shipped policy.
