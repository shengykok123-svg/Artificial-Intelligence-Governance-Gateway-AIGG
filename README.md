# AI Governance Gateway

A Chrome extension plus a FastAPI policy plane that inspects prompts and file
attachments before they reach ChatGPT, Gemini or Copilot, and returns one of
four verdicts: **allow | redact | hold | deny**. Every event lands in an
auditable log; an employer dashboard is where a held prompt gets approved or
denied, and the extension unblocks the employee within seconds of that
decision.

## Scope snapshot

This repository is a browser-boundary AI governance MVP. It inspects a prompt
before the user submits it to an existing web AI tool; it does **not** host an
AI chat experience or act as an OpenAI-compatible reverse proxy.

In scope: Chrome MV3 capture, the FastAPI inspection/policy plane, optional
semantic detection, reversible tokenisation, audit records, and the employer
dashboard. Out of scope: an AI workspace, an OpenAI-compatible reverse proxy,
and production identity/authentication. See [HANDOFF.md](HANDOFF.md) before
changing interfaces or adding a module.

## Status

**2026-07-20 update:** M3 has landed as a real, pure, table-driven decision
engine with a "state & allow" verdict model (`require_purpose`), and
`MOCK_MODULES` is now empty — the whole system runs with zero mocks (M9
DeBERTa stays opt-in via `SEMANTIC_DETECTOR=m9_deberta`). Policy is data:
`backend/app/policy/rules.yaml` seeds `policy_rules`, and a compliance
officer edits a row, never redeploys code. M2 (regex) classes — MYKAD,
EMAIL, PHONE, PERSON, BANK_ACCT, SALARY, API_KEY included — carry no policy
voice of their own; the structural regex floor redacts every one of them,
never escalates to hold or deny, not even a leaked credential.
DEPT_CONFIDENTIAL (M8/M9) is the only class that can still push a request
to hold or deny. A hold nobody reviews auto-downgrades to its prepared
redaction after `HOLD_TIMEOUT_SECONDS` (default 600s) — nobody waits
unbounded on a human reviewer. See `docs/EXTENSION_TEST_REPORT.md` and
`extension/README.md` for the prior (M3-mocked) acceptance evidence.

The full frame — **M0, M1, M2, M3, M4, M5, M6, M7, M8** — is built, tested,
and wired end to end against **real HTTP**, with `MOCK_MODULES=` empty.
`ENV=demo` now boots.

**2026-07-21 update (M11/M12):** M9's two heads are now judged
independently — `classify()` reports department attribution,
`classify_sensitivity()` reports confidentiality severity on its own scale,
so a sentence M9 is unsure *whose* it is no longer suppresses a strong *is
this confidential* signal the way the old blended `joint_confidence` did.
Cross-department mismatch is a live policy input again: content attributed
to a department other than the requester's escalates the verdict one tier
on top of the same-department bands (`rules.yaml`'s `@cross` rows). The
regex redaction floor now holds on every path, not just `redact` — a
credential or PII span M2 catches is masked in the audit trail on `hold`
and `deny` too, and a *manually* approved hold now releases the same
prepared redaction the lazy timeout always did (previously only the
timeout path did this, so a human approving a hold could release an
unredacted credential). The "state & allow" two-pass flow (purpose picker,
then resubmit) updates the original pending row in place instead of
creating a sibling one — one interaction, one audit row, not two. The
employee's typed justification (previously validated client-side, then
discarded) is now captured and shown in the approval queue next to their
purpose category. Attachments are now downloadable from the audit log —
the redacted copy whenever anything in the file needed masking, the
original otherwise, for every decision including `deny`.

| | Module | P | Status |
|---|---|---|---|
| ✅ | **M0** Database and persistence | P0 | Built, tested (both backends) |
| ✅ | **M1** API skeleton + mock plane | P0 | Built, tested |
| ✅ | **M2** Deterministic detection | P0 | Built — real structured-pattern detector |
| ✅ | **M3** Decision engine | P0 | Built — pure, table-driven, "state & allow" (`require_purpose`) |
| ✅ | **M4** Chrome extension | P0 | Built; live acceptance passed on ChatGPT |
| ✅ | **M5** File extractor | P1 | Built — TXT/CSV/PDF/DOCX/PPTX/XLSX/image OCR extraction |
| ✅ | **M6** Employer dashboard | P1 | Built |
| ✅ | **M7** Tokenisation vault | P2 | Built — Fernet-encrypted reversible token maps |
| ✅ | **M8** Embedding similarity | P1 | Built — `all-MiniLM-L6-v2` embeddings over PostgreSQL + pgvector internal-document chunks |
| 🧪 | **M9** Fine-tuned DeBERTa-v3-small | P3 | Built as an opt-in two-head department + confidentiality detector, axes judged independently (M11); synthetic baseline trained, pending reviewed gold data and threshold recalibration against it |

`GET /v1/health` reports which modules are currently mocked — check it before
trusting a verdict. With `MOCK_MODULES=` empty it should report `mocked: []`.
On `PUBLIC_AI` these demo strings produce the acceptance verdicts:

| Trigger string | Verdict |
|---|---|
| `880412-08-5561` (MyKad) | redact |
| `sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d` (API key) | redact |
| `RM 8,500` (salary) | redact |
| `account no: 1234 5678 9012` (bank account) | redact |
| M8 internal-doc similarity, same department, mid confidence (≥0.50) | allow + purpose picker |
| M8 internal-doc similarity, same department, high confidence (≥0.85) | hold — auto-redacts after `HOLD_TIMEOUT_SECONDS` |
| M9 confidentiality signal, same department, mid confidence (≥0.65) | allow + purpose picker |
| M9 confidentiality signal, same department, high confidence (≥0.90) | hold — auto-redacts after `HOLD_TIMEOUT_SECONDS` |
| same content, attributed to a department other than the requester's | escalates one tier stricter (M11 `@cross` rows) |
| anything else | allow |

M8's cosine similarity and M9's sensitivity-head confidence are independent
scales with their own thresholds — see `backend/app/policy/rules.yaml` for
the complete per-detector tier table, including the deny bands and the
`@cross` escalation rows.

### Proof it works

```bash
bash backend/scripts/backbone_smoke.sh   # all 5 backbone flows, REPO_BACKEND=memory, no Docker
```

- **Backend:** run `REPO_BACKEND=memory pytest` before review; the
  skips are the same tests re-run against Postgres, which skip cleanly
  without Docker running. `test_repos.py` and `test_policy_engine.py` are
  the deterministic, stub-based suites for the repo layer and `decide()`;
  `test_main.py` also loads the real trained M8/M9 models and can drift
  against its hardcoded expected verdicts as those models' raw confidence
  changes — that's model-calibration flakiness, not a code defect, and it
  fails the same way even reverted to a clean checkout.
- **Dashboard:** 10 vitest unit tests (the `by_day` pivot with a sparse day,
  the cross-department predicate including the exact-`0.6` boundary).
- **Extension:** `tsc --noEmit` and `vite build` clean; loadable unpacked
  build in `extension/dist`. Live ChatGPT acceptance passed for MyKad
  redact, API key redact, SALARY redact, EMAIL redact, file replacement
  redaction, the hold → purpose picker → admin approval → redacted-and-sent
  loop (including the credential still getting masked after a *human*
  approval, not just the unattended timeout), cross-department escalation
  to hold/deny, multi-line/tabular pasted content redacting correctly, and
  attachment-removal stale-state handling.
- **File redaction:** TXT/CSV/PDF/DOCX/PPTX/XLSX/PNG/JPEG attachments can be
  checked before upload and replaced in-browser with backend-returned redacted
  copies. OCR requires a local Tesseract binary.
- **M8 internal docs:** PostgreSQL + pgvector stores internal-document chunks,
  chunk text, and embeddings. The dashboard can upload documents into this
  corpus from `Policy & tools`.
- **Audit trail:** the approval queue shows the employee's stated purpose
  category and their free-text justification side by side, and attachments
  are downloadable from the audit log for every decision — the redacted
  copy whenever anything in the file needed masking (confirmed with a
  `API_KEY`-bearing attachment on a `deny`), the original bytes unchanged
  otherwise.

## Layout — do not deviate

```
backend/app/main.py             M1  FastAPI app and routers                   BUILT
backend/app/schemas.py          M1  ALL Pydantic wire models                  BUILT
backend/app/mocks.py            M1  mocks for modules not active in this frame BUILT
backend/app/errors.py           M1  Forbidden -- shared 403 (SD-2, detokenise) BUILT
backend/app/db.py               M0  engine, session, create_all, reset        BUILT
backend/app/repo/base.py        M0  repository protocols + DTOs   <- FROZEN*  BUILT
backend/app/repo/postgres.py    M0  SQLAlchemy implementation                 BUILT
backend/app/repo/memory.py      M0  in-memory impl for tests and mocks        BUILT
backend/app/models.py           M0  ORM tables               <- SCHEMA TBD    BUILT
docker-compose.yml              M0  PostgreSQL 16 for local dev               BUILT
backend/app/detect/base.py          shared dataclasses + Detector protocol    BUILT
backend/app/detect/rules.py     M2  deterministic detection                   BUILT
backend/app/detect/embed.py     M8  embedding similarity                      BUILT
backend/app/detect/deberta.py   M9  optional DeBERTa detector                  BUILT (opt-in)
backend/ml/m9_train.py          M9  local fine-tuning entry point              BUILT
backend/data/m9/                M9  synthetic baseline + review data           BUILT
backend/app/extract/files.py    M5  file bytes -> Document                    BUILT
backend/app/policy/engine.py    M3  decision engine (decide())                BUILT
backend/app/policy/rules.yaml   M3  rule table                                seed data
backend/app/vault/tokeniser.py  M7  reversible redaction                      BUILT
extension/                      M4  MV3 + Vite + TypeScript                   BUILT
dashboard/                      M6  React + Vite + TypeScript                 BUILT
```

\* `repo/base.py` is frozen with two team-agreed, additive exceptions already
landed: `AiTool.first_seen` and `AuditRepo.list(cross_department_only=...)`.
See `docs/README_M0.md`.

## Ground rules

Still binding for whoever picks up M2, M5, M7 or M8:

1. **The contracts are law.** If your module seems to need a change, stop and
   say so. Do not change it locally.
2. **Your module must run standalone.** If a dependency is not built yet,
   import it behind a stub that satisfies the contract and returns empty.
3. **Build ONLY the module named in your task.** Someone else already has the
   neighbouring one.
4. Python 3.11, full type hints. PostgreSQL 16 is the only external service.
   No Redis, no Celery, no message queue. M8 uses pgvector inside PostgreSQL
   for internal-document similarity; do not add a separate vector database.
5. Every module ships with a way to prove it works from the command line.
6. **Nothing outside `backend/app/repo/` may import `app/models.py`, open a
   `Session`, or write SQL.** This is what lets the schema stay undecided while
   everything else gets built.
7. **Policy is data, not code.** Never hardcode a rule or a hostname-to-tier
   mapping anywhere.

One module, one session, one branch. Two modules in one session is where
interface drift starts.

## Start

```bash
# Repo root: copy the example env once (values already work for local dev)
cp .env.example .env

# Backend, no Docker needed — this is the default
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
REPO_BACKEND=memory uvicorn app.main:app --reload
# -> http://localhost:8000, seeded with 4 users, 22 rules, 3 tools, 30 audit rows
```

```bash
# Extension (separate terminal)
cd extension
npm install && npm run build      # -> extension/dist, a loadable unpacked build
# chrome://extensions -> Developer mode -> Load unpacked -> extension/dist
```

```bash
# Dashboard (separate terminal)
cd dashboard
npm install
cp .env.example .env
npm run dev                        # -> http://localhost:5173
```

```bash
# Tests
cd backend && REPO_BACKEND=memory pytest    # 176 passed, 50 skipped without Docker
                                              # (test_main.py's real-model tests can also
                                              # show ~23 pre-existing failures -- see "Proof it works")
cd dashboard && npm run test                 # vitest
cd extension && npm run typecheck && npm run build
```

```bash
# With PostgreSQL + pgvector instead of the memory backend
docker compose up -d
cd backend
REPO_BACKEND=postgres python reset_db.py
python scripts/index_internal_docs_pgvector.py   # seed a sample M8 internal-doc corpus
REPO_BACKEND=postgres uvicorn app.main:app --reload
```

The memory backend is seeded with the same 30 audit rows, 22 rules and 3
tools as the real database, so the extension and dashboard work against real
data before any table exists and nobody but a Postgres session needs Docker
running.

For strict M8 testing, use `REPO_BACKEND=postgres` with a PostgreSQL database
that has pgvector installed. If pgvector is missing, `reset_db.py` fails while
creating `internal_doc_chunks`; that is expected because M8 is not considered
ready without pgvector. The dashboard uploader calls `POST /v1/internal-docs`
and indexes uploaded files into that same table.

## Docs

- `docs/README_M0.md` — the persistence layer, and the two additive
  exceptions to `repo/base.py`
- `extension/README.md` — every DOM selector used, where it came from, and
  the MAIN-world/isolated-world composer-write split
- `dashboard/README.md` — how to run it, what `VITE_USE_MSW` does, and which
  screens are read-only in this MVP
- `backend/README_M9.md` — M9 data format, training, and opt-in runtime setup
- `backend/docs/M9_ANNOTATION_GUIDE.md` — team annotation rules and end-to-end M9 data/training flow
- `backend/docs/M9_ANNOTATION_GUIDE_ZH.md` — 中文版 M9 标注规则与训练流程
- `docs/M8_PGVECTOR_INTERNAL_DOCS.md` — M8 PostgreSQL + pgvector setup,
  dashboard upload path, and current limitations
- `docs/LUIS_HANDOVER_SUMMARY.md` — short teammate-facing summary of what
  Luis added on top of `origin/main`
- `docs/LUIS_DEVELOPMENT_CONTEXT.md` — fuller decision/context handover for
  teammates or coding agents continuing Luis's branch
- `docs/RUNBOOK.md` — step-by-step local setup, run, acceptance, and takeover
  checklist for backend, dashboard, extension, and M8 pgvector
