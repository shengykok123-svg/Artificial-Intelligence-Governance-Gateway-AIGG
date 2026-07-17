# Pre-M6 backend patch — paste-ready prompt

**Land this before the M6 session opens.** Two contract changes M6 needs, both
in Python, both in code you own (M0 + M1). They are here rather than in `M6.md`
because M6 is a TypeScript session: a Python task in that paste is an invitation
to wander across the boundary on day 4.

Fresh session. Backend. ~30 minutes.

Both changes close items the team already flagged:
`docs/README_M0.md` → "Two things still open for the team", item 1.

---

## The prompt

```
TASK: two additive contract changes to the built backend, so M6 can be built
against a backend that already has the fields. Change nothing else.

WHAT IS BUILT
M0 (persistence) and M1 (API + mock plane) are done and tested. 34 tests on
memory, 68 with TEST_DATABASE_URL set. Do not refactor either. Do not touch
app/detect/, app/policy/engine.py's decide(), app/extract/, app/vault/, or
app/mocks.py -- those are other people's modules and their mocks.

Ground rules that still hold:
  - Nothing outside backend/app/repo/ may import app/models.py, open a
    Session, or write SQL.
  - app/repo/base.py is FROZEN. These two edits are the deliberate,
    team-agreed exceptions. Both are ADDITIVE: a new field, and a new
    keyword argument with a default. No existing caller changes.
  - Policy is data, not code. Neither change hardcodes a rule.

------------------------------------------------------------------
CHANGE 1 -- AiTool.first_seen

The problem: models.py has a first_seen column, seed_postgres() writes it, and
GET /v1/tools cannot return it because the DTO has no such field. M6's tools
table has a "first seen" column with nothing behind it. Note that
InMemoryToolRepo already keeps a private self._first_seen dict on the side --
that dict existing at all is the evidence the field belonged on the DTO.

  app/repo/base.py
    Append to AiTool:
        first_seen: datetime      # first time this host was ever seen.
                                  # NEVER reset. register() on a known host
                                  # returns it unchanged (SD-7) -- this field
                                  # is the "first seen" in shadow-AI
                                  # discovery, and moving it erases the story.
    Add that behaviour note to the contract comment block at the bottom of
    the file, next to the existing ToolRepo.register note.

  app/repo/memory.py
    Delete the private _first_seen dict. It is now a DTO field. register()
    sets first_seen=_now() for an unknown host; a known host is returned
    unchanged, first_seen included. _seed() sets it.

  app/repo/postgres.py
    _tool_to_dto(): first_seen=row.first_seen. Verify register() writes the
    column for a new host; the model requires it.

  app/seed.py
    seed_memory() currently constructs AiTool(...) without first_seen while
    seed_postgres() writes now - timedelta(days=30). Set BOTH to the same
    value. The parametrised suite asserts identical behaviour from both
    backends, so a divergence here fails loudly -- keep it that way.

  app/main.py
    Nothing. /v1/tools returns {**asdict(tool), "usage_count": n} and the new
    field rides along as an ISO datetime for free. Confirm, do not add code.

  tests
    In the parametrised M0 suite, both backends:
      - register() on an UNKNOWN host sets first_seen to roughly now.
      - register() on a KNOWN host does not move first_seen. This is the
        assertion that matters: it is what makes the column mean "first",
        and re-registering happens on every single prompt to that host.
      - a seeded tool round-trips first_seen through GET /v1/tools.

------------------------------------------------------------------
CHANGE 2 -- cross_department_only on the audit log listing

The problem: M6's cross-department view is the most interesting screen in the
dashboard, and /v1/logs filters only on status and decision. A client-side
toggle over a 20-row page filters the PAGE, not the LOG: it would show 1 of 3
mismatches and look completely correct doing it. The filter has to be where
the pagination is.

THE PREDICATE. Write it once, exactly like this, and put this definition in a
comment in app/repo/base.py so the two implementations and M6's badge cannot
drift apart:

    cross-department  ==  content_department IS NOT NULL
                      AND user_department    IS NOT NULL
                      AND content_department != user_department
                      AND department_confidence > 0.6

Strictly greater than 0.6. Exactly 0.6 is NOT cross-department -- it renders
muted and unbadged in M6. Below the threshold the label is noise and badging
it would be a claim we cannot support.

  app/repo/base.py
    AuditRepo.list gains a keyword-only argument with a default:
        def list(self, *, limit: int, offset: int,
                 status: str | None = None,
                 decision: str | None = None,
                 cross_department_only: bool = False,
                 ) -> tuple[list[AuditRecord], int]: ...
    Default False: every existing caller -- M1's /v1/tools usage count, the
    test suite -- keeps working untouched. That is why this is additive.
    Add the predicate definition above as a comment, and note that `total`
    counts rows matching ALL filters including this one.

  app/repo/memory.py, app/repo/postgres.py
    Implement it in both. It composes with status and decision (AND, not OR).
    It is applied BEFORE the count: total is the number of rows matching every
    filter, not 30 with 3 of them on the page. Postgres does it in SQL, in the
    same where() as the others -- do not filter in Python after the query.

  app/main.py
    GET /v1/logs gains cross_department_only: bool = Query(False), passed
    straight through. No logic in the handler.

  tests
    Parametrised over both backends:
      - Every row returned by the filter satisfies the predicate.
      - The count equals the number of SEEDED rows that satisfy it. seed.py
        plants mismatches in _MISMATCH -- read that dict and check which
        indices actually survive the content_dept-is-None branch above it.
        Assert against what the seed really produces, not against the number
        3 taken from this prompt.
      - total reflects the filter: with the toggle on, total is the mismatch
        count, not 30. This is the assertion that catches "filtered the page".
      - It composes: cross_department_only=True AND decision="hold" returns
        the intersection.
      - cross_department_only=False returns exactly what it returns today.
      - A row at exactly 0.6 is excluded. Add it as a unit row if the seed
        has none -- the boundary is stated in the contract, so pin it.

------------------------------------------------------------------
ALSO UPDATE
  docs/README_M0.md -- "Two things still open for the team": item 1
  (first_seen) is now closed. Say what was decided and why, in one line, and
  leave item 2 (usage count derived from the audit log) open and honest.

DELIVER
  - Full suite green on memory. Green on postgres with TEST_DATABASE_URL set.
  - curl proof, memory backend, no Docker:
        GET /v1/tools                          -> first_seen present on rows
        GET /v1/logs?cross_department_only=true -> mismatches only, total is
                                                   the mismatch count
```
