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

The backbone — **M0, M1, M4, M6** — is built, tested, and wired end to end
against **real HTTP**, not against each other's mocks. M2, M3, M5, M7 and M8
are not built yet; the backbone runs against mocks for them
(`backend/app/mocks.py`), selected explicitly via `MOCK_MODULES` in `.env`.

| | Module | P | Status |
|---|---|---|---|
| ✅ | **M0** Database and persistence | P0 | Built, tested (both backends) |
| ✅ | **M1** API skeleton + mock plane | P0 | Built, tested |
| ☐ | **M2** Deterministic detection | P0 | Mocked — `MockRulesDetector` |
| ☐ | **M3** Decision engine | P0 | Mocked — `mock_decide` (ignores the rule table) |
| ✅ | **M4** Chrome extension | P0 | Built |
| ☐ | **M5** File extractor | P1 | Mocked — `text/plain`/`text/csv` only, else 415 |
| ✅ | **M6** Employer dashboard | P1 | Built |
| ☐ | **M7** Tokenisation vault | P2 | Mocked — `MockTokeniser` |
| ☐ | **M8** Embedding similarity | P1 | Mocked — always returns no spans, `(None, 0.0)` |
| 🧪 | **M9** Fine-tuned DeBERTa-v3-small | P3 | Opt-in two-head scaffold; synthetic data only, awaiting reviewed data and fine-tuning |

`GET /v1/health` reports which modules are currently mocked — check it before
trusting a verdict. While M2/M3/M5/M7 are mocked, only these strings produce
a non-`allow` verdict; everything else correctly returns `allow`:

| Trigger string | Verdict |
|---|---|
| `880412-08-5561` | redact |
| `sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d` | deny |
| `RM 8,500` | hold |
| anything else | allow |

### Proof it works

```bash
bash backend/scripts/backbone_smoke.sh   # all 5 backbone flows, REPO_BACKEND=memory, no Docker
```

- **Backend:** 67 passed, 41 skipped (`REPO_BACKEND=memory pytest`) — the
  skips are the same tests re-run against Postgres, which skip cleanly
  without Docker running.
- **Dashboard:** 10 vitest unit tests (the `by_day` pivot with a sparse day,
  the cross-department predicate including the exact-`0.6` boundary).
- **Extension:** `tsc --noEmit` and `vite build` clean; loadable unpacked
  build in `extension/dist`.

## Layout — do not deviate

```
backend/app/main.py             M1  FastAPI app and routers                   BUILT
backend/app/schemas.py          M1  ALL Pydantic wire models                  BUILT
backend/app/mocks.py            M1  mocks for M2/M3/M5/M7/M8                  BUILT
backend/app/errors.py           M1  Forbidden -- shared 403 (SD-2, detokenise) BUILT
backend/app/db.py               M0  engine, session, create_all, reset        BUILT
backend/app/repo/base.py        M0  repository protocols + DTOs   <- FROZEN*  BUILT
backend/app/repo/postgres.py    M0  SQLAlchemy implementation                 BUILT
backend/app/repo/memory.py      M0  in-memory impl for tests and mocks        BUILT
backend/app/models.py           M0  ORM tables               <- SCHEMA TBD    BUILT
docker-compose.yml              M0  PostgreSQL 16 for local dev               BUILT
backend/app/detect/base.py          shared dataclasses + Detector protocol    BUILT
backend/app/detect/rules.py     M2  deterministic detection                   mocked
backend/app/detect/embed.py     M8  embedding similarity                      mocked
backend/app/detect/deberta.py   M9  optional department detector              scaffolded
backend/ml/m9_train.py          M9  local training entry point                 scaffolded
backend/data/m9/                M9  synthetic starter dataset                  scaffolded
backend/app/extract/files.py    M5  file bytes -> Document                    mocked
backend/app/policy/engine.py    M3  decision engine (decide())                mocked
backend/app/policy/rules.yaml   M3  rule table                                seed data
backend/app/vault/tokeniser.py  M7  reversible redaction                      mocked
extension/                      M4  MV3 + Vite + TypeScript                   BUILT
dashboard/                      M6  React + Vite + TypeScript                 BUILT
```

\* `repo/base.py` is frozen with two team-agreed, additive exceptions already
landed: `AiTool.first_seen` and `AuditRepo.list(cross_department_only=...)`.
See `docs/README_M0.md`.

## Ground rules

Still binding for whoever picks up M2, M3, M5, M7 or M8:

1. **The contracts are law.** If your module seems to need a change, stop and
   say so. Do not change it locally.
2. **Your module must run standalone.** If a dependency is not built yet,
   import it behind a stub that satisfies the contract and returns empty.
3. **Build ONLY the module named in your task.** Someone else already has the
   neighbouring one.
4. Python 3.11, full type hints. PostgreSQL 16 is the only external service.
   No Redis, no Celery, no message queue, no pgvector.
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
# -> http://localhost:8000, seeded with 4 users, 15 rules, 3 tools, 30 audit rows
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
cd backend && REPO_BACKEND=memory pytest    # 67 passed, 41 skipped without Docker
cd dashboard && npm run test                 # vitest
cd extension && npm run typecheck && npm run build
```

```bash
# With Postgres instead of the memory backend
docker compose up -d
cd backend
REPO_BACKEND=postgres python reset_db.py
REPO_BACKEND=postgres uvicorn app.main:app --reload
```

The memory backend is seeded with the same 30 audit rows, 15 rules and 3
tools as the real database, so the extension and dashboard work against real
data before any table exists and nobody but a Postgres session needs Docker
running.

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
