# M3 — real decision engine landed (session summary)

This session executed `M3_prompt_codex.md` end to end. `MOCK_MODULES` is now
empty, `mock_decide` is deleted, and the whole system runs with zero mocks
(M9 DeBERTa stays opt-in via `SEMANTIC_DETECTOR=m9_deberta`).

## What changed

**Policy is data, verdict model is richer.** `backend/app/policy/rules.yaml`
was replaced with a 22-row policy (was 15). Design shift: deny is now
reserved for `SECRET` (a credential leak is an incident, not a field to
mask). `SALARY`, `BANK_ACCT` and `DEPT_CONFIDENTIAL` all get a path forward
— redact and/or a purpose attestation — instead of a blanket block, because
an unnecessary deny is a shadow-AI conversion.

**`decide()` is real.** `backend/app/policy/engine.py` is now a pure,
table-driven function: per-class best-confidence lookup, candidate matching
(tier/role/purpose wildcards, `min_confidence`, and a `content_department`
field that supports `"*"`, the `"@cross"` sentinel, or a literal
department), most-specific-wins with `min_confidence` and then strictness as
tie-breaks, and a strictest-across-classes final decision. `Verdict` gained
one field: `require_purpose`.

**"State & allow" two-pass flow**, backend to extension:
- `InspectResponse.require_purpose` tells the caller a purpose attestation
  is needed before the verdict can proceed.
- The extension (`content.ts`/`banner.ts`) shows a purpose-picker banner
  (fixed options + free text, never `window.prompt`), resubmits the
  identical prompt+attachments with the chosen purpose, and remembers it
  for the rest of that composer session so later messages don't re-prompt.
- A rule that still demands a purpose after a real one was given is treated
  client-side as a deny — never loop.

**Hold gets a lazy timeout.** At inspect time a `hold` verdict now also runs
the M7 tokenisation eagerly (same code path as `redact`) and stores the
prepared redaction on the audit record, but withholds it from the response.
`GET /v1/inspect/{log_id}` lazily downgrades a stale `pending` hold to
`approved` once `HOLD_TIMEOUT_SECONDS` (default 600, 0 disables) has
elapsed — no scheduler, evaluated on the next poll. The extension applies
the prepared redaction the same way it applies a normal `redact` verdict.

**Audit trail carries `purpose`.** `AuditRecord`/`AuditLog`/dashboard now
record and display what the employee attested (`"GENERAL"` by default).

## One deliberate deviation from the literal spec

The prompt's algorithm (§3, step 6) states `require_purpose = OR across all
winning rules` with no mention of `ctx.purpose`. Implemented literally, a
rule with `purpose: "*"` and `require_purpose: true` (e.g. the SALARY row)
would demand a purpose **forever**, regardless of what was already attested
— pass 2 would always look "misconfigured" and every such request would
dead-end in a client-side deny. That directly contradicts the acceptance
criterion ("`RM 8,500` ⇒ redact + purpose picker", not "eventually denied").

Fix: `decide()` also clears `require_purpose` once `ctx.purpose != "GENERAL"`
(a purpose has already been stated for this request), independent of the
deny-forces-false rule. This is additive — none of the 10 specified test
cases exercise a non-`GENERAL` context, so it doesn't change any of their
outcomes — and it's covered by its own test
(`test_require_purpose_drops_once_a_purpose_is_attested`).

## Files touched

```
backend/app/policy/engine.py       real decide(), Verdict.require_purpose
backend/app/policy/rules.yaml      revised 22-row policy
backend/app/models.py              PolicyRule +3 cols, AuditLog +purpose
backend/app/repo/base.py           RuleRow +3 fields, AuditRecord +purpose
backend/app/repo/postgres.py       mirror the field changes
backend/app/schemas.py             InspectResponse.require_purpose
backend/app/seed.py                load_rules_yaml() reads new keys
backend/app/main.py                two-pass wiring, hold prep, lazy timeout
backend/app/mocks.py               mock_decide deleted
backend/tests/test_policy_engine.py   16 unit tests (10 specified + 6 more)
backend/tests/test_main.py         two-pass + timeout-downgrade integration
                                    tests; existing tests updated to the
                                    new (redact, not deny) verdicts
backend/tests/{conftest,test_mocks,test_repos}.py   updated for new fields
extension/src/types.ts             IF-1/2/3 purpose + require_purpose fields
extension/src/background.ts        purpose passthrough, timeout redirect
extension/src/content.ts           two-pass flow, session purpose memory
extension/src/banner.ts            purpose-picker banner (no window.prompt)
dashboard/src/screens/AuditLog.tsx Purpose column + detail view
dashboard/src/api/types.ts         AuditRecord.purpose
.env.example                       MOCK_MODULES= (empty), HOLD_TIMEOUT_SECONDS=600
README.md                          demo-string table, module status, layout
```

## Verified this session

- `backend`: 154 passed, 43 skipped (no Docker), 5 failed — all 5 are a
  pre-existing environment gap (no local Tesseract binary), confirmed
  identical on unmodified `main` via `git stash`, unrelated to this work.
- `dashboard`: `tsc --noEmit` clean, 10/10 vitest passing.
- `extension`: `tsc --noEmit` and `vite build` clean.
- `ENV=demo REPO_BACKEND=memory` boots; `GET /v1/health` → `"mocked": []`.

## Not done / carried forward

- The pre-existing Tesseract-dependent test failures (OCR extraction, image
  attachment redaction) are untouched — they need a local Tesseract install,
  not a code fix.
- README's "Proof it works" pytest count (`67 passed, 41 skipped`) was
  already stale before this session (predates several M8/M9 additions) and
  was left as-is; only the demo-string table, module status, and layout
  rows that this task's acceptance criteria named were updated.
