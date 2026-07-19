"""The only door to storage.

M1 depends on get_repos() and on nothing else in this package. No module
outside backend/app/repo/ may import app/models.py, open a Session, or write
SQL. That rule is what lets the physical schema stay undecided while the
rest of the backend is built against it.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends
from sqlalchemy.orm import Session

from app import db
from app.repo.base import AuditRepo, InternalDocRepo, RuleRepo, ToolRepo, UserRepo, VaultRepo
from app.repo.memory import (
    InMemoryAuditRepo,
    InMemoryInternalDocRepo,
    InMemoryRuleRepo,
    InMemoryToolRepo,
    InMemoryUserRepo,
    InMemoryVaultRepo,
)


@dataclass
class Repos:
    """The bundle M1 injects. M1 hands `vault` to M7 in its constructor;
    no module ever constructs a repo itself."""
    audit: AuditRepo
    vault: VaultRepo
    rules: RuleRepo
    tools: ToolRepo
    users: UserRepo   # SD-2. M1 keys role and department off user_id.
    internal_docs: InternalDocRepo


# Process-wide singletons for the memory backend: the state has to survive
# between requests, so these cannot be built per-dependency-call.
_memory_repos: Repos | None = None


def memory_repos() -> Repos:
    global _memory_repos
    if _memory_repos is None:
        _memory_repos = Repos(
            audit=InMemoryAuditRepo(),
            vault=InMemoryVaultRepo(),
            rules=InMemoryRuleRepo(),
            tools=InMemoryToolRepo(),
            users=InMemoryUserRepo(),
            internal_docs=InMemoryInternalDocRepo(),
        )
        from app.seed import seed_memory  # local import: seed imports us
        seed_memory(_memory_repos)
    return _memory_repos


def reset_memory_repos() -> None:
    """Tests only."""
    global _memory_repos
    _memory_repos = None


def get_repos(session: Session | None = Depends(db.get_session)) -> Repos:
    if db.REPO_BACKEND == "postgres":
        assert session is not None
        from app.repo.postgres import (
            PgAuditRepo,
            PgInternalDocRepo,
            PgRuleRepo,
            PgToolRepo,
            PgUserRepo,
            PgVaultRepo,
        )
        return Repos(
            audit=PgAuditRepo(session),
            vault=PgVaultRepo(session),
            rules=PgRuleRepo(session),
            tools=PgToolRepo(session),
            users=PgUserRepo(session),
            internal_docs=PgInternalDocRepo(session),
        )
    return memory_repos()


__all__ = ["Repos", "get_repos", "memory_repos", "reset_memory_repos"]
