"""In-memory implementation of IF-9.

Built FIRST and completely, on purpose. This is what unblocks M1, M6 and
every test in the project before a single table exists, and it means nobody
working on the API or the dashboard needs Docker running.

Plain dicts and lists. No SQLAlchemy import anywhere in this file -- if this
module ever needs one, the abstraction has already leaked.
"""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from math import sqrt

from app.repo.base import (
    AiTool,
    AuditRecord,
    InternalDocChunk,
    InternalDocMatch,
    RuleRow,
    StatsSummary,
    TokenEntry,
    UserRow,
)

_TOP_N = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _rank(counter: Counter[str]) -> list[tuple[str, int]]:
    """Count desc, key asc as tie-break, capped. Postgres does the same."""
    return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:_TOP_N]


def _is_cross_department(r: AuditRecord) -> bool:
    """See app/repo/base.py for the definition. Strictly greater than 0.6."""
    return (
        r.content_department is not None
        and r.user_department is not None
        and r.content_department != r.user_department
        and r.department_confidence > 0.6
    )


# --------------------------------------------------------------------------


class InMemoryAuditRepo:
    def __init__(self) -> None:
        self._rows: dict[str, AuditRecord] = {}

    def create(self, rec: AuditRecord) -> str:
        rec = deepcopy(rec)
        rec.log_id = rec.log_id or str(uuid.uuid4())
        # Dedup mirrors the composite PK on audit_data_classes. SD-3.
        rec.data_classes = sorted(set(rec.data_classes))
        self._rows[rec.log_id] = rec
        return rec.log_id

    def get(self, log_id: str) -> AuditRecord | None:
        rec = self._rows.get(log_id)
        return deepcopy(rec) if rec else None

    def list(self, *, limit: int, offset: int,
             status: str | None = None,
             decision: str | None = None,
             cross_department_only: bool = False,
             ) -> tuple[list[AuditRecord], int]:
        rows = list(self._rows.values())
        if status is not None:
            rows = [r for r in rows if r.status == status]
        if decision is not None:
            rows = [r for r in rows if r.decision == decision]
        if cross_department_only:
            # See app/repo/base.py for the definition -- keep this in sync
            # with PgAuditRepo.list's WHERE clause, or the two backends
            # disagree on what "cross-department" means.
            rows = [r for r in rows if _is_cross_department(r)]
        rows.sort(key=lambda r: (r.ts, r.log_id), reverse=True)
        total = len(rows)
        page = [deepcopy(r) for r in rows[offset:offset + limit]]
        return page, total

    def set_decision(self, log_id: str, *, approve: bool,
                     reviewer: str, remark: str) -> AuditRecord:
        rec = self._rows.get(log_id)
        if rec is None:
            raise KeyError(log_id)
        # decision is the verdict the engine reached; it stays. status is the
        # human review outcome. The extension polls IF-3 for status.
        rec.status = "approved" if approve else "denied"
        rec.reviewer = reviewer
        rec.remark = remark
        rec.reviewed_at = _now()
        return deepcopy(rec)

    def stats(self) -> StatsSummary:
        by_decision: Counter[str] = Counter()
        by_day: defaultdict[tuple[str, str], int] = defaultdict(int)
        classes: Counter[str] = Counter()
        users: Counter[str] = Counter()

        for r in self._rows.values():
            by_decision[r.decision] += 1
            by_day[(r.ts.date().isoformat(), r.decision)] += 1
            for dc in set(r.data_classes):
                classes[dc] += 1
            if r.decision != "allow":
                users[r.user_id] += 1

        return StatsSummary(
            by_decision=dict(sorted(by_decision.items())),
            by_day=sorted((d, dec, n) for (d, dec), n in by_day.items()),
            top_data_classes=_rank(classes),
            top_users=_rank(users),
        )


class InMemoryVaultRepo:
    def __init__(self) -> None:
        self._maps: dict[str, list[TokenEntry]] = {}

    def put_map(self, map_id: str, entries: list[TokenEntry]) -> None:
        self._maps[map_id] = deepcopy(entries)

    def get_map(self, map_id: str) -> list[TokenEntry]:
        return deepcopy(self._maps.get(map_id, []))


class InMemoryRuleRepo:
    def __init__(self, rows: list[RuleRow] | None = None) -> None:
        self._rows: list[RuleRow] = deepcopy(rows) if rows else []

    def all(self) -> list[RuleRow]:
        return deepcopy(self._rows)

    # Not part of IF-9. seed.py and the tests use it to load rules.yaml.
    def _seed(self, rows: list[RuleRow]) -> None:
        self._rows = deepcopy(rows)


class InMemoryToolRepo:
    def __init__(self, rows: list[AiTool] | None = None) -> None:
        self._rows: dict[str, AiTool] = {r.host: deepcopy(r) for r in (rows or [])}

    def by_host(self, host: str) -> AiTool | None:
        row = self._rows.get(host)
        return deepcopy(row) if row else None

    def all(self) -> list[AiTool]:
        rows = [deepcopy(r) for r in self._rows.values()]
        # Shadow AI to the top: unapproved and blocked before approved.
        rows.sort(key=lambda t: (t.status == "approved", t.host))
        return rows

    def register(self, host: str) -> AiTool:
        existing = self._rows.get(host)
        if existing is not None:
            return deepcopy(existing)
        # SD-7: an unknown host is auto-registered, silently. Record it,
        # do not hold the prompt. This one method is the shadow-AI story.
        tool = AiTool(host=host, tier="PUBLIC_AI", status="unapproved",
                      approved_by=None, approved_at=None, first_seen=_now())
        self._rows[host] = tool
        return deepcopy(tool)

    # Not part of IF-9. seed.py uses it.
    def _seed(self, rows: list[AiTool]) -> None:
        self._rows = {r.host: deepcopy(r) for r in rows}

    # Not part of IF-9. Used by M6's approve/block handler once M1 wires it;
    # kept off the protocol until the team agrees on it.
    def _set_status(self, host: str, status: str, by: str) -> AiTool:
        tool = self._rows[host]
        tool.status = status
        tool.approved_by = by
        tool.approved_at = _now()
        return deepcopy(tool)


class InMemoryUserRepo:
    def __init__(self, rows: list[UserRow] | None = None) -> None:
        self._rows: dict[str, UserRow] = {r.user_id: deepcopy(r)
                                          for r in (rows or [])}

    def by_id(self, user_id: str) -> UserRow | None:
        row = self._rows.get(user_id)
        return deepcopy(row) if row else None

    # Not part of IF-9. seed.py uses it. Users arrive from reset_db.py (and
    # from an IdP in production), never from the API.
    def _seed(self, rows: list[UserRow]) -> None:
        self._rows = {r.user_id: deepcopy(r) for r in rows}


class InMemoryInternalDocRepo:
    def __init__(self) -> None:
        self._rows: list[tuple[str, str, str, str, list[float], datetime]] = []

    def search_similar(self, embedding: list[float], *, limit: int) -> list[InternalDocMatch]:
        matches: list[InternalDocMatch] = []
        for _id, source_file, department, chunk_text, chunk_embedding, _created_at in self._rows:
            similarity = _cosine_similarity(embedding, chunk_embedding)
            matches.append(InternalDocMatch(
                source_file=source_file,
                department=department,
                chunk_text=chunk_text,
                similarity=similarity,
            ))
        matches.sort(key=lambda match: match.similarity, reverse=True)
        return deepcopy(matches[:limit])

    def add_chunks(self, rows: list[tuple[str, str, list[float]]], *, source_file: str, department: str) -> int:
        now = _now()
        for chunk_id, chunk_text, embedding in rows:
            self._rows.append((chunk_id, source_file, department, chunk_text, embedding, now))
        return len(rows)

    def list(self, *, limit: int, offset: int) -> tuple[list[InternalDocChunk], int]:
        rows = sorted(self._rows, key=lambda row: row[5], reverse=True)
        page = rows[offset:offset + limit]
        return [
            InternalDocChunk(
                id=chunk_id,
                source_file=source_file,
                department=department,
                chunk_text=chunk_text,
                created_at=created_at,
            )
            for chunk_id, source_file, department, chunk_text, _embedding, created_at in page
        ], len(rows)

    def clear_source(self, source_file: str) -> int:
        before = len(self._rows)
        self._rows = [row for row in self._rows if row[1] != source_file]
        return before - len(self._rows)

    # Tests and seed scripts only. The public protocol is read-only.
    def _seed(self, rows: list[tuple[str, str, str, list[float]]]) -> None:
        now = _now()
        self._rows = [
            (str(uuid.uuid4()), source_file, department, chunk_text, embedding, now)
            for source_file, department, chunk_text, embedding in deepcopy(rows)
        ]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = sqrt(sum(a * a for a in left))
    right_norm = sqrt(sum(b * b for b in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return numerator / (left_norm * right_norm)
