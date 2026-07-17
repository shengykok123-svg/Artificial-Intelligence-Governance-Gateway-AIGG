# AI Governance Gateway

A Chrome extension plus a FastAPI policy plane that inspects prompts and file
attachments before they reach ChatGPT, Gemini or Copilot, and returns one of
four verdicts: **allow | redact | hold | deny**.

## Status

| | Module | Owner | P | Est | Window |
|---|---|---|---|---|---|
| ✅ | **M0** Database and persistence | | P0 | ~4h | Day 1, first |
| ✅ | **M1** API skeleton | | P0 | ~2h | Day 1 AM |
| ☐ | **M2** Deterministic detection | | P0 | ~4h | Day 1 PM |
| ☐ | **M3** Decision engine | | P0 | ~3h | Day 2 AM |
| ☐ | **M4** Chrome extension | | P0 | ~8h | Day 2 PM – 3 |
| ☐ | **M5** File extractor | | P1 | ~3h | Day 3 |
| ☐ | **M6** Employer dashboard | | P1 | ~6h | Day 4 |
| ☐ | **M7** Tokenisation vault | | P2 | ~3h | Day 4 eve |
| ☐ | **M8** Embedding similarity | | P1 | ~3h | Day 4–5 |
| ☐ | **M9** Fine-tuned DistilBERT | | P3 | — | Proposal only |

M0 is built and tested. Every other file in this tree is a placeholder with a
one-line header naming its owner and its wiring.

## Layout — do not deviate

```
backend/app/main.py             M1  FastAPI app and routers
backend/app/schemas.py          M1  ALL Pydantic wire models
backend/app/db.py               M0  engine, session, create_all, reset
backend/app/repo/base.py        M0  repository protocols + DTOs   <- FROZEN
backend/app/repo/postgres.py    M0  SQLAlchemy implementation
backend/app/repo/memory.py      M0  in-memory impl for tests and mocks
backend/app/models.py           M0  ORM tables               <- SCHEMA TBD
docker-compose.yml              M0  PostgreSQL 16 for local dev
backend/app/detect/base.py          shared dataclasses + Detector protocol
backend/app/detect/rules.py     M2  deterministic detection
backend/app/detect/embed.py     M8  embedding similarity
backend/app/extract/files.py    M5  file bytes -> Document
backend/app/policy/engine.py    M3  decision engine
backend/app/policy/rules.yaml   M3  rule table
backend/app/vault/tokeniser.py  M7  reversible redaction
extension/                      M4  MV3 + Vite + TypeScript
dashboard/                      M6  React + Vite + TypeScript
```

## Ground rules

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
# Backend, no Docker needed — this is the default
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export REPO_BACKEND=memory
pytest

# With Postgres
docker compose up -d
export DATABASE_URL=postgresql+psycopg://gateway:gateway@localhost:5432/gateway
export REPO_BACKEND=postgres
python reset_db.py
```

M0's memory backend is seeded with the same 30 audit rows, 15 rules and 3
tools as the real database, so M1 and M6 are unblocked before any table
exists and nobody but the M0 owner needs Docker running.

See `docs/README_M0.md` for the persistence layer.
