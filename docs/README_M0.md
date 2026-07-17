# M0 — Database and persistence

The repository layer. Everything else in the backend sits on top of it.

**IF-9 is frozen. The schema behind it is not.** That is the whole trade: we
agreed the DTOs on day one and left the physical design open all week. When
the team settles `audit_logs`, the change lands in `to_dto()` / `from_dto()`
in `app/repo/postgres.py` and nowhere else.

## Run it

**Without Docker** — the default, and what you want if you are building M1 or M6:

```bash
export REPO_BACKEND=memory
```

That is it. Seeded with the same 30 audit rows, 15 rules and 3 tools as the
real database, so the dashboard has charts with something in them and nobody
is blocked on anyone.

**With Postgres:**

```bash
docker compose up -d          # postgres:16-alpine, port 5432
export DATABASE_URL=postgresql+psycopg://gateway:gateway@localhost:5432/gateway
export REPO_BACKEND=postgres
python reset_db.py            # drop + create_all + seed
```

**Hosted (Railway / Render).** One config change, not a project:

```bash
export DATABASE_URL=<connection string they give you>   # the only line that changes
python reset_db.py --yes
```

The code never knows which one it is talking to. `pool_pre_ping=True` handles a
free-tier database waking from idle, so the first request after a quiet spell
is not a 500 in front of a judge.

## Tests

```bash
pytest                        # 34 tests, memory only, no Docker needed
export TEST_DATABASE_URL=postgresql+psycopg://gateway:gateway@localhost:5432/postgres
pytest                        # 68 — the same 34 against both backends
```

One suite, parametrised over `InMemory*` and `Pg*`, asserting identical
behaviour from both. That suite is the proof the abstraction holds, and it is
what makes the schema and the database swappable later. With no server
reachable the postgres half skips rather than fails — a green suite must not
depend on Docker.

## What M1 imports

```python
from app.repo import get_repos, Repos      # the only door to storage

@router.post("/v1/inspect")
def inspect(req: InspectRequest, repos: Repos = Depends(get_repos)):
    ...
```

`get_repos()` returns all five repos and switches on `REPO_BACKEND`. M1 hands
`repos.vault` to M7 in its constructor. No module ever constructs a repo
itself, and nothing outside `backend/app/repo/` may import `app/models.py`,
open a `Session`, or write SQL.

## Files

| File | What it is |
|---|---|
| `app/repo/base.py` | **FROZEN.** DTOs + five protocols. Nothing else goes here. |
| `app/repo/memory.py` | Built first and completely. Unblocks M1 and M6. |
| `app/repo/postgres.py` | SQLAlchemy impl. The only file that can see the schema. |
| `app/repo/__init__.py` | `get_repos()` — the dependency M1 depends on. |
| `app/models.py` | ORM tables. **Provisional**, expect it to move. |
| `app/db.py` | Engine, session, `create_all`. |
| `app/seed.py` | Users, rules, tools, 30 audit rows. |
| `app/policy/rules.yaml` | **Seed data, not runtime config.** |
| `reset_db.py` | Drop, create, reseed. |

## Decisions worth knowing about

**Rules are rows, not a file.** `rules.yaml` is how `policy_rules` gets its
first fifteen rows, and `seed.py` is the only thing that ever reads it. After
that the table is the only source of truth; M3 receives the rows as an
argument from M1. Changing a rule is a row edit, not a redeploy — otherwise we
rebuild the exact governance gap the case study complains about.

**`ToolRepo.register()` is the shadow-AI story.** An unknown host is
auto-registered as `PUBLIC_AI` / `unapproved` and the prompt is *not* held
(SD-7). Nobody configures anything in advance; the tool appears in the
dashboard the first time somebody uses it, with real usage against it.

**`set_decision` does not touch `decision`.** The verdict the engine reached is
a historical fact; the review outcome is `status`. IF-3 hands the extension
both.

**`stats()` aggregates in SQL.** M6 polls it every 3 seconds. `top_users`
counts risk events only (`decision != 'allow'`) — fifty clean prompts should
not make somebody the riskiest person in the company.

**No Alembic** (SD-6). The schema moves every day this week and `reset_db.py`
is cheaper than migrations over five days. Alembic is the first post-MVP task;
the trigger is not 22 July, it is the hosted database starting to hold data we
would mind losing.

**`retention_until` exists but no purge job runs** (SD-5). The column is there
so retention is a schedule we have not switched on yet rather than a position
we are defending.

**`UserRepo` was added on day 1**, agreed by the team. M1's prompt requires
role and department "from the users table, keyed by `user_id`" (SD-2), while
ground rule 6 forbids M1 from opening a `Session` — so IF-9's original four
protocols left the data reachable by nobody. One method, `by_id()`: no screen
lists users and the dashboard login is hardcoded, so `all()` would be
speculative, and adding to a Protocol later breaks no caller.

## Two things still open for the team

1. **`AiTool` has no `first_seen`, but M6's tools table wants that column.**
   The table has it; the DTO does not. Contract change — raise it at standup
   rather than in a branch. Blocks M6 on day 4, not M1 today.

2. **`GET /v1/tools` is specced as "list[AiTool] + usage count"** and no method
   on `ToolRepo` returns a count. M1 can derive it from the audit log for now.
   Same call: it is the team's, not mine.
