# M8 pgvector internal-document similarity

M8 now has a hybrid retrieval path:

1. Encode the prompt, attachment text, or sentence with
   `sentence-transformers/all-MiniLM-L6-v2`.
2. If `REPO_BACKEND=postgres` and pgvector chunks are indexed, search
   `internal_doc_chunks` for nearest internal document chunks.
3. If no pgvector match is available, fall back to the existing local
   `backend/app/detect/exemplars.yaml` similarity bank.

This keeps the demo path stable: pgvector improves M8 when available, but M8
still runs without it.

## Setup

Use the pgvector Docker image:

```powershell
docker compose up -d
cd backend
$env:REPO_BACKEND = "postgres"
python reset_db.py --yes
python scripts/index_internal_docs_pgvector.py
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The index script reads:

```text
backend/data/internal_docs/sample_chunks.yaml
```

and writes embeddings into:

```text
internal_doc_chunks
```

## Fallback

If pgvector is unavailable or no chunks are indexed, M8 returns to the existing
SentenceTransformer + `exemplars.yaml` path. This is the fallback option if the
pgvector setup is too risky on teammate machines.

## Current limitations

- The sample corpus is tiny and meant for proof-of-concept testing.
- There is no upload/admin UI for indexing real internal documents yet.
- `internal_doc_chunks.embedding` is fixed at `vector(384)` because
  `all-MiniLM-L6-v2` outputs 384-dimensional embeddings.
- pgvector retrieval stores only chunk text and embedding metadata; it does not
  store raw source files.
