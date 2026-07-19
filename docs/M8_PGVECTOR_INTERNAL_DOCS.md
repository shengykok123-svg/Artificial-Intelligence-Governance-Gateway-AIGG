# M8 pgvector internal-document similarity

M8 now uses PostgreSQL + pgvector for internal-document similarity:

1. Encode the prompt, attachment text, or sentence with
   `sentence-transformers/all-MiniLM-L6-v2`.
2. Search `internal_doc_chunks` for nearest internal document chunks.
3. If the best similarity is above the configured threshold, emit
   `DEPT_CONFIDENTIAL`.

Per the 2026-07-19 meeting markdown, `DEPT_CONFIDENTIAL` from M8 is treated as
an admin-review signal in the current mock M3 policy, so public-AI requests are
held rather than automatically denied.

There is no external vector database and no hosted vector service in this
implementation. The database scheme is PostgreSQL with the pgvector extension.
If pgvector is unavailable, the M8 environment is not ready; the backend should
fail/disable that path rather than silently falling back to a local exemplar
bank.

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

The dashboard also exposes an internal-document uploader under
`Policy & tools`. It posts files to `POST /v1/internal-docs`; the backend uses
M5 extraction, chunks the extracted text, embeds the chunks, and stores
`source_file`, `department`, `chunk_text`, and the pgvector embedding.

## API

- `GET /v1/internal-docs` lists indexed chunks for dashboard/debug visibility.
- `POST /v1/internal-docs` uploads one file with a department label and indexes
  its extracted text into pgvector.

## Current limitations

- The sample corpus is tiny and meant for proof-of-concept testing; real
  quality depends on the uploaded internal corpus.
- `internal_doc_chunks.embedding` is fixed at `vector(384)` because
  `all-MiniLM-L6-v2` outputs 384-dimensional embeddings.
- Chunk text is stored intentionally for debug/explain visibility; raw source
  files are not stored.
- OCR-dependent documents still inherit the existing Tesseract limitations:
  scanned/blurred images may produce imperfect extracted text.
- Local Windows PostgreSQL must have the pgvector extension installed. Without
  it, `reset_db.py` fails when creating M8 storage.
