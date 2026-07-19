# AI Governance Gateway Runbook

This runbook is for a teammate taking over local development. It explains how
to start the backend, dashboard, Chrome extension, PostgreSQL + pgvector M8
path, and the core acceptance checks.

## Current Frame

Built and wired:

- M0 persistence
- M1 FastAPI API
- M2 deterministic detector
- M4 Chrome extension
- M5 file extraction/redaction
- M6 dashboard
- M7 tokenisation vault
- M8 PostgreSQL + pgvector internal-document similarity

Still mocked by design:

- M3 policy engine

Optional / not the default runtime:

- M9 DeBERTa detector

Before trusting any verdict, check:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/health" `
  -Headers @{ "X-Api-Key" = "dev-key-change-me" }
```

Expected for the current demo frame:

```text
mocked: M3
semantic_detector: m8
```

## Policy Expectations

The current mock M3 policy is aligned to the 2026-07-19 meeting frame.

| Detection | Source | Expected decision |
| --- | --- | --- |
| `SECRET` / API key | M2 | deny |
| `SALARY` | M2 | deny |
| `BANK_ACCT` | M2 | deny |
| `MYKAD` | M2 | redact |
| `EMAIL` | M2 | redact |
| `PHONE` | M2 | redact |
| `PERSON` | M2 | redact |
| `DEPT_CONFIDENTIAL` | M8 | hold |
| no sensitive data | none | allow |

Important: M8 does not decide `hold` by itself. M8 emits
`DEPT_CONFIDENTIAL`; M3/mock policy converts that evidence into `hold`.

## One-Time Setup

Run from the repo root:

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0"
```

Backend:

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\backend"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Dashboard:

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\dashboard"
npm install
```

Extension:

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\extension"
npm install
npm run build
```

Tesseract is required only for image/scanned-PDF OCR extraction/redaction. If it
is installed outside the default path, set `TESSERACT_EXE`.

## Backend: Memory Mode

Use this when Docker/PostgreSQL/pgvector is not ready. It is enough for most API
and extension checks, but not strict pgvector validation.

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\backend"

$env:REPO_BACKEND="memory"
$env:MOCK_MODULES="M3"

.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Expected startup:

```text
[startup] ENV=dev semantic_detector=m8 MOCK_MODULES=['M3']
Application startup complete.
```

## Backend: PostgreSQL + pgvector Mode

Use this for the real M8 vector path. The database must support pgvector.

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\backend"

$env:REPO_BACKEND="postgres"
$env:DATABASE_URL="postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
$env:MOCK_MODULES="M3"

.\.venv\Scripts\python.exe reset_db.py --yes
.\.venv\Scripts\python.exe scripts\index_internal_docs_pgvector.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

If port `8000` is already used, stop the old backend first:

```text
Ctrl + C
```

If pgvector is missing, `reset_db.py` should fail when creating M8 storage. That
is expected; M8 is not considered ready without pgvector.

## Dashboard

Run in a separate PowerShell window:

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\dashboard"
npm run dev
```

Open:

```text
http://localhost:5173
```

The `Policy & tools` page can upload internal documents into M8 through:

```text
POST /v1/internal-docs
```

## Chrome Extension

Build:

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\extension"
npm run build
```

Load into Chrome:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click `Load unpacked`.
4. Select:

```text
C:\Users\louis\OneDrive\Documents\HackAttack 3.0\extension\dist
```

Popup settings:

```text
Base URL: http://localhost:8000
User ID: wei.eng@acme.my
API key: dev-key-change-me
MOCK_MODE: off
```

After any extension code change:

1. Run `npm run build`.
2. Go to `chrome://extensions`.
3. Click reload on `AI Governance Gateway`.
4. Refresh the ChatGPT tab.

## Core HTTP Checks

API key deny:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/inspect" `
  -Method Post `
  -Headers @{ "X-Api-Key" = "dev-key-change-me"; "Content-Type" = "application/json" } `
  -Body '{"user_id":"wei.eng@acme.my","target_host":"chatgpt.com","prompt":"Use this API key: sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d","attachments":[]}' |
  ConvertTo-Json -Depth 8
```

Expected:

```json
{
  "decision": "deny",
  "data_classes": ["SECRET"],
  "reason": "SECRET detected (mock policy)."
}
```

Salary deny:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/inspect" `
  -Method Post `
  -Headers @{ "X-Api-Key" = "dev-key-change-me"; "Content-Type" = "application/json" } `
  -Body '{"user_id":"aiman.hr@acme.my","target_host":"chatgpt.com","prompt":"Please review this salary: Gaji bulanan RM 8,500","attachments":[]}' |
  ConvertTo-Json -Depth 8
```

Expected:

```json
{
  "decision": "deny",
  "data_classes": ["SALARY"]
}
```

MyKad redact:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/inspect" `
  -Method Post `
  -Headers @{ "X-Api-Key" = "dev-key-change-me"; "Content-Type" = "application/json" } `
  -Body '{"user_id":"aiman.hr@acme.my","target_host":"chatgpt.com","prompt":"My IC is 880412-08-5561","attachments":[]}' |
  ConvertTo-Json -Depth 8
```

Expected:

```json
{
  "decision": "redact",
  "data_classes": ["MYKAD"],
  "redacted_prompt": "My IC is [MYKAD_1]"
}
```

M8 hold:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/inspect" `
  -Method Post `
  -Headers @{ "X-Api-Key" = "dev-key-change-me"; "Content-Type" = "application/json" } `
  -Body '{"user_id":"wei.eng@acme.my","target_host":"chatgpt.com","prompt":"Please summarize the HR confidential termination plan for employee grievance cases.","attachments":[]}' |
  ConvertTo-Json -Depth 8
```

Expected shape:

```json
{
  "decision": "hold",
  "data_classes": ["DEPT_CONFIDENTIAL"],
  "content_department": "hr",
  "debug": {
    "semantic_detector": "m8",
    "detections": [
      {
        "data_class": "DEPT_CONFIDENTIAL",
        "detector": "embed",
        "source": "prompt"
      }
    ]
  }
}
```

## Chrome Acceptance Checklist

Use a refreshed ChatGPT tab after backend and extension reload.

| Case | Input | Expected |
| --- | --- | --- |
| Popup health | Open extension popup | Connected, mocked list shows `M3` |
| MyKad redact | `My IC is 880412-08-5561` | ChatGPT receives `[MYKAD_1]` |
| API key deny | fake `sk-proj-...` key | blocked, composer keeps text |
| Salary deny | `Gaji bulanan RM 8,500` | blocked, composer keeps text |
| M8 hold | prompt similar to indexed internal doc | waiting for approval |
| Previous-message edit deny | edit an old message to include fake API key | edit is blocked |
| Previous-message edit redact | edit an old message to include MyKad | redacted edit submits |
| Attachment removal | upload then remove file before send | removed file is not inspected |
| TXT/CSV redaction | upload file containing MyKad | replaced with `.redacted.txt` / `.redacted.csv` |
| DOCX/PPTX/PDF/XLSX/image redaction | upload file containing MyKad | replaced with redacted copy |

## Approving a Hold

Find pending hold events:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/logs?status=pending&decision=hold&limit=5" `
  -Headers @{ "X-Api-Key" = "dev-key-change-me" } |
  ConvertTo-Json -Depth 8
```

Approve one:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/logs/<LOG_ID>/decision" `
  -Method Post `
  -Headers @{ "X-Api-Key" = "dev-key-change-me"; "Content-Type" = "application/json" } `
  -Body '{"approve":true,"remark":"Approved for acceptance test"}' |
  ConvertTo-Json -Depth 8
```

The extension should then show approval state and release the held request.
For previous-message edit holds, the extension asks the user to submit the edit
again instead of auto-sending a stale edit target.

## Test Commands

Backend targeted policy/API checks:

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\backend"
.\.venv\Scripts\python.exe -m pytest tests/test_mocks.py tests/test_main.py tests/test_repos.py
```

Extension:

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\extension"
npm run typecheck
npm run build
```

Dashboard:

```powershell
cd "C:\Users\louis\OneDrive\Documents\HackAttack 3.0\dashboard"
npm run test
npm run build
```

## File Redaction Status

Supported extraction/redaction replacement:

- TXT
- CSV
- PDF
- DOCX
- PPTX
- XLSX
- PNG/JPEG image OCR

Known limitations:

- PDF redaction generates a new text-only PDF, not a layout-preserving PDF.
- OCR depends on local Tesseract and image quality.
- Legacy OLE embedded objects fail closed with HTTP 415.
- M3 is still a mock policy engine.
- M9 is opt-in and should not be claimed as the active semantic runtime unless
  `SEMANTIC_DETECTOR=m9_deberta` is configured and model artifacts exist.

## Common Problems

`address already in use`:

- Another backend is still running on port `8000`.
- Go to that PowerShell tab and press `Ctrl + C`.

Chrome still shows old behavior:

- Rebuild extension.
- Reload unpacked extension in `chrome://extensions`.
- Refresh ChatGPT.
- Restart backend if policy code changed.

M8 does not detect internal document similarity:

- Confirm backend is running with `REPO_BACKEND=postgres`.
- Confirm pgvector is installed.
- Confirm internal docs exist:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/internal-docs?limit=5" `
  -Headers @{ "X-Api-Key" = "dev-key-change-me" } |
  ConvertTo-Json -Depth 8
```

Backend says `No module named uvicorn`:

- You are using the wrong Python environment.
- Run from `backend` with:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## What Not To Change Casually

- Do not add Pinecone, Qdrant, ChromaDB, Weaviate, Supabase, Redis, Celery, or
  another queue/database service.
- Do not bypass `backend/app/repo/` and import ORM models from feature code.
- Do not claim M3 is real while `MOCK_MODULES=M3`.
- Do not claim OCR is deterministic.
- Do not commit manual test files unless they are intentionally promoted to
  fixtures.

