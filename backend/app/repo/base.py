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
    first_seen: datetime           # first time this host was ever seen.
                                   # NEVER reset. register() on a known host
                                   # returns it unchanged (SD-7) -- this field
                                   # is the "first seen" in shadow-AI
                                   # discovery, and moving it erases the story.


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

__all__ = [
    "AuditRecord", "TokenEntry", "RuleRow", "StatsSummary", "AiTool", "UserRow",
    "InternalDocMatch", "InternalDocChunk",
    "AuditRepo", "VaultRepo", "RuleRepo", "ToolRepo", "UserRepo", "InternalDocRepo",
]
