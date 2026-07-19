"""Index sample internal document chunks into Postgres pgvector for M8."""

from __future__ import annotations

import sys
from pathlib import Path

import uuid

import yaml

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import SessionLocal, ensure_pgvector_schema  # noqa: E402
from app.detect.embed import MODEL_NAME  # noqa: E402
from app.repo.postgres import PgInternalDocRepo  # noqa: E402

CHUNKS_PATH = BACKEND_ROOT / "data" / "internal_docs" / "sample_chunks.yaml"


def main() -> int:
    if not ensure_pgvector_schema():
        print("pgvector extension/table is unavailable for this DATABASE_URL.")
        return 1

    rows = yaml.safe_load(CHUNKS_PATH.read_text(encoding="utf-8"))["chunks"]

    from sentence_transformers import SentenceTransformer

    encoder = SentenceTransformer(MODEL_NAME, local_files_only=True)
    embeddings = encoder.encode(
        [row["text"] for row in rows],
        normalize_embeddings=True,
    )

    with SessionLocal() as session:
        repo = PgInternalDocRepo(session)
        for source_file in {row["source_file"] for row in rows}:
            repo.clear_source(source_file)
        grouped: dict[tuple[str, str], list[tuple[str, str, list[float]]]] = {}
        for row, embedding in zip(rows, embeddings):
            key = (row["source_file"], row["department"])
            grouped.setdefault(key, []).append(
                (
                    str(uuid.uuid4()),
                    row["text"],
                    [float(value) for value in embedding.tolist()],
                )
            )
        for (source_file, department), chunks in grouped.items():
            repo.add_chunks(chunks, source_file=source_file, department=department)

    print(f"indexed {len(rows)} internal document chunks from {CHUNKS_PATH.relative_to(BACKEND_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
