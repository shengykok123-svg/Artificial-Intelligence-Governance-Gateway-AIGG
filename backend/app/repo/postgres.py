"""PostgreSQL implementation of IF-9.

to_dto() and from_dto() are the ONLY place the physical schema is visible.
When the schema changes -- and it will, all week -- only these functions
change. That is the whole trade this layer buys us.
"""

from __future__ import annotations

import base64
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AiToolRow,
    AuditAttachment,
    AuditDataClass,
    AuditLog,
    DetectionPattern,
    PolicyRule,
    RedactionClass,
    TokenMap,
    User,
)
from app.repo.base import (
    AiTool,
    AttachmentBlob,
    AuditRecord,
    DetectionPatternRow,
    InternalDocChunk,
    InternalDocMatch,
    RedactionClassRow,
    RuleRow,
    StatsSummary,
    TokenEntry,
    UserRow,
)

_TOP_N = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# Mapping. The schema is visible here and nowhere else.
# --------------------------------------------------------------------------

def _audit_to_dto(row: AuditLog) -> AuditRecord:
    return AuditRecord(
        log_id=row.id,
        user_id=row.user_id,
        ts=row.ts,
        target_host=row.target_host,
        prompt_text=row.prompt_text,
        filename=row.filename,
        # SD-3: N rows collapse back into one list[str]. Nothing above the
        # repo knows this is a join.
        data_classes=sorted(dc.data_class for dc in row.data_classes),
        decision=row.decision,
        reason=row.reason,
        status=row.status,
        reviewer=row.reviewer,
        reviewed_at=row.reviewed_at,
        remark=row.remark,
        map_id=row.map_id,
        user_department=row.user_department,
        content_department=row.content_department,
        department_confidence=row.department_confidence,
        purpose=row.purpose,
        justification=row.justification,
        m8_department=row.m8_department,
        m8_confidence=row.m8_confidence,
        m9_department=row.m9_department,
        m9_confidence=row.m9_confidence,
        m9_sensitivity_confidence=row.m9_sensitivity_confidence,
        cross_department_confidence=row.cross_department_confidence,
    )


def _audit_from_dto(rec: AuditRecord) -> AuditLog:
    row = AuditLog(
        id=rec.log_id,
        user_id=rec.user_id,
        ts=rec.ts,
        target_host=rec.target_host,
        prompt_text=rec.prompt_text,
        filename=rec.filename,
        decision=rec.decision,
        reason=rec.reason,
        status=rec.status,
        reviewer=rec.reviewer,
        reviewed_at=rec.reviewed_at,
        remark=rec.remark,
        map_id=rec.map_id,
        user_department=rec.user_department,
        content_department=rec.content_department,
        department_confidence=rec.department_confidence,
        purpose=rec.purpose,
        justification=rec.justification,
        m8_department=rec.m8_department,
        m8_confidence=rec.m8_confidence,
        m9_department=rec.m9_department,
        m9_confidence=rec.m9_confidence,
        m9_sensitivity_confidence=rec.m9_sensitivity_confidence,
        cross_department_confidence=rec.cross_department_confidence,
        retention_until=None,  # SD-5: no purge job in the MVP.
    )
    # SD-3: one list[str] fans out into N rows.
    row.data_classes = [
        AuditDataClass(audit_log_id=rec.log_id, data_class=dc)
        for dc in sorted(set(rec.data_classes))
    ]
    return row


def _tool_to_dto(row: AiToolRow) -> AiTool:
    return AiTool(
        host=row.host,
        tier=row.tier,
        status=row.status,
        approved_by=row.approved_by,
        approved_at=row.approved_at,
        first_seen=row.first_seen,
        visit_count=row.visit_count,
    )


def _user_to_dto(row: User) -> UserRow:
    return UserRow(
        user_id=row.id,
        role=row.role,
        department=row.department,
    )


def _rule_to_dto(row: PolicyRule) -> RuleRow:
    return RuleRow(
        data_class=row.data_class,
        ai_tool_tier=row.ai_tool_tier,
        user_role=row.user_role,
        purpose=row.purpose,
        decision=row.decision,
        min_confidence=row.min_confidence,
        content_department=row.content_department,
        require_purpose=row.require_purpose,
        detector=row.detector,
        id=row.id,
    )


def _redaction_class_to_dto(row: RedactionClass) -> RedactionClassRow:
    return RedactionClassRow(data_class=row.data_class, id=row.id)


def _pattern_to_dto(row: DetectionPattern) -> DetectionPatternRow:
    return DetectionPatternRow(
        data_class=row.data_class, pattern=row.pattern, remark=row.remark,
        sequence=row.sequence, id=row.id,
    )


# --------------------------------------------------------------------------


class PgAuditRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def create(self, rec: AuditRecord) -> str:
        log_id = rec.log_id or str(uuid.uuid4())
        rec.log_id = log_id
        self.s.add(_audit_from_dto(rec))
        self.s.commit()
        return log_id

    def get(self, log_id: str) -> AuditRecord | None:
        row = self.s.get(
            AuditLog, log_id, options=[selectinload(AuditLog.data_classes)]
        )
        return _audit_to_dto(row) if row else None

    def list(self, *, limit: int, offset: int,
             status: str | None = None,
             decision: str | None = None,
             cross_department_only: bool = False,
             ) -> tuple[list[AuditRecord], int]:
        filters = []
        if status is not None:
            filters.append(AuditLog.status == status)
        if decision is not None:
            filters.append(AuditLog.decision == decision)
        if cross_department_only:
            # See app/repo/base.py for the definition -- keep this in sync
            # with InMemoryAuditRepo.list's _is_cross_department, or the two
            # backends disagree on what "cross-department" means. In the
            # same where() as the other filters, not a post-query Python
            # filter: total has to reflect this BEFORE limit/offset.
            filters += [
                AuditLog.content_department.is_not(None),
                AuditLog.user_department.is_not(None),
                AuditLog.content_department != AuditLog.user_department,
                AuditLog.department_confidence > 0.6,
            ]

        total = self.s.scalar(
            select(func.count()).select_from(AuditLog).where(*filters)
        ) or 0

        # selectinload: 50 logs is two queries, not fifty-one.
        stmt = (
            select(AuditLog)
            .where(*filters)
            .options(selectinload(AuditLog.data_classes))
            .order_by(AuditLog.ts.desc(), AuditLog.id.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = self.s.scalars(stmt).all()
        return [_audit_to_dto(r) for r in rows], total

    def set_decision(self, log_id: str, *, approve: bool,
                     reviewer: str, remark: str) -> AuditRecord:
        row = self.s.get(
            AuditLog, log_id, options=[selectinload(AuditLog.data_classes)]
        )
        if row is None:
            raise KeyError(log_id)
        # decision is the verdict the engine reached; it stays. status is the
        # human review outcome. The extension polls IF-3 for status.
        row.status = "approved" if approve else "denied"
        row.reviewer = reviewer
        row.remark = remark
        row.reviewed_at = _now()
        self.s.commit()
        self.s.refresh(row)
        return _audit_to_dto(row)

    def update_pending(self, log_id: str, rec: AuditRecord) -> AuditRecord | None:
        row = self.s.get(
            AuditLog, log_id, options=[selectinload(AuditLog.data_classes)]
        )
        if row is None or row.status != "pending":
            return None
        row.prompt_text = rec.prompt_text
        row.filename = rec.filename
        row.decision = rec.decision
        row.reason = rec.reason
        row.map_id = rec.map_id
        row.user_department = rec.user_department
        row.content_department = rec.content_department
        row.department_confidence = rec.department_confidence
        row.purpose = rec.purpose
        row.justification = rec.justification
        row.m8_department = rec.m8_department
        row.m8_confidence = rec.m8_confidence
        row.m9_department = rec.m9_department
        row.m9_confidence = rec.m9_confidence
        row.m9_sensitivity_confidence = rec.m9_sensitivity_confidence
        row.cross_department_confidence = rec.cross_department_confidence
        row.data_classes = [
            AuditDataClass(audit_log_id=log_id, data_class=dc)
            for dc in sorted(set(rec.data_classes))
        ]
        self.s.commit()
        self.s.refresh(row)
        return _audit_to_dto(row)

    def save_attachment(self, log_id: str, blob: AttachmentBlob) -> None:
        content = base64.b64decode(blob.content_b64)
        existing = self.s.get(AuditAttachment, log_id)
        if existing is not None:
            existing.filename = blob.filename
            existing.mime = blob.mime
            existing.content = content
        else:
            self.s.add(AuditAttachment(
                audit_log_id=log_id, filename=blob.filename, mime=blob.mime, content=content,
            ))
        self.s.commit()

    def get_attachment(self, log_id: str) -> AttachmentBlob | None:
        row = self.s.get(AuditAttachment, log_id)
        if row is None:
            return None
        return AttachmentBlob(
            filename=row.filename, mime=row.mime,
            content_b64=base64.b64encode(row.content).decode("ascii"),
        )

    def stats(self) -> StatsSummary:
        """Aggregated in SQL, not in Python. M6 polls this every 3 seconds."""
        by_decision = {
            d: n for d, n in self.s.execute(
                select(AuditLog.decision, func.count())
                .group_by(AuditLog.decision)
                .order_by(AuditLog.decision)
            ).all()
        }

        day = func.date_trunc("day", AuditLog.ts).label("day")
        by_day = [
            (d.date().isoformat(), dec, n)
            for d, dec, n in self.s.execute(
                select(day, AuditLog.decision, func.count())
                .group_by(day, AuditLog.decision)
                .order_by(day, AuditLog.decision)
            ).all()
        ]

        # SD-3 pays off here: a plain JOIN instead of jsonb_array_elements_text.
        cnt = func.count().label("n")
        top_data_classes = [
            (dc, n) for dc, n in self.s.execute(
                select(AuditDataClass.data_class, cnt)
                .join(AuditLog, AuditLog.id == AuditDataClass.audit_log_id)
                .group_by(AuditDataClass.data_class)
                .order_by(cnt.desc(), AuditDataClass.data_class.asc())
                .limit(_TOP_N)
            ).all()
        ]

        # "Top users by risk events" -- allow is not an event worth ranking.
        top_users = [
            (u, n) for u, n in self.s.execute(
                select(AuditLog.user_id, cnt)
                .where(AuditLog.decision != "allow")
                .group_by(AuditLog.user_id)
                .order_by(cnt.desc(), AuditLog.user_id.asc())
                .limit(_TOP_N)
            ).all()
        ]

        return StatsSummary(
            by_decision=by_decision,
            by_day=by_day,
            top_data_classes=top_data_classes,
            top_users=top_users,
        )


class PgVaultRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def put_map(self, map_id: str, entries: list[TokenEntry]) -> None:
        # Replace: put_map owns the whole map, one row per token. SD-4.
        self.s.execute(delete(TokenMap).where(TokenMap.map_id == map_id))
        now = _now()
        for e in entries:
            self.s.add(TokenMap(map_id=map_id, token=e.token,
                                ciphertext=e.ciphertext, created_at=now))
        self.s.commit()

    def get_map(self, map_id: str) -> list[TokenEntry]:
        rows = self.s.scalars(
            select(TokenMap).where(TokenMap.map_id == map_id)
            .order_by(TokenMap.token)
        ).all()
        return [TokenEntry(token=r.token, ciphertext=bytes(r.ciphertext))
                for r in rows]


class PgRuleRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def all(self) -> list[RuleRow]:
        rows = self.s.scalars(
            select(PolicyRule).order_by(PolicyRule.id)
        ).all()
        return [_rule_to_dto(r) for r in rows]

    def create(self, row: RuleRow) -> RuleRow:
        db_row = PolicyRule(
            data_class=row.data_class, ai_tool_tier=row.ai_tool_tier,
            user_role=row.user_role, purpose=row.purpose, decision=row.decision,
            min_confidence=row.min_confidence,
            content_department=row.content_department,
            require_purpose=row.require_purpose, detector=row.detector,
        )
        self.s.add(db_row)
        self.s.commit()
        self.s.refresh(db_row)
        return _rule_to_dto(db_row)

    def update(self, rule_id: int, row: RuleRow) -> RuleRow | None:
        db_row = self.s.get(PolicyRule, rule_id)
        if db_row is None:
            return None
        db_row.data_class = row.data_class
        db_row.ai_tool_tier = row.ai_tool_tier
        db_row.user_role = row.user_role
        db_row.purpose = row.purpose
        db_row.decision = row.decision
        db_row.min_confidence = row.min_confidence
        db_row.content_department = row.content_department
        db_row.require_purpose = row.require_purpose
        db_row.detector = row.detector
        self.s.commit()
        self.s.refresh(db_row)
        return _rule_to_dto(db_row)

    def delete(self, rule_id: int) -> bool:
        db_row = self.s.get(PolicyRule, rule_id)
        if db_row is None:
            return False
        self.s.delete(db_row)
        self.s.commit()
        return True


class PgRedactionRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def all(self) -> list[RedactionClassRow]:
        rows = self.s.scalars(
            select(RedactionClass).order_by(RedactionClass.id)
        ).all()
        return [_redaction_class_to_dto(r) for r in rows]

    def create(self, row: RedactionClassRow) -> RedactionClassRow:
        existing = self.s.scalars(
            select(RedactionClass).where(RedactionClass.data_class == row.data_class)
        ).first()
        if existing is not None:
            return _redaction_class_to_dto(existing)
        db_row = RedactionClass(data_class=row.data_class)
        self.s.add(db_row)
        self.s.commit()
        self.s.refresh(db_row)
        return _redaction_class_to_dto(db_row)

    def delete(self, row_id: int) -> bool:
        db_row = self.s.get(RedactionClass, row_id)
        if db_row is None:
            return False
        self.s.delete(db_row)
        self.s.commit()
        return True


class PgPatternRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def all(self) -> list[DetectionPatternRow]:
        rows = self.s.scalars(
            select(DetectionPattern).order_by(DetectionPattern.id)
        ).all()
        return [_pattern_to_dto(r) for r in rows]

    def _next_sequence_for(self, data_class: str) -> int:
        max_seq = self.s.scalar(
            select(func.max(DetectionPattern.sequence)).where(DetectionPattern.data_class == data_class)
        )
        return (max_seq or 0) + 1

    def create(self, row: DetectionPatternRow) -> DetectionPatternRow:
        db_row = DetectionPattern(
            data_class=row.data_class, pattern=row.pattern, remark=row.remark,
            sequence=self._next_sequence_for(row.data_class),
        )
        self.s.add(db_row)
        self.s.commit()
        self.s.refresh(db_row)
        return _pattern_to_dto(db_row)

    def update(self, pattern_id: int, row: DetectionPatternRow) -> DetectionPatternRow | None:
        db_row = self.s.get(DetectionPattern, pattern_id)
        if db_row is None:
            return None
        if row.data_class != db_row.data_class:
            db_row.sequence = self._next_sequence_for(row.data_class)
        db_row.data_class = row.data_class
        db_row.pattern = row.pattern
        db_row.remark = row.remark
        self.s.commit()
        self.s.refresh(db_row)
        return _pattern_to_dto(db_row)

    def delete(self, pattern_id: int) -> bool:
        db_row = self.s.get(DetectionPattern, pattern_id)
        if db_row is None:
            return False
        self.s.delete(db_row)
        self.s.commit()
        return True


class PgToolRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def by_host(self, host: str) -> AiTool | None:
        row = self.s.get(AiToolRow, host)
        return _tool_to_dto(row) if row else None

    def all(self) -> list[AiTool]:
        rows = self.s.scalars(
            select(AiToolRow).order_by(
                # Shadow AI to the top of M6's table.
                (AiToolRow.status == "approved").asc(),
                AiToolRow.host.asc(),
            )
        ).all()
        return [_tool_to_dto(r) for r in rows]

    def register(self, host: str) -> AiTool:
        row = self.s.get(AiToolRow, host)
        if row is not None:
            return _tool_to_dto(row)
        # SD-7: silent auto-registration. Nobody configured this in advance;
        # it appears in the dashboard the first time somebody uses it.
        row = AiToolRow(host=host, tier="PUBLIC_AI", status="unapproved",
                        approved_by=None, approved_at=None, first_seen=_now())
        self.s.add(row)
        self.s.commit()
        return _tool_to_dto(row)

    def record_visit(self, host: str) -> AiTool:
        row = self.s.get(AiToolRow, host)
        if row is None:
            row = AiToolRow(host=host, tier="PUBLIC_AI", status="unapproved",
                            approved_by=None, approved_at=None, first_seen=_now(),
                            visit_count=0)
            self.s.add(row)
        row.visit_count = (row.visit_count or 0) + 1
        self.s.commit()
        return _tool_to_dto(row)

    # Not part of IF-9 -- see the note in memory.py.
    def _set_status(self, host: str, status: str, by: str) -> AiTool:
        row = self.s.get(AiToolRow, host)
        if row is None:
            raise KeyError(host)
        row.status = status
        row.approved_by = by
        row.approved_at = _now()
        self.s.commit()
        return _tool_to_dto(row)


class PgUserRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def by_id(self, user_id: str) -> UserRow | None:
        row = self.s.get(User, user_id)
        return _user_to_dto(row) if row else None


class PgInternalDocRepo:
    def __init__(self, session: Session) -> None:
        self.s = session

    def search_similar(self, embedding: list[float], *, limit: int) -> list[InternalDocMatch]:
        if not embedding:
            return []
        rows = self.s.execute(
            text(
                """
                SELECT source_file, department, chunk_text,
                       1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
                FROM internal_doc_chunks
                ORDER BY embedding <=> CAST(:embedding AS vector)
                LIMIT :limit
                """
            ),
            {"embedding": _vector_literal(embedding), "limit": limit},
        ).all()
        return [
            InternalDocMatch(
                source_file=row.source_file,
                department=row.department,
                chunk_text=row.chunk_text,
                similarity=float(row.similarity),
            )
            for row in rows
        ]

    def add_chunks(self, rows: list[tuple[str, str, list[float]]], *, source_file: str, department: str) -> int:
        for chunk_id, chunk_text, embedding in rows:
            self.s.execute(
                text(
                    """
                    INSERT INTO internal_doc_chunks
                        (id, source_file, department, chunk_text, embedding)
                    VALUES
                        (:id, :source_file, :department, :chunk_text, CAST(:embedding AS vector))
                    """
                ),
                {
                    "id": chunk_id,
                    "source_file": source_file,
                    "department": department,
                    "chunk_text": chunk_text,
                    "embedding": _vector_literal(embedding),
                },
            )
        self.s.commit()
        return len(rows)

    def list(self, *, limit: int, offset: int) -> tuple[list[InternalDocChunk], int]:
        total = self.s.scalar(
            text("SELECT count(*) FROM internal_doc_chunks")
        ) or 0
        rows = self.s.execute(
            text(
                """
                SELECT id, source_file, department, chunk_text, created_at
                FROM internal_doc_chunks
                ORDER BY created_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"limit": limit, "offset": offset},
        ).all()
        return [
            InternalDocChunk(
                id=row.id,
                source_file=row.source_file,
                department=row.department,
                chunk_text=row.chunk_text,
                created_at=row.created_at,
            )
            for row in rows
        ], int(total)

    def clear_source(self, source_file: str) -> int:
        result = self.s.execute(
            text("DELETE FROM internal_doc_chunks WHERE source_file = :source_file"),
            {"source_file": source_file},
        )
        self.s.commit()
        return int(result.rowcount or 0)

    # Tests and seed scripts only. The public protocol is read-only.
    def _seed(self, rows: list[tuple[str, str, str, list[float]]]) -> None:
        for source_file, department, chunk_text, embedding in rows:
            self.add_chunks(
                [(str(uuid.uuid4()), chunk_text, embedding)],
                source_file=source_file,
                department=department,
            )


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{float(value):.9g}" for value in values) + "]"
