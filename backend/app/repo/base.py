"""IF-9 -- the only door to storage.

FROZEN. The ORM tables in models.py behind this are NOT frozen and are
still under discussion. That is exactly why this layer exists: the schema
can change all week, and the database can be swapped, without any other
module noticing.

Nothing else goes in this file. No SQLAlchemy import, no FastAPI import,
no implementation. DTOs and protocols only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


# --------------------------------------------------------------------------
# DTOs
# --------------------------------------------------------------------------

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
    content_department: str | None # from fused classify(). What the prompt
                                   # is about (M8 > M9 > null precedence).
    department_confidence: float
    # The two are orthogonal. user != content is cross-department data
    # contact, and that is the column worth looking at.
    purpose: str = "GENERAL"       # what the employee attested. IF-2's
                                   # purpose, stored verbatim on the record
                                   # that resulted from it.
    justification: str | None = None  # the employee's free-text explanation
                                       # from the justification picker --
                                       # distinct from purpose (the category
                                       # dropdown). Display only.
    m8_department: str | None = None       # raw EmbedDetector.classify() output
    m8_confidence: float = 0.0
    m9_department: str | None = None       # raw DebertaDetector.classify() output
    m9_confidence: float = 0.0             # department-attribution axis only
    m9_sensitivity_confidence: float = 0.0 # confidentiality-severity axis; no M8 equivalent
    cross_department_confidence: float | None = None
    # max(m8_confidence, m9_confidence), set only when the fused
    # content_department is known and differs from user_department.
    # Display/analytics only -- M3 never reads this field.


@dataclass
class TokenEntry:
    token: str                     # "[MYKAD_1]"
    ciphertext: bytes


@dataclass
class AttachmentBlob:
    filename: str
    mime: str
    content_b64: str
    # The file actually attached to an audit record, for later download. This
    # is the REDACTED copy whenever redaction happened (same SD-1 principle
    # as prompt_text: the audit trail never holds the raw original once
    # something needed masking), or the original bytes unchanged when
    # nothing in that attachment needed redaction. One per audit record --
    # AuditRecord.filename is already singular, so this mirrors that.


@dataclass
class RuleRow:
    data_class: str
    ai_tool_tier: str
    user_role: str
    purpose: str
    decision: str
    min_confidence: float = 0.0        # rule matches only if best span
                                       # confidence for this class >= it
    content_department: str = "*"      # "*" | "@cross" | a literal department
    require_purpose: bool = False      # "state & allow" flag
    detector: str = "*"                # "*" | "embed" | "deberta" -- "*" is
                                       # detector-agnostic (existing behaviour);
                                       # "embed"/"deberta" match only spans that
                                       # detector itself emitted for this class.
    id: int | None = None              # None on a fresh/un-persisted row
                                       # (e.g. one built from rules.yaml
                                       # before _seed() assigns it an id).
                                       # decide() never reads this -- it's
                                       # purely a dashboard-editing handle.


@dataclass
class RedactionClassRow:
    # Which data classes M2 (the regex detector) actually redacts. Simpler
    # than RuleRow on purpose -- every entry here only ever does one thing
    # (get redacted), so there's no tier/role/purpose/decision to carry.
    # Seeded with the 7 built-in M2 classes (see seed.py), but fully
    # admin-editable from here on -- decide()'s regex floor only redacts
    # (and only escalates allow -> redact for) a class that's in this list.
    data_class: str
    id: int | None = None


@dataclass
class DetectionPatternRow:
    # A single regex that M2 (RulesDetector) evaluates. Many-to-one with a
    # data class on purpose -- API_KEY already needs two independent
    # patterns today (an "sk-..." key shape and an "..._API_KEY=..." env
    # line), and an admin adding "every way SALARY can be written" is the
    # same shape: several simple rows sharing one data_class, not one
    # hand-written alternation. Seeded from RulesDetector.DEFAULT_PATTERNS
    # (see seed.py); fully admin-editable (including the built-ins) after
    # that -- see PatternRepo below.
    data_class: str
    pattern: str
    remark: str = ""    # free-text note for the admin who added/edited this
                        # pattern -- e.g. why it exists, what it's for.
                        # Never read by RulesDetector/decide(): purely
                        # dashboard-facing documentation.
    sequence: int = 0   # 1-based ordinal WITHIN this data_class, assigned by
                        # the repo at create() (and reassigned at update() if
                        # data_class itself changes) -- combines with
                        # data_class to form the human-readable id shown in
                        # the dashboard, e.g. "MYKAD-00001" (see
                        # main.py's _pattern_dict). Editing the pattern text
                        # or remark alone never moves this. Never read by
                        # RulesDetector/decide() either.
    id: int | None = None

    @property
    def display_id(self) -> str:
        return f"{self.data_class}-{self.sequence:05d}"


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
    first_seen: datetime           # first time this host was ever seen.
                                   # NEVER reset. register() on a known host
                                   # returns it unchanged (SD-7) -- this field
                                   # is the "first seen" in shadow-AI
                                   # discovery, and moving it erases the story.
    visit_count: int = 0           # extension-detected network activity on
                                   # this host (see ToolRepo.record_visit),
                                   # DISTINCT from the audit-derived
                                   # usage_count main.py computes for hosts
                                   # that actually went through /v1/inspect.
                                   # A host only ever accumulates one or the
                                   # other in practice: chatgpt.com/
                                   # gemini.google.com get real usage_count,
                                   # everything else gets visit_count.


@dataclass
class UserRow:
    user_id: str
    role: str                      # admin | staff
    department: str                # finance | hr | legal | engineering
    # SD-2: the users table is the source of truth for role and department.
    # Never a request header. The extension runs on the employee machine and
    # our own threat model is "an authorised employee using an unauthorised
    # tool" -- a self-asserted role is a self-issued permission.
    # Production reads this from an IdP claim. Future work.


@dataclass
class InternalDocMatch:
    source_file: str
    department: str
    chunk_text: str
    similarity: float
    # M8 pgvector retrieval result. The raw embedding never leaves the repo.


@dataclass
class InternalDocChunk:
    id: str
    source_file: str
    department: str
    chunk_text: str
    created_at: datetime
    # Stored internal-document chunk. The raw embedding is intentionally not
    # returned through API/debug surfaces.


# --------------------------------------------------------------------------
# Protocols
# --------------------------------------------------------------------------

class AuditRepo(Protocol):
    def create(self, rec: AuditRecord) -> str: ...
    def get(self, log_id: str) -> AuditRecord | None: ...
    def list(self, *, limit: int, offset: int,
             status: str | None = None,
             decision: str | None = None,
             cross_department_only: bool = False,
             ) -> tuple[list[AuditRecord], int]: ...
    def set_decision(self, log_id: str, *, approve: bool,
                     reviewer: str, remark: str) -> AuditRecord: ...
    def update_pending(self, log_id: str, rec: AuditRecord) -> AuditRecord | None: ...
    def save_attachment(self, log_id: str, blob: AttachmentBlob) -> None: ...
    def get_attachment(self, log_id: str) -> AttachmentBlob | None: ...
    # "State & allow" pass 2: overwrite a still-pending record's content
    # fields in place (log_id, ts, and review-lifecycle fields untouched) --
    # None if the record is gone or already reviewed, so the caller falls
    # back to create() rather than losing the resubmission.
    def stats(self) -> StatsSummary: ...


class VaultRepo(Protocol):
    def put_map(self, map_id: str, entries: list[TokenEntry]) -> None: ...
    def get_map(self, map_id: str) -> list[TokenEntry]: ...


class RuleRepo(Protocol):
    def all(self) -> list[RuleRow]: ...
    def create(self, row: RuleRow) -> RuleRow: ...  # id on input ignored, fresh id assigned
    def update(self, rule_id: int, row: RuleRow) -> RuleRow | None: ...  # None if unknown id
    def delete(self, rule_id: int) -> bool: ...  # False if unknown id


class RedactionRepo(Protocol):
    def all(self) -> list[RedactionClassRow]: ...
    def create(self, row: RedactionClassRow) -> RedactionClassRow: ...  # duplicate data_class -> existing row, not a new one
    def delete(self, row_id: int) -> bool: ...  # False if unknown id


class PatternRepo(Protocol):
    def all(self) -> list[DetectionPatternRow]: ...
    def create(self, row: DetectionPatternRow) -> DetectionPatternRow: ...  # id on input ignored, fresh id assigned
    def update(self, pattern_id: int, row: DetectionPatternRow) -> DetectionPatternRow | None: ...  # None if unknown id
    def delete(self, pattern_id: int) -> bool: ...  # False if unknown id


class ToolRepo(Protocol):
    def by_host(self, host: str) -> AiTool | None: ...
    def all(self) -> list[AiTool]: ...
    def register(self, host: str) -> AiTool: ...  # unknown host, unapproved
    def record_visit(self, host: str) -> AiTool: ...  # get-or-create, +1 visit_count


class UserRepo(Protocol):
    def by_id(self, user_id: str) -> UserRow | None: ...
    # Added day 1, agreed by the team. M1's prompt requires role and
    # department "from the users table, keyed by user_id" (SD-2), and ground
    # rule 6 forbids M1 from opening a Session -- so without this protocol
    # there was data but no door.
    #
    # One method on purpose. No screen in M6 lists users and the dashboard
    # login is hardcoded, so all() would be speculative. Adding a method to
    # a Protocol later is additive and breaks no caller; the only two
    # implementations are in this package.


class InternalDocRepo(Protocol):
    def search_similar(self, embedding: list[float], *, limit: int) -> list[InternalDocMatch]: ...
    def add_chunks(self, rows: list[tuple[str, str, list[float]]], *, source_file: str, department: str) -> int: ...
    def list(self, *, limit: int, offset: int) -> tuple[list[InternalDocChunk], int]: ...
    def clear_source(self, source_file: str) -> int: ...


# --------------------------------------------------------------------------
# Behaviour both implementations must agree on. Written here rather than in
# a docstring on one implementation, because the pytest suite asserts these
# against BOTH backends and this file is the contract.
# --------------------------------------------------------------------------
#
# AuditRepo.create      empty log_id -> a uuid4 is assigned and returned.
#                       data_classes is deduplicated; order is not preserved
#                       on read back (it is a set of classes, not a sequence).
# AuditRepo.get         unknown log_id -> None, never an exception.
# AuditRepo.list        newest first (ts desc, log_id desc as tie-break).
#                       Returns (page, total_matching_filters) -- total is the
#                       count BEFORE limit/offset, so the dashboard can page.
#                       cross_department_only=True additionally requires:
#                           content_department IS NOT NULL
#                           AND user_department IS NOT NULL
#                           AND content_department != user_department
#                           AND department_confidence > 0.6
#                       Strictly greater than 0.6 -- exactly 0.6 is NOT
#                       cross-department; M6 renders it muted and unbadged,
#                       because below the threshold the label is noise and
#                       badging it would be a claim we cannot support.
#                       Composes with status/decision as AND, not OR. Applied
#                       BEFORE the count: total is the number of rows matching
#                       ALL filters including this one, never the page size.
# AuditRepo.set_decision
#                       status -> "approved" | "denied". decision is NOT
#                       touched: the verdict is a historical fact, the review
#                       outcome is status. IF-3 gives the extension both.
#                       unknown log_id -> KeyError.
# AuditRepo.stats       top_data_classes / top_users: count desc, then key
#                       asc as tie-break, capped at 10.
#                       top_users counts RISK events only (decision != allow);
#                       M6 labels that column "top users by risk events".
#                       by_day ordered by date asc, then decision asc.
# VaultRepo.put_map     replaces the entries for that map_id.
# ToolRepo.register     known host -> returned unchanged, NOT reset to
#                       unapproved. Unknown host -> PUBLIC_AI / unapproved.
#                       SD-7: record it, never hold on account of it.
#                       first_seen: set once, on first registration, and
#                       never moved after -- a known host's re-registration
#                       (which happens on every single prompt to that host)
#                       returns first_seen unchanged. This is what makes the
#                       column mean "first" rather than "last".
# ToolRepo.all          unapproved and blocked first, then host asc. M6 wants
#                       the shadow AI at the top of the table.
# ToolRepo.record_visit unknown host -> created exactly like register()
#                       (PUBLIC_AI/unapproved) with visit_count=1. Known
#                       host -> visit_count += 1, nothing else touched: not
#                       status, not first_seen. This is the extension's
#                       passive network-activity detector (no prompt, no
#                       decide() call, no audit row) -- register() stays the
#                       path /v1/inspect uses for a real inspected request.
# UserRepo.by_id        unknown user_id -> None, never an exception. What M1
#                       does about an unknown user is M1's call and belongs
#                       in the API, not here: this layer stores records and
#                       does not know what a prompt is.
# InternalDocRepo.search_similar
#                       newest ingestion order is irrelevant: returns nearest
#                       chunks by embedding similarity descending, capped by
#                       limit. pgvector absence is an environment failure for
#                       the PostgreSQL backend, not a silent semantic fallback.
# InternalDocRepo.add_chunks
#                       rows are (chunk_id, chunk_text, embedding). Replaces
#                       are explicit: callers must clear_source first if they
#                       want one uploaded source to replace another.
# InternalDocRepo.list  newest first for dashboard/debug visibility.
# InternalDocRepo.clear_source
#                       deletes all chunks for an uploaded source_file and
#                       returns the number of removed chunks.
# RuleRepo.create        id on the input row is ignored; a fresh id is
#                       assigned (memory: next in-process counter; postgres:
#                       the table's SERIAL). Returned row carries that id.
# RuleRepo.update        unknown rule_id -> None, never an exception. id, if
#                       present on the input row, is ignored -- the id
#                       always comes from rule_id, not the row body.
# RuleRepo.delete        unknown rule_id -> False. Known -> True, row gone.
#                       decide() is never told about any of this: it reads
#                       whatever RuleRepo.all() returns fresh on every
#                       /v1/inspect call, so a dashboard edit is live
#                       immediately, no cache, no restart.
# RedactionRepo.create   a duplicate data_class (exact match) returns the
#                       EXISTING row, not a new one -- same idempotency as
#                       ToolRepo.register on a known host. No dedicated
#                       "update": a one-field row is deleted and re-added,
#                       not edited in place.
# RedactionRepo.delete   unknown row_id -> False. Known -> True, row gone.
#                       Same live-immediately guarantee as RuleRepo: /v1/
#                       inspect reads RedactionRepo.all() fresh every call.
# PatternRepo.create     id on the input row is ignored; a fresh id is
#                       assigned. Unlike RedactionRepo, NOT deduplicated on
#                       data_class -- many patterns legitimately share one
#                       class (API_KEY already has two built in). sequence on
#                       the input is ignored too -- the repo assigns the
#                       next ordinal within that data_class (existing max + 1).
# PatternRepo.update     unknown pattern_id -> None, never an exception.
#                       Can change both data_class and pattern on a row --
#                       this is how a built-in pattern gets edited, not just
#                       replaced. sequence is kept unchanged if data_class is
#                       unchanged; if data_class DOES change, a fresh
#                       sequence is assigned within the new class (so the
#                       display id never collides with an existing row
#                       already in that class).
# PatternRepo.delete     unknown pattern_id -> False. Known -> True, row
#                       gone. Does NOT touch RedactionRepo -- deleting one
#                       of a class's several patterns (or its only one)
#                       never silently removes it from the redact list.
#                       /v1/inspect reads PatternRepo.all() fresh every
#                       call, same live-immediately guarantee as the others.

__all__ = [
    "AuditRecord", "TokenEntry", "RuleRow", "RedactionClassRow",
    "DetectionPatternRow", "StatsSummary",
    "AiTool", "UserRow", "InternalDocMatch", "InternalDocChunk",
    "AuditRepo", "VaultRepo", "RuleRepo", "RedactionRepo", "PatternRepo",
    "ToolRepo", "UserRepo", "InternalDocRepo",
]
