# Luis Handover Summary

This is the short version for teammates. For exact commands, use
`docs/RUNBOOK.md`.

## What This Branch Is

This branch is built on top of the team `main` branch. It does not replace the
team work; it adds Luis's local integration work on top of it.

The important baseline from `origin/main`:

- M5 real file extraction had already landed for core attachment text
  extraction.
- The Chrome extension, backend, dashboard, M7 tokenisation, M8/M9-related
  scaffolding, and debug panel already existed in some form.

Luis's work adds:

- file redaction replacement on top of M5 extraction;
- broader file extraction/redaction coverage needed for redaction tests;
- Chrome extension fixes for previous-message edit and attachment stale state;
- PostgreSQL + pgvector internal-document similarity for M8;
- dashboard upload path for M8 internal documents;
- meeting-policy alignment for current mock M3;
- documentation of evidence, limitations, and takeover steps.

## M5 vs File Redaction

Do not mix these up.

M5 extraction means:

```text
attachment bytes -> extracted text -> detectors can inspect it
```

File redaction replacement means:

```text
attachment bytes -> extracted text -> sensitive spans detected
  -> redacted file copy generated
  -> Chrome extension uploads the redacted copy instead of the original
```

`origin/main` already had the M5 extraction foundation. Luis's branch keeps that
foundation and adds the redaction/replacement path plus extra coverage needed
for the redaction flow, including XLSX, OCR, hidden Office text, comments,
tracked changes, speaker notes, embedded OOXML packages, and fail-closed legacy
OLE detection.

There is no intended conflict here. The correct merge interpretation is:

```text
Keep teammate M5 extraction.
Add Luis file redaction replacement on top.
```

## Current Behavior To Expect

Health should show only M3 mocked:

```text
mocked: M3
semantic_detector: m8
```

Current policy expectations:

| Input / signal | Expected decision |
| --- | --- |
| API key / `SECRET` | deny |
| salary / `SALARY` | deny |
| bank account / `BANK_ACCT` | deny |
| MyKad / email / phone / person | redact |
| M8 internal-doc confidential similarity / `DEPT_CONFIDENTIAL` | hold |
| no sensitive signal | allow |

Salary used to be a hold demo. In this branch it is deny. Use M8
`DEPT_CONFIDENTIAL` to test hold.

## How To Reproduce Quickly

Use your own clone path:

```powershell
cd "<repo-root>\backend"
```

Start backend in memory mode first:

```powershell
$env:REPO_BACKEND="memory"
$env:MOCK_MODULES="M3"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then check health:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/health" `
  -Headers @{ "X-Api-Key" = "dev-key-change-me" }
```

For real M8 pgvector testing, switch to PostgreSQL:

```powershell
$env:REPO_BACKEND="postgres"
$env:DATABASE_URL="postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
$env:MOCK_MODULES="M3"

.\.venv\Scripts\python.exe reset_db.py --yes
.\.venv\Scripts\python.exe scripts\index_internal_docs_pgvector.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

M8 uses PostgreSQL + pgvector only. Do not add Pinecone, Qdrant, ChromaDB,
Weaviate, Supabase, or another vector database service.

## What To Test

Backend:

```powershell
cd "<repo-root>\backend"
.\.venv\Scripts\python.exe -m pytest tests/test_mocks.py tests/test_main.py tests/test_repos.py
```

Extension:

```powershell
cd "<repo-root>\extension"
npm run typecheck
npm run build
```

Chrome:

- reload unpacked extension from `<repo-root>\extension\dist`;
- refresh ChatGPT;
- check MyKad redact;
- check API key deny;
- check salary deny;
- check file redaction replacement;
- check attachment removal does not leave stale file state;
- check M8 hold after internal docs are indexed.

## Still Not Done

- Real M3 policy engine.
- Justification Required modal/flow.
- Full production admin review workflow.
- Production authentication and permissions.
- Layout-preserving PDF redaction.
- Perfect OCR accuracy.

For detailed setup and troubleshooting, read `docs/RUNBOOK.md`.
