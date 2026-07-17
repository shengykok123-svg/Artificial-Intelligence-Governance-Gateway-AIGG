# M1 — paste-ready prompt

Fresh session. Paste **part 1** (context block), then **part 2** (task), then send.

> **Changes since the plan doc.** Marked `CHANGED` / `NEW` below.
> The `UserRow` / `UserRepo` edit is in the **context block**, so it applies to
> **every** module session from here on — M2 through M8, not just M1.
> Update the doc.

---

## Part 1 — CONTEXT BLOCK

```
PROJECT
AI Governance Gateway. A Chrome extension plus a FastAPI policy plane that
inspects prompts and file attachments before they reach ChatGPT, Gemini or
Copilot, and returns one of four verdicts: allow | redact | hold | deny.

REPO LAYOUT (do not deviate)
  backend/app/main.py             M1  FastAPI app and routers
  backend/app/schemas.py          M1  ALL Pydantic wire models
  backend/app/mocks.py            M1  mocks for modules not yet built   [NEW]
  backend/app/db.py               M0  engine, session, create_all, reset
  backend/app/repo/base.py        M0  repository protocols + DTOs   <- FROZEN
  backend/app/repo/__init__.py    M0  get_repos() dependency + Repos bundle
  backend/app/repo/postgres.py    M0  SQLAlchemy implementation
  backend/app/repo/memory.py      M0  in-memory impl for tests and mocks
  backend/app/models.py           M0  ORM tables               <- SCHEMA TBD
  backend/app/seed.py             M0  users, rules, tools, 30 audit rows
  backend/reset_db.py             M0  drop + create_all + seed
  backend/scripts/backbone_smoke.sh  M1  end-to-end proof, no DB     [NEW]
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

FROZEN CONTRACTS
Never change these signatures. Other modules are being written against them in
parallel, in separate sessions, by people who cannot see your code.

# backend/app/detect/base.py
DataClass = Literal["PERSON", "MYKAD", "EMAIL", "PHONE", "BANK_ACCT",
                    "SALARY", "SECRET", "DEPT_CONFIDENTIAL"]

@dataclass(frozen=True)
class Span:
    start: int              # character offset into Document.text
    end: int
    data_class: DataClass
    detector: str           # "rules" | "embed"
    confidence: float       # 0.0 - 1.0

@dataclass(frozen=True)
class Document:
    text: str
    source_filename: str | None   # None for the raw prompt
    mime: str                     # "text/plain" for the raw prompt

@dataclass(frozen=True)
class Classification:
    data_classes: list[DataClass]
    confidence: float
    spans: list[Span]
    content_department: str | None    # finance | hr | legal | engineering
    department_confidence: float      # 0.0 when content_department is None

class Detector(Protocol):
    def detect(self, doc: Document) -> list[Span]: ...

class DocumentClassifier(Protocol):
    def classify(self, doc: Document) -> tuple[str | None, float]: ...
    # Document-level label, NOT a span. Detector answers "where in this text";
    # DocumentClassifier answers "what is this text about". A future behaviour
    # classifier implements this same protocol with no contract change.

# backend/app/schemas.py
class Attachment(BaseModel):
    filename: str
    mime: str
    content_b64: str

class InspectRequest(BaseModel):
    user_id: str
    target_host: str        # "chatgpt.com" | "gemini.google.com"
    prompt: str
    purpose: str = "GENERAL"
    attachments: list[Attachment] = []

class InspectResponse(BaseModel):
    decision: Literal["allow", "redact", "hold", "deny"]
    log_id: str
    data_classes: list[str]
    redacted_prompt: str | None   # populated only when decision == "redact"
    reason: str                   # one human-readable sentence

# backend/app/repo/base.py
# FROZEN. The ORM tables in models.py behind this are NOT frozen and are
# still under discussion. That is exactly why this layer exists: the schema
# can change all week, and the database can be swapped, without any other
# module noticing.

@dataclass
class AuditRecord:
    log_id: str
    user_id: str
    ts: datetime
    target_host: str
    prompt_text: str               # FULL prompt text. SD-1.
                                   # When decision == "redact" this holds
                                   # the REDACTED text; originals live only
                                   # in the vault. See M7.
    filename: str | None
    data_classes: list[str]
    decision: str                  # allow | redact | hold | deny
    reason: str
    status: str                    # auto | pending | approved | denied
    reviewer: str | None
    reviewed_at: datetime | None
    remark: str | None
    map_id: str | None             # set when decision == "redact"
    user_department: str | None    # from the users table. Who the person is.
    content_department: str | None # from M8. What the prompt is about.
    department_confidence: float
    # The two are orthogonal. user != content is cross-department data
    # contact, and that is the column worth looking at.

@dataclass
class TokenEntry:
    token: str                     # "[MYKAD_1]"
    ciphertext: bytes

@dataclass
class RuleRow:
    data_class: str
    ai_tool_tier: str
    user_role: str
    purpose: str
    decision: str

@dataclass
class StatsSummary:
    by_decision: dict[str, int]
    by_day: list[tuple[str, str, int]]      # (iso_date, decision, count)
    top_data_classes: list[tuple[str, int]]
    top_users: list[tuple[str, int]]

@dataclass
class AiTool:
    host: str                      # "chatgpt.com"
    tier: str                      # PUBLIC_AI | ENTERPRISE_AI | INTERNAL_AI
    status: str                    # approved | unapproved | blocked
    approved_by: str | None
    approved_at: datetime | None

# ---- CHANGED: added day 1, agreed by the team -------------------------
@dataclass
class UserRow:
    user_id: str
    role: str                      # admin | staff
    department: str                # finance | hr | legal | engineering
    # SD-2: the users table is the source of truth for role and department.
    # Production reads this from an IdP claim. Future work.
# -----------------------------------------------------------------------

class AuditRepo(Protocol):
    def create(self, rec: AuditRecord) -> str: ...
    def get(self, log_id: str) -> AuditRecord | None: ...
    def list(self, *, limit: int, offset: int,
             status: str | None = None,
             decision: str | None = None) -> tuple[list[AuditRecord], int]: ...
    def set_decision(self, log_id: str, *, approve: bool,
                     reviewer: str, remark: str) -> AuditRecord: ...
    def stats(self) -> StatsSummary: ...

class VaultRepo(Protocol):
    def put_map(self, map_id: str, entries: list[TokenEntry]) -> None: ...
    def get_map(self, map_id: str) -> list[TokenEntry]: ...

class RuleRepo(Protocol):
    def all(self) -> list[RuleRow]: ...

class ToolRepo(Protocol):
    def by_host(self, host: str) -> AiTool | None: ...
    def all(self) -> list[AiTool]: ...
    def register(self, host: str) -> AiTool: ...  # unknown host, unapproved

# ---- CHANGED: added day 1, agreed by the team -------------------------
class UserRepo(Protocol):
    def by_id(self, user_id: str) -> UserRow | None: ...
    # Without this, M1 was told to read the users table (SD-2) while ground
    # rule 6 forbade it opening a Session: data with no door. One method on
    # purpose; no screen lists users.
# -----------------------------------------------------------------------

# ---- Cross-module signatures. Owned by their module, quoted here so M1 --
# ---- can build against them before they exist. Do not vary.      [NEW] --

# backend/app/detect/rules.py            M2
class RulesDetector:                     # satisfies Detector
    def detect(self, doc: Document) -> list[Span]: ...

# backend/app/detect/embed.py            M8
class EmbedDetector:                     # satisfies Detector + DocumentClassifier
    def detect(self, doc: Document) -> list[Span]: ...
    def classify(self, doc: Document) -> tuple[str | None, float]: ...

# backend/app/extract/files.py           M5
def extract(filename: str, mime: str, content_b64: str) -> Document: ...
class UnsupportedFile(Exception): ...    # -> 415

# backend/app/policy/engine.py           M3
@dataclass(frozen=True)
class PolicyContext:
    user_role: str
    department: str
    ai_tool_tier: str
    tool_status: str
    purpose: str
    target_host: str

@dataclass(frozen=True)
class Verdict:
    decision: str                        # allow | redact | hold | deny
    reason: str
    spans_to_redact: list[Span]

def decide(c: Classification, ctx: PolicyContext,
           rules: list[RuleRow]) -> Verdict: ...

# backend/app/vault/tokeniser.py         M7
class Tokeniser:
    def __init__(self, vault: VaultRepo) -> None: ...
    def tokenise(self, text: str, spans: list[Span]) -> tuple[str, str]:
        ...                              # -> (redacted_text, map_id)
    def detokenise(self, map_id: str, text: str,
                   requester_role: str) -> str: ...
# A CLASS, not free functions: the M7 prompt's signature block shows no
# self, but its wiring says the VaultRepo is "handed to you by M1 in
# __init__". Free functions have no __init__. Resolved as a class.

GROUND RULES
1. The contracts above are law. If your module seems to need a change, stop and
   say so. Do not change it locally.
2. Your module must run standalone. If a dependency is not built yet, import it
   behind a stub that satisfies the contract and returns an empty result.
3. Build ONLY the module named in the task. Do not helpfully implement the
   neighbouring modules; someone else already is.
4. Python 3.11, full type hints. PostgreSQL 16 is the only external service,
   run locally via docker-compose and hosted in production. Do not add Redis,
   Celery, a message queue, or pgvector.
5. Every module ships with a way to prove it works from the command line.
6. Nothing outside backend/app/repo/ may import from app/models.py, open a
   Session, or write SQL. Persistence is reached only through the repository
   protocols. This is what lets the schema stay undecided while everything
   else is built.
7. Policy is data, not code. Which data classes CAN be detected is decided
   by the detectors and ships in a release. What to DO about a detected
   class, and which tier an AI tool sits in, are rows an admin edits at
   runtime. Never hardcode a rule or a hostname-to-tier mapping anywhere.
```

---

## Part 2 — M1 TASK

```
TASK: build M1, the API skeleton, plus the mock plane that proves the whole
backbone runs end-to-end before M2, M3, M5 and M7 exist.

OWNERSHIP — read this first.                                         [NEW]
I own the BACKBONE: M0 (done), M1 (this task), then M4 and M6. That is the
spine — extension, API, pipeline, storage, dashboard.

Four modules belong to OTHER PEOPLE, in other sessions, being written right
now against the same frozen contracts:

    M2  deterministic detection    app/detect/rules.py
    M3  decision engine            app/policy/engine.py   (decide() body only)
    M5  file extractor             app/extract/files.py
    M7  redaction vault            app/vault/tokeniser.py

Do not write any of them. Do not "finish" one because it looks close. Do not
improve a mock into a real implementation. When each lands it replaces its
mock and nothing else moves.

The mock plane is not scaffolding for your tests. It is how the backbone gets
proven on day 1 instead of day 4: with it, every hop of the flow — extension
request, pipeline, verdict, audit row, dashboard, approval, extension unblock
— runs end-to-end with four modules missing. The mocks are the stand-ins that
let the spine be exercised for real.

M0 IS BUILT AND TESTED. Do not stub it, rewrite it, or touch anything under
backend/app/repo/, app/models.py, app/db.py or app/seed.py.       [CHANGED]
You reach storage ONLY through the get_repos() dependency:

    from app.repo import get_repos, Repos

    @router.post("/v1/inspect")
    def inspect(req: InspectRequest, repos: Repos = Depends(get_repos)):
        ...

Repos is a bundle of five: repos.audit, repos.vault, repos.rules,
repos.tools, repos.users. Do not define ORM tables, open a Session, or
import app/models.py.                              [CHANGED: was four]

Run with REPO_BACKEND=memory. No Docker. Already seeded with 4 users, 15
rules, 3 AI tools and 30 audit rows over 7 days, so your endpoints return
real data from the first request. The API cannot tell memory from postgres;
that is the point.                                              [CHANGED]

IMPLEMENT
- app/schemas.py: exactly the models in the context block, nothing more.
- app/detect/base.py: exactly the dataclasses and protocols above.
- app/policy/engine.py: ONLY the frozen PolicyContext and Verdict
  dataclasses. Leave decide() to M3 — do not write its body. You need the
  types to construct a context; M3's author adds the function beneath them
  and does not touch the dataclasses.                                [NEW]
- app/mocks.py: see MOCKS below.                                     [NEW]
- app/main.py routers:
    POST /v1/inspect            -> InspectResponse
    GET  /v1/inspect/{log_id}   -> {decision, status}
    GET  /v1/logs               -> paginated, ?limit&offset&status&decision
    POST /v1/logs/{id}/decision -> body {approve: bool, remark: str}
    GET  /v1/stats              -> StatsSummary
    GET  /v1/rules              -> list[RuleRow]                     IF-10
    GET  /v1/tools              -> list[AiTool] + usage count        IF-10
    POST /v1/tools/{host}/decision -> body {status, remark}          IF-10
    GET  /v1/health             -> {status, mocked: list[str]}       [NEW]
- CORS allowing chrome-extension://* and http://localhost:5173.
- An X-Api-Key header check against settings.API_KEY from a .env file.
- Map UnsupportedFile -> 415, Forbidden -> 403, unknown log_id -> 404.

MOCKS                                                                [NEW]
M2 (detection), M3 (decision engine) and M7 (redaction vault) are other
people's modules, being built right now in other sessions. M5 and M8 too.
You are NOT building any of them. You are building the seam they drop into,
and mocks dumb enough that nobody mistakes them for the real thing.

Selection is EXPLICIT, never a try/except ImportError fallback:

    MOCK_MODULES=M2,M3,M5,M7,M8        # .env; remove each as it lands

A silent fallback is the trap here. If M2 lands with a broken import, an
except ImportError quietly serves mock detection and the API still returns
200 — and you find out in front of a judge. Explicit list, loud failure.

Guards, all cheap, all non-negotiable:
  - Log a startup banner naming every active mock.
  - If ENV=demo and MOCK_MODULES is non-empty, raise at startup and refuse
    to serve. A demo video recorded against mock detection would show
    redaction that never happened. That is not a bug, it is a false claim
    about the product, and the guard is what makes it impossible.
  - GET /v1/health returns the mocked list, so M4 and M6 can see what they
    are talking to.

app/mocks.py, each satisfying the contract in the context block exactly:

  MockRulesDetector (M2)
    A dict of literal trigger strings -> DataClass. NOT regex; regex is M2's
    entire job and a half-good copy invites someone to keep it. Use
    str.find in a loop so offsets are REAL offsets into doc.text — M7
    redacts in place and M4 highlights from them, so fake offsets poison
    two other modules. Cover enough to reach all four verdicts:
        "880412-08-5561"                    -> MYKAD    (redact)
        "sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d"  -> SECRET   (deny)
        "RM 8,500"                          -> SALARY   (hold)
        anything else                       -> no spans (allow)
    These match M0's seed rows, so the same strings work in curl and in the
    dashboard.

  MockEmbedDetector (M8)
    detect() -> []. classify() -> (None, 0.0). The honest empty result: M8
    is P2 and may never ship. M6 renders None as an em dash.

  mock_extract (M5)
    text/plain and text/csv: base64-decode as UTF-8 into a Document.
    Everything else: raise UnsupportedFile -> 415. Do not import pdfplumber,
    python-docx or python-pptx; those are M5's dependencies.

  mock_decide (M3)
    Strictest-wins over a hardcoded data_class -> decision table:
        SECRET -> deny;  SALARY, DEPT_CONFIDENTIAL -> hold;
        MYKAD, BANK_ACCT, EMAIL, PHONE, PERSON -> redact;  none -> allow.
    IGNORES rules, tier, role and purpose. Say so in the docstring in those
    words. This is deliberately NOT M3's logic — M3 resolves the rule table,
    which is the whole "policy is data" claim. Still call it with the real
    rules argument from repos.rules.all() so the call site is finished and
    M3 is a one-line import swap.

  MockTokeniser (M7)
    Same class shape: __init__(vault: VaultRepo).
    tokenise(): replace spans right-to-left with [CLASS_n], store base64 of
    the original via vault.put_map(). Base64, not Fernet, and not plaintext:
    obviously not encryption, so no one ships it by accident. Right-to-left
    because left-to-right corrupts every span after the first, and M4 would
    be debugging your mock instead of its own code.
    detokenise(): reverse it. Raise Forbidden unless requester_role=="admin".

Each mock carries a one-line header: which module owns it, and "DELETE WHEN
<module> LANDS". When a module lands, the owner removes its ID from
MOCK_MODULES and deletes the mock. Nothing else changes.

POLICY CONTEXT
Building PolicyContext is your job, and it is the step people skip. You
supply all six fields:

  ai_tool_tier,  -> repos.tools.by_host(target_host), falling back to
  tool_status       repos.tools.register(target_host) when unknown. Never a
                    hardcoded dict of hostnames. An unknown host registers
                    silently as PUBLIC_AI/unapproved and does NOT hold (SD-7).

  user_role,     -> repos.users.by_id(req.user_id) -> UserRow.     [CHANGED]
  department        SD-2. NEVER from a header: the extension runs on the
                    employee machine, and our threat model is "an authorised
                    employee using an unauthorised tool". A self-asserted
                    role is a self-issued permission. by_id returns None for
                    an unknown user -> Forbidden -> 403. Do not invent a
                    default: defaulting to "staff" makes an unknown user a
                    valid one.

  purpose,       -> straight from InspectRequest.
  target_host

  content_department is NOT in PolicyContext. Run the DocumentClassifier over
  the concatenated prompt + attachments and store the result on the
  AuditRecord only.

  rules          -> repos.rules.all(), passed into decide(). M3 is pure; you
                    fetch.

GET /v1/tools needs a usage count and no repo method returns one. Stopgap:
page repos.audit.list() and count target_host in Python, with a TODO naming
it a stopgap pending a team decision. At 30 rows this is free. Do not add a
method to a frozen protocol yourself.                            [CHANGED]

THE PIPELINE
The /v1/inspect handler is the only place the pipeline is assembled. Write it
so the order is obvious and each step is one line:
    documents = extract(...)  -> spans = detect(...)  -> classification
    -> ctx = build_context(...)  -> verdict = decide(c, ctx, rules)
    -> maybe tokenise(...)  -> repos.audit.create(...)

Every module resolves through one loader function each, reading MOCK_MODULES.
That is the seam. When M2 lands, its loader returns RulesDetector instead of
MockRulesDetector and no other line moves.

Write the AuditRecord with prompt_text = the REDACTED text when the verdict
is redact (SD-1); the original exists only in the vault. status = "pending"
when the verdict is hold, else "auto".

WIRING: you consume IF-9 (all five repos). You produce IF-2, IF-3 and IF-7.
                                            [CHANGED: was four]
You are the only module that talks to the repository, and the only module
the extension and the dashboard talk to. You hand repos.vault to the
Tokeniser in its constructor; no module ever constructs a repo itself.

BACKBONE FLOWS TO PROVE                                              [NEW]
This is what the mocks are FOR. All five are backbone, all five are mine
end-to-end, and none of them needs M2, M3, M5 or M7 to be real:

  1. allow    clean prompt -> decision=allow, audit row written, visible in
              GET /v1/logs.

  2. deny     "sk-proj-..." -> decision=deny, reason names the class, row
              written. Nothing reaches the LLM.

  3. redact   "880412-08-5561" -> decision=redact, redacted_prompt returned
              to the caller, AuditRecord.prompt_text holds the REDACTED text
              (SD-1), map_id set, vault holds the entries. The original must
              NOT be in the audit row — assert that, it is the SD-1 claim.

  4. hold -> approve -> unblock. THE loop, and the riskiest thing I own:
              "RM 8,500" -> decision=hold, status=pending
              -> GET /v1/logs?status=pending shows it
              -> POST /v1/logs/{id}/decision {approve: true}
              -> GET /v1/inspect/{log_id} now returns status=approved
              The extension polls that last endpoint every 3s and unblocks on
              approved. If this loop is wrong the demo has no climax, and no
              other module can rescue it. Prove it in a test, not by hand.

  5. shadow AI  POST /v1/inspect with target_host="deepseek.com", a host
              configured nowhere -> auto-registered PUBLIC_AI/unapproved, the
              prompt is NOT held (SD-7), and it appears in GET /v1/tools with
              a usage count of 1. This is example use case 2 from the case
              study brief, it is pure backbone, and it is demoable today.

Flows 4 and 5 do not depend on a single other person's module. Get them right
first: they are the two that carry the demo.

DELIVER
- backend/scripts/backbone_smoke.sh: ONE script, REPO_BACKEND=memory, no
  database, no Docker, walking all five flows above and printing each verdict
  and each state transition. This is the artifact that says the backbone
  works, and it is what I run after every merge for the rest of the week.
- pytest over the pipeline with mocks active: one test per verdict, the full
  hold -> approve -> unblock loop as a single test, unknown user -> 403,
  unsupported file -> 415, unknown log_id -> 404.
- A test asserting SD-1: on redact, the original value appears nowhere in the
  AuditRecord.
- A test asserting ENV=demo with a non-empty MOCK_MODULES refuses to start.
```

---

## Notes for whoever runs this

**Don't let it touch M0.** Codex will see `app/repo/` and want to help. Ground
rules 3 and 6 cover it, but "M0 IS BUILT AND TESTED" at the top is what
actually stops it. If it edits `repo/base.py`, reject the diff — five other
sessions are writing against that file.

**Check the diff for two specific cheats.** A role read off a header, and a
hardcoded hostname→tier dict. Both look fine in review and both hollow out the
governance story in front of a judge — they are precisely the gaps the case
study is about.

**Tell M2, M3, M5 and M7's owners the mocks exist**, so they delete rather
than merge with them. A mock that survives into the demo is worse than no
mock. Send them the trigger strings too — if their real modules detect the
same fixtures, `backbone_smoke.sh` keeps passing the moment they land, and
you find integration breaks in seconds rather than on day 4.

**Point M4 and M6 at the real API as soon as this is up.** Both are yours,
and both currently have their own mocks — M4's `MOCK_MODE`, M6's MSW
handlers. Those exist to unblock UI work before a backend exists. Once M1 +
the mock plane is running, that reason is gone: keep them for offline work,
but the integration proof must run against real HTTP. Three mock systems
agreeing with each other proves nothing.

**You can rehearse the demo on mocks with ENV=dev.** The guard only blocks
`ENV=demo`. Rehearse freely; just never record against it.

**Open, decide before day 4:**
1. `Tokeniser` as a class — confirm with M7's owner today. The plan doc
   contradicts itself and neither side finds out until integration.
2. `PolicyContext` / `Verdict` living in `engine.py`, dataclasses by M1, body
   by M3. The alternative is a shared contracts module, which deviates from
   the frozen layout.
3. `AiTool` has no `first_seen`; M6's tools table wants the column.
4. The `/v1/tools` usage count — stopgap works, contract question stands.
