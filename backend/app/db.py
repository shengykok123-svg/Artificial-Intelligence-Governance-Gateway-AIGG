"""Engine and session. One DATABASE_URL drives local and hosted alike --
the code never knows which one it is talking to. That is why the hosted
prototype link is a config change and not a project.

NO ALEMBIC. The schema is moving all week and reset_db.py is cheaper than
migrations over five days (SD-6). Alembic is the first post-MVP task: the
trigger is not 22 July, it is the hosted database starting to hold data we
would mind losing.
"""

from __future__ import annotations

import os
from typing import Iterator

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()

# psycopg 3. Local and hosted differ by this string and nothing else.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://gateway:gateway@localhost:5432/gateway",
)

# "memory" | "postgres". Default memory so a teammate can work on the API or
# the dashboard without Docker running.
REPO_BACKEND = os.getenv("REPO_BACKEND", "memory")

engine = create_engine(
    DATABASE_URL,
    # A free-tier database goes to sleep. Without this, the first request
    # after an idle period is a 500 in front of a judge.
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


def get_session() -> Iterator[Session | None]:
    """FastAPI dependency. Yields None on the memory backend so that nothing
    tries to open a connection to a database that is not running."""
    if REPO_BACKEND != "postgres":
        yield None
        return
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def create_all() -> None:
    from app.models import Base  # imported here: only the repo layer and db
    Base.metadata.create_all(engine)
    ensure_pgvector_schema()


def drop_all() -> None:
    from app.models import Base
    Base.metadata.drop_all(engine)
    drop_pgvector_schema()


def ensure_pgvector_schema() -> bool:
    """Create optional M8 pgvector storage if the extension is installed.

    The MVP can still run without pgvector: M8 falls back to exemplar
    similarity when this table is absent or empty.
    """
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
        return True
    except Exception:
        return False


def drop_pgvector_schema() -> None:
    try:
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS internal_doc_chunks"))
    except Exception:
        return
