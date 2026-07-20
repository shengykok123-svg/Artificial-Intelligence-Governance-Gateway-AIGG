"""Both backends, one suite.

Every test below runs twice: once against InMemory*, once against Pg*. That
parametrisation IS the deliverable -- it is the proof the abstraction holds,
and it is what makes both the schema and the database swappable later.

Postgres tests use a throwaway database created and dropped per session. If
no server is reachable they skip, so `pytest` passes on a laptop with Docker
switched off. It has to: the whole point of the memory backend is that a
teammate on the API or the dashboard never needs Docker.

    export TEST_DATABASE_URL=postgresql+psycopg://gateway:gateway@localhost:5432/postgres
    pytest
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.repo.memory import (
    InMemoryAuditRepo,
    InMemoryInternalDocRepo,
    InMemoryRuleRepo,
    InMemoryToolRepo,
    InMemoryUserRepo,
    InMemoryVaultRepo,
)

ADMIN_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://gateway:gateway@localhost:5432/postgres",
)


class Bundle:
    def __init__(self, audit, vault, rules, tools, users, internal_docs):
        self.audit, self.vault, self.rules, self.tools = audit, vault, rules, tools
        self.users = users
        self.internal_docs = internal_docs


def seed_users(bundle, rows):
    """UserRepo is read-only on the protocol: users arrive from reset_db.py,
    and from an IdP in production, never from the API. Tests need a way in."""
    if isinstance(bundle.users, InMemoryUserRepo):
        bundle.users._seed(rows)
        return
    from app.models import User
    for r in rows:
        bundle.users.s.add(User(id=r.user_id, role=r.role,
                                department=r.department))
    bundle.users.s.commit()


def seed_rules(bundle, rows):
    """RuleRepo is read-only on the protocol -- rules arrive via reset_db.py,
    not via the API. Tests need a way in, so this is the one place that knows
    how each backend gets its rows."""
    if isinstance(bundle.rules, InMemoryRuleRepo):
        bundle.rules._seed(rows)
        return
    from app.models import PolicyRule
    for r in rows:
        bundle.rules.s.add(PolicyRule(
            data_class=r.data_class, ai_tool_tier=r.ai_tool_tier,
            user_role=r.user_role, purpose=r.purpose, decision=r.decision,
            min_confidence=r.min_confidence,
            content_department=r.content_department,
            require_purpose=r.require_purpose,
            detector=r.detector,
        ))
    bundle.rules.s.commit()


def seed_internal_docs(bundle, rows):
    bundle.internal_docs._seed(rows)


@pytest.fixture(scope="session")
def pg_engine():
    """A throwaway database, created and dropped around the session."""
    dbname = f"gw_test_{uuid.uuid4().hex[:8]}"
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{dbname}"'))
    except Exception as exc:  # no server, wrong creds, whatever
        pytest.skip(f"no postgres for tests: {exc}")

    url = ADMIN_URL.rsplit("/", 1)[0] + f"/{dbname}"
    engine = create_engine(url, pool_pre_ping=True)

    from app.models import Base
    Base.metadata.create_all(engine)
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.execute(text(
                """
                CREATE TABLE IF NOT EXISTS internal_doc_chunks (
                    id VARCHAR(36) PRIMARY KEY,
                    source_file TEXT NOT NULL,
                    department VARCHAR(32) NOT NULL,
                    chunk_text TEXT NOT NULL,
                    embedding vector(384) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            ))
            conn.execute(text(
                """
                CREATE INDEX IF NOT EXISTS ix_internal_doc_chunks_embedding
                ON internal_doc_chunks
                USING hnsw (embedding vector_cosine_ops)
                """
            ))
    except Exception as exc:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)'))
        admin.dispose()
        pytest.skip(f"postgres has no pgvector extension for tests: {exc}")

    yield engine

    engine.dispose()
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture(params=["memory", "postgres"])
def repos(request):
    if request.param == "memory":
        yield Bundle(InMemoryAuditRepo(), InMemoryVaultRepo(),
                     InMemoryRuleRepo(), InMemoryToolRepo(),
                     InMemoryUserRepo(), InMemoryInternalDocRepo())
        return

    engine = request.getfixturevalue("pg_engine")
    from app.models import Base
    from app.repo.postgres import (
        PgAuditRepo,
        PgInternalDocRepo,
        PgRuleRepo,
        PgToolRepo,
        PgUserRepo,
        PgVaultRepo,
    )

    # Truncate between tests so each one starts from the same place the
    # memory backend does. Same starting state or the comparison is a lie.
    with engine.begin() as conn:
        tables = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        conn.execute(text("TRUNCATE internal_doc_chunks"))

    Session = sessionmaker(bind=engine, expire_on_commit=False)
    with Session() as s:
        yield Bundle(PgAuditRepo(s), PgVaultRepo(s), PgRuleRepo(s),
                     PgToolRepo(s), PgUserRepo(s), PgInternalDocRepo(s))
