# backend/app/models.py  -- PROVISIONAL. Expect this to change; that is fine.
# Only app/repo/postgres.py imports it, so a change here is a change to two
# mapping functions and nothing else.
#
# Nothing outside backend/app/repo/ may import this file. If you are reading
# this from a detector, the engine, the vault or a router, you are in the
# wrong place: go through the protocols in app/repo/base.py.
#
# SD-6: no indexes beyond the primary and foreign keys, and no Alembic.
# The schema is moving all week; reset_db.py is cheaper than migrations over
# five days. Alembic is the first post-MVP task -- the trigger is not a date,
# it is the hosted database holding data we would mind losing.

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)


class Base(DeclarativeBase):
    pass


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # uuid4
    user_id: Mapped[str] = mapped_column(String(64))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    target_host: Mapped[str] = mapped_column(String(255))
    prompt_text: Mapped[str] = mapped_column(Text)  # full prompt, no truncation -- SD-1
    filename: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # data_classes lives in its own table now                        -- SD-3

    decision: Mapped[str] = mapped_column(String(16))   # allow | redact | hold | deny
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16))     # auto | pending | approved | denied
    purpose: Mapped[str] = mapped_column(String(32), default="GENERAL")
    # What the employee attested (or "GENERAL" for a pass-1 default). M3's
    # state-and-allow rows read the attested purpose back via PolicyContext;
    # this column is what the audit trail proves they actually stated.
    reviewer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    map_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    user_department: Mapped[str | None] = mapped_column(String(32), nullable=True)
    content_department: Mapped[str | None] = mapped_column(String(32), nullable=True)
    department_confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # M10: additive, nullable, no backfill. A hosted database that predates
    # this change needs these columns added by hand (no Alembic here, see
    # SD-6) -- ALTER TABLE audit_logs ADD COLUMN ... for each of the five
    # below, or run reset_db.py if the data is disposable.
    m8_department: Mapped[str | None] = mapped_column(String(32), nullable=True)
    m8_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    m9_department: Mapped[str | None] = mapped_column(String(32), nullable=True)
    m9_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    cross_department_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    # M11: additive, nullable-safe (default 0.0), no backfill needed for the
    # same reason as the M10 batch above -- ALTER TABLE audit_logs ADD COLUMN
    # m9_sensitivity_confidence DOUBLE PRECISION DEFAULT 0.0, or reset_db.py.
    m9_sensitivity_confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # M12: additive, nullable, no backfill -- ALTER TABLE audit_logs ADD
    # COLUMN justification TEXT, or reset_db.py. The employee's free-text
    # explanation from the justification picker, distinct from `purpose`
    # (the category dropdown above).
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)

    # SD-5: everything is retained for now and the MVP runs no purge job.
    # The column exists so the retention story is a schedule we have not
    # switched on yet, rather than a position we are defending. The proposal
    # says: policy enforced by a scheduled purge; field demonstrated in MVP.
    # Not on the DTO -- nothing above the repo reads it yet.
    retention_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    data_classes: Mapped[list["AuditDataClass"]] = relationship(
        back_populates="log",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class AuditDataClass(Base):
    __tablename__ = "audit_data_classes"

    audit_log_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audit_logs.id", ondelete="CASCADE"), primary_key=True
    )
    data_class: Mapped[str] = mapped_column(String(32), primary_key=True)
    # One row per detected class. The DTO above is still list[str];
    # only to_dto()/from_dto() know this table exists.       -- SD-3

    log: Mapped[AuditLog] = relationship(back_populates="data_classes")


class AuditAttachment(Base):
    __tablename__ = "audit_attachments"

    # One per audit record -- AuditRecord.filename is already singular, so
    # this mirrors that rather than supporting multiple files per log entry.
    # Not wired into AuditLog's relationships/eager-loading on purpose: this
    # can be arbitrarily large file content, fetched only when a reviewer
    # actually clicks download, never as part of a routine list/get query.
    audit_log_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("audit_logs.id", ondelete="CASCADE"), primary_key=True
    )
    filename: Mapped[str] = mapped_column(String(512))
    mime: Mapped[str] = mapped_column(String(128))
    content: Mapped[bytes] = mapped_column(LargeBinary)
    # The REDACTED copy whenever redaction happened, or the original bytes
    # unchanged when nothing in it needed redaction -- see save_attachment()
    # call sites in main.py. Never the raw pre-redaction original once
    # something was masked, same SD-1 principle as prompt_text.


class TokenMap(Base):
    __tablename__ = "token_map"

    map_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    token: Mapped[str] = mapped_column(String(64), primary_key=True)  # "[MYKAD_1]"
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)            # Fernet
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # One row per token. Decided, SD-4.
    # This table is the reason storing the full prompt (SD-1) holds up: when
    # decision == "redact", audit_logs holds the redacted text and the only
    # copy of the original is here, encrypted, admin-only, and every read of
    # it writes its own audit row (M7).


class PolicyRule(Base):
    __tablename__ = "policy_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    data_class: Mapped[str] = mapped_column(String(32))
    ai_tool_tier: Mapped[str] = mapped_column(String(32))  # PUBLIC_AI | ENTERPRISE_AI | INTERNAL_AI
    user_role: Mapped[str] = mapped_column(String(32))     # "*" wildcard allowed
    purpose: Mapped[str] = mapped_column(String(32))       # "*" wildcard allowed
    decision: Mapped[str] = mapped_column(String(16))
    min_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    # "*" | "@cross" (content_department set and != ctx.department) | a
    # literal department, matched against Classification.content_department.
    content_department: Mapped[str] = mapped_column(String(32), default="*")
    require_purpose: Mapped[bool] = mapped_column(Boolean, default=False)
    detector: Mapped[str] = mapped_column(String(16), default="*")
    # "*" | "embed" | "deberta". M10: additive, nullable-equivalent via
    # default="*", so existing rows keep their exact current semantics.
    # Seeded from rules.yaml on first run. After that this table is the
    # only source of truth. M3 receives these rows as an argument.


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    role: Mapped[str] = mapped_column(String(16))       # admin | staff
    department: Mapped[str] = mapped_column(String(32)) # finance | hr | legal | engineering
    # Source of truth for role and department. Decided, SD-2.
    # Never a request header: our own threat model is "an authorised employee
    # using an unauthorised tool", and a self-asserted role is a self-issued
    # permission. Production reads this from an IdP claim; that is future work.


class AiToolRow(Base):
    __tablename__ = "ai_tools"

    host: Mapped[str] = mapped_column(String(255), primary_key=True)  # "chatgpt.com"
    tier: Mapped[str] = mapped_column(String(32))    # PUBLIC_AI | ENTERPRISE_AI | INTERNAL_AI
    status: Mapped[str] = mapped_column(String(16))  # approved | unapproved | blocked
    approved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # An unknown host is auto-registered here as PUBLIC_AI / unapproved,
    # silently. Record it, do not hold the prompt. Decided, SD-7.
    # first_seen is not on the AiTool DTO (which is frozen). M6 wants the
    # column; raise it with the team rather than widening base.py here.
