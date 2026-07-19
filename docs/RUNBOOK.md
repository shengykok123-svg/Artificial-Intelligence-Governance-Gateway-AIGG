# AI Governance Gateway Handover Runbook

This document is for teammates who did not follow Luis's local development
session. It explains what was added on top of the upstream project, why the new
setup exists, and how to reproduce the same local behavior after cloning the
repo.

Do not copy Luis's local Windows path. In every command below:

```text
<repo-root>
```

means the folder where you cloned this repository.

Example:

```powershell
cd "<repo-root>"
```

If your clone is in `D:\Projects\HackAttack 3.0`, then `<repo-root>` means that
folder. If your clone is somewhere else, use your own path.

## 1. What This Branch Adds

The base project already had the AI Governance Gateway shape:

```text
Chrome extension
  -> FastAPI backend
  -> detectors / policy
  -> audit log
  -> dashboard
```

Luis's local work added and verified these main pieces on top of the latest
team repo:

| Area | What changed |
| --- | --- |
| File extraction/redaction | TXT, CSV, DOCX, PPTX, PDF, XLSX, PNG/JPEG attachments can be inspected. Redactable files can be replaced with redacted copies before upload. |
| Extension live behavior | Normal composer send, previous-message edit, hold approval, banner behavior, and attachment-removal stale state were hardened. |
| M8 pgvector | M8 now uses PostgreSQL + pgvector internal-document chunks instead of a separate vector database service. |
| Dashboard | `Policy & tools` can upload internal documents into the M8 corpus. |
| Policy alignment | Mock M3 was adjusted to match the meeting frame: salary/API key/bank account deny, PII redact, M8 confidential similarity hold. |
| Documentation | Test evidence, limitations, OCR notes, and this handover runbook were added. |

## 2. If You Are Coming From `main`

Read this section first if your local understanding is based on the old
`main` branch. Several assumptions changed.

| Topic | What `main` looked like | What this branch expects |
| --- | --- | --- |
| M5 file extractor | M5 was still mocked or limited. | M5 is real for TXT, CSV, DOCX, PPTX, PDF, XLSX, PNG/JPEG OCR extraction. |
| File redaction | Mainly prompt/text redaction. | The extension can replace supported uploaded files with backend-returned redacted copies. |
| M8 runtime | Local embedding/classifier style, no strict pgvector requirement. | M8 uses PostgreSQL + pgvector internal-document chunks. |
| Mock modules | Health could show `M3, M5`. | Health should show only `M3`. |
| Salary policy | Salary was previously used as a hold/approval demo. | Salary now denies. Use M8 `DEPT_CONFIDENTIAL` for hold tests. |
| M8 confidential policy | Could be treated as deny in older checks. | M8 confidential similarity should hold for admin review. |
| Extension edit behavior | Previous-message edit interception was incomplete. | Edits are re-inspected for deny/redact/hold; hold edit approval avoids stale auto-send. |
| Attachment state | Removing an attachment could leave stale cached state. | Removed attachments should not be sent to `/v1/inspect`. |

The biggest practical change is this:

```text
Old mental model:
Salary -> hold
M5 mocked
M8 mostly local semantic demo

Current branch:
Salary -> deny
M5 real file extraction/redaction
M8 -> PostgreSQL + pgvector internal-doc similarity
M8 confidential -> hold
```

So if a teammate tests `Gaji bulanan RM 8,500` and expects hold, they are using
the old behavior. In this branch, that test should be deny.

If a teammate wants to test hold now, they should index/upload an internal
document and use a prompt similar to that document so M8 emits
`DEPT_CONFIDENTIAL`.

## 3. What To Read First

Recommended reading order:

```text
1. README.md
2. docs/RUNBOOK.md
3. docs/FILE_REDACTION_STATUS.md
4. docs/M8_PGVECTOR_INTERNAL_DOCS.md
5. extension/README.md
6. docs/EXTENSION_TEST_REPORT.md
```

Why:

- `README.md` gives the current project status.
- this runbook explains how to reproduce Luis's local setup.
- `FILE_REDACTION_STATUS.md` explains supported file types and limitations.
- `M8_PGVECTOR_INTERNAL_DOCS.md` explains the pgvector path.
- `extension/README.md` explains extension setup and live cases.
- `EXTENSION_TEST_REPORT.md` separates historical evidence from current
  policy expectations.

## 4. What Is Luis's Part vs Not Luis's Part

Luis's branch focuses on:

- file extraction/redaction replacement
- extension acceptance behavior
- previous-message edit interception
- attachment removal stale-state fix
- PostgreSQL + pgvector M8 internal-doc similarity
- M8 upload path in dashboard `Policy & tools`
- meeting-policy alignment for current mock M3
- documentation and takeover notes

Not completed in this branch:

- real M3 policy engine
- Justification Required modal/flow
- full production admin review workflow
- production auth/identity
- M9 production model accuracy
- layout-preserving PDF redaction

This distinction matters when assigning next work. Do not treat this branch as
the final product; treat it as a working local integration layer that another
teammate can continue from.

Recent local commits of interest:

```text
433710d docs: add local development runbook
5ee526b feat: align M8 hold policy with meeting frame
52d5a60 fix: harden extension edit and attachment removal flow
f049b99 feat: add optional pgvector internal doc similarity
98ff995 merge origin main with file redaction
```

## 5. Current Module Status

Real / built in this branch:

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

Optional, not the current demo runtime:

- M9 DeBERTa detector

This matters because the extension popup and debug panel may say:

```text
Mocked: M3
```

That is expected. It means the policy engine is still a mock table, but M2,
M5, M7, and M8 are real in this frame.

## 6. Current Policy Frame

This is the behavior Luis aligned to the meeting notes.

| Detector output | Meaning | Final decision |
| --- | --- | --- |
| `SECRET` | API key / credential | deny |
| `SALARY` | salary amount | deny |
| `BANK_ACCT` | bank account/card-like number | deny |
| `MYKAD` | Malaysian IC | redact |
| `EMAIL` | email address | redact |
| `PHONE` | phone number | redact |
| `PERSON` | person name | redact |
| `DEPT_CONFIDENTIAL` | M8 matched internal confidential content | hold |
| none | no sensitive signal | allow |

Important distinction:

- M8 does not directly decide hold.
- M8 emits `DEPT_CONFIDENTIAL`.
- M3/mock policy converts `DEPT_CONFIDENTIAL` into `hold`.

So a correct M8 JSON trace should show:

```json
{
  "decision": "hold",
  "data_classes": ["DEPT_CONFIDENTIAL"],
  "debug": {
    "semantic_detector": "m8",
    "detections": [
      {
        "data_class": "DEPT_CONFIDENTIAL",
        "detector": "embed"
      }
    ]
  }
}
```

## 7. Why PostgreSQL + pgvector Is Needed

M8 is the internal-document similarity module.

The goal is:

```text
Employee prompt / attachment text
  -> embedding
  -> compare against indexed internal document chunks
  -> if similarity is high, emit DEPT_CONFIDENTIAL
```

The team decision for this branch is:

```text
Use PostgreSQL + pgvector only.
Do not add Pinecone, Qdrant, ChromaDB, Weaviate, Supabase, or another vector DB.
```

That means a teammate who wants to test real M8 needs:

- PostgreSQL running locally or on a server.
- The pgvector extension installed/enabled.
- Internal documents indexed through the script or dashboard upload.

If pgvector is not available, M8 is not considered fully ready. Do not silently
replace it with another vector database.

## 8. Setup Order From a Fresh Clone

Use this order. It mirrors the order the feature was built and debugged.

```text
1. Install backend dependencies.
2. Run backend in memory mode to confirm the basic API works.
3. Build dashboard.
4. Build and load Chrome extension.
5. Run basic redact/deny checks.
6. Switch backend to PostgreSQL + pgvector.
7. Index/upload internal docs for M8.
8. Run M8 hold checks.
9. Run acceptance tests.
```

Do not start with Chrome. If the backend is wrong, Chrome will only make the
problem harder to understand.

## 9. Backend Setup

Open PowerShell:

```powershell
cd "<repo-root>\backend"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

If you see:

```text
No module named uvicorn
```

you are probably using the wrong Python. Always run backend commands through:

```powershell
.\.venv\Scripts\python.exe
```

## 10. First Backend Run: Memory Mode

Memory mode does not need PostgreSQL. Use it first to prove the backend starts.

```powershell
cd "<repo-root>\backend"

$env:REPO_BACKEND="memory"
$env:MOCK_MODULES="M3"

.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Expected startup:

```text
[startup] ENV=dev semantic_detector=m8 MOCK_MODULES=['M3']
Application startup complete.
```

If you see:

```text
address already in use
```

another backend is already using port `8000`. Find that PowerShell tab and
press `Ctrl + C`, then run the command again.

## 11. Health Check

Open a second PowerShell window while backend is still running:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/health" `
  -Headers @{ "X-Api-Key" = "dev-key-change-me" }
```

For this branch, expected result should show:

```text
mocked: M3
semantic_detector: m8
```

If `M2`, `M5`, `M7`, or `M8` appears in `mocked`, you are not running the
intended frame.

## 12. Basic Backend JSON Checks

Run these before opening Chrome.

API key should deny:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/inspect" `
  -Method Post `
  -Headers @{ "X-Api-Key" = "dev-key-change-me"; "Content-Type" = "application/json" } `
  -Body '{"user_id":"wei.eng@acme.my","target_host":"chatgpt.com","prompt":"Use this API key: sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d","attachments":[]}' |
  ConvertTo-Json -Depth 8
```

Expected important fields:

```json
{
  "decision": "deny",
  "data_classes": ["SECRET"],
  "reason": "SECRET detected (mock policy)."
}
```

Salary should deny:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/inspect" `
  -Method Post `
  -Headers @{ "X-Api-Key" = "dev-key-change-me"; "Content-Type" = "application/json" } `
  -Body '{"user_id":"aiman.hr@acme.my","target_host":"chatgpt.com","prompt":"Please review this salary: Gaji bulanan RM 8,500","attachments":[]}' |
  ConvertTo-Json -Depth 8
```

Expected important fields:

```json
{
  "decision": "deny",
  "data_classes": ["SALARY"]
}
```

MyKad should redact:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/inspect" `
  -Method Post `
  -Headers @{ "X-Api-Key" = "dev-key-change-me"; "Content-Type" = "application/json" } `
  -Body '{"user_id":"aiman.hr@acme.my","target_host":"chatgpt.com","prompt":"My IC is 880412-08-5561","attachments":[]}' |
  ConvertTo-Json -Depth 8
```

Expected important fields:

```json
{
  "decision": "redact",
  "data_classes": ["MYKAD"],
  "redacted_prompt": "My IC is [MYKAD_1]"
}
```

## 13. Dashboard Setup

Open another PowerShell window:

```powershell
cd "<repo-root>\dashboard"
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

The dashboard is useful for:

- audit log review
- hold queue
- tool governance
- uploading internal docs into M8 from `Policy & tools`

## 14. Extension Setup

Build:

```powershell
cd "<repo-root>\extension"
npm install
npm run build
```

Load in Chrome:

```text
chrome://extensions
```

Then:

1. Turn on Developer mode.
2. Click `Load unpacked`.
3. Select:

```text
<repo-root>\extension\dist
```

Open the extension popup and set:

```text
Base URL: http://localhost:8000
User ID: wei.eng@acme.my
API key: dev-key-change-me
MOCK_MODE: off
```

Click save. If nothing visibly happens, that is okay; verify by closing and
opening the popup again.

After every extension code change:

```text
1. npm run build
2. reload the extension in chrome://extensions
3. refresh the ChatGPT tab
```

If Chrome still shows old behavior, one of those three steps was likely missed.

## 15. Chrome Acceptance Checks

Use a refreshed ChatGPT tab after backend and extension reload.

| Case | Input | Expected |
| --- | --- | --- |
| Popup health | Open extension popup | Backend connected, mocked list shows `M3` |
| MyKad redact | `My IC is 880412-08-5561` | ChatGPT receives `[MYKAD_1]` |
| API key deny | fake `sk-proj-...` key | Prompt blocked and remains in composer |
| Salary deny | `Gaji bulanan RM 8,500` | Prompt blocked and remains in composer |
| Previous-message edit deny | Edit an old sent message to include fake API key | Edit is blocked |
| Previous-message edit redact | Edit an old sent message to include MyKad | Redacted edit submits |
| Attachment removal | Upload a file, remove it, then send text only | Removed file is not included in audit |
| File redaction | Upload MyKad file | Extension replaces it with redacted file before upload |

The attachment-removal case was specifically fixed because the extension
previously kept stale attachment state after the user removed a file.

## 16. PostgreSQL + pgvector Setup for M8

Only do this after the memory-mode checks pass.

You need PostgreSQL with pgvector available. The default local connection used
in this branch is:

```text
postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres
```

Run:

```powershell
cd "<repo-root>\backend"

$env:REPO_BACKEND="postgres"
$env:DATABASE_URL="postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
$env:MOCK_MODULES="M3"

.\.venv\Scripts\python.exe reset_db.py --yes
.\.venv\Scripts\python.exe scripts\index_internal_docs_pgvector.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

What each line does:

- `REPO_BACKEND=postgres`: tells backend to use PostgreSQL instead of memory.
- `DATABASE_URL=...`: tells backend where PostgreSQL is.
- `MOCK_MODULES=M3`: keeps only M3 mocked.
- `reset_db.py --yes`: recreates tables and seed data.
- `index_internal_docs_pgvector.py`: adds sample internal-doc chunks for M8.
- `uvicorn ...`: starts the backend API.

If `reset_db.py` fails at pgvector/table creation, the database is not ready
for M8. Install/enable pgvector or use a PostgreSQL server that already has it.

## 17. M8 Internal Document Upload

M8 needs internal docs to compare against. There are two ways to add them.

Option A: seed script:

```powershell
cd "<repo-root>\backend"
.\.venv\Scripts\python.exe scripts\index_internal_docs_pgvector.py
```

Option B: dashboard upload:

```text
Dashboard -> Policy & tools -> upload internal document
```

To confirm indexed chunks exist:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/internal-docs?limit=5" `
  -Headers @{ "X-Api-Key" = "dev-key-change-me" } |
  ConvertTo-Json -Depth 8
```

You should see rows with:

```text
source_file
department
chunk_text
created_at
```

## 18. M8 JSON Check

After internal docs are indexed, inspect a prompt similar to the indexed
document.

Example:

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
  "department_confidence": 0.91,
  "debug": {
    "policy_layer": "M3",
    "semantic_detector": "m8",
    "detections": [
      {
        "data_class": "DEPT_CONFIDENTIAL",
        "detector": "embed",
        "confidence": 0.91,
        "source": "prompt"
      }
    ]
  }
}
```

The exact confidence may change depending on the indexed document and model,
but the important parts are:

- `decision` is `hold`
- `data_classes` contains `DEPT_CONFIDENTIAL`
- `semantic_detector` is `m8`
- `detector` is `embed`

## 19. Approving a Hold

Find pending holds:

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

Normal composer hold:

- extension should release the held prompt after approval.

Previous-message edit hold:

- extension should not auto-send a stale edit target.
- it should ask the user to submit the edit again.

## 20. File Redaction Status

Supported replacement:

- TXT
- CSV
- DOCX
- PPTX
- PDF
- XLSX
- PNG/JPEG image OCR

Important limitations:

- PDF redaction generates a new text-only PDF. It does not preserve the
  original PDF layout, images, or tables.
- OCR depends on local Tesseract and image quality.
- Legacy OLE embedded objects fail closed with HTTP 415.
- OCR is not deterministic like TXT/DOCX/XLSX extraction.

Tesseract note:

- Tesseract is currently used for OCR.
- Other OCR alternatives were discussed, but not implemented in this branch.
- If Tesseract is installed outside the default path, set `TESSERACT_EXE`.

## 21. Test Commands

Backend targeted tests:

```powershell
cd "<repo-root>\backend"
.\.venv\Scripts\python.exe -m pytest tests/test_mocks.py tests/test_main.py tests/test_repos.py
```

Luis's last targeted run returned:

```text
83 passed, 43 skipped, 1 warning
```

Extension:

```powershell
cd "<repo-root>\extension"
npm run typecheck
npm run build
```

Dashboard:

```powershell
cd "<repo-root>\dashboard"
npm run test
npm run build
```

## 22. What To Check Before Push

Use this checklist before pushing or opening a PR:

```text
1. git status --short
2. backend targeted tests pass
3. extension typecheck/build pass
4. dashboard test/build pass if dashboard files changed
5. health shows only M3 mocked
6. Chrome extension reloaded from extension/dist
7. ChatGPT tab refreshed
8. MyKad redact passes
9. API key deny passes
10. salary deny passes
11. M8 hold passes after internal docs are indexed
```

Do not commit these unless intentionally promoted to fixtures:

- `manual-test-files/`
- `pgvector-build/`
- generated screenshots
- npm lockfile noise from a different npm version

## 23. Common Problems and Fixes

Problem:

```text
Backend says address already in use.
```

Fix:

```text
Another backend is already running. Stop it with Ctrl + C.
```

Problem:

```text
Extension still shows old behavior.
```

Fix:

```text
Run npm run build in extension.
Reload the unpacked extension in chrome://extensions.
Refresh the ChatGPT tab.
Restart backend if policy code changed.
```

Problem:

```text
M8 does not produce DEPT_CONFIDENTIAL.
```

Fix:

```text
Confirm REPO_BACKEND=postgres.
Confirm pgvector is installed.
Confirm /v1/internal-docs has indexed chunks.
Use a prompt similar to the indexed document.
```

Problem:

```text
Backend says No module named uvicorn.
```

Fix:

```powershell
cd "<repo-root>\backend"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Problem:

```text
Chrome popup save seems to do nothing.
```

Fix:

```text
Close and reopen the popup.
Check that Base URL, User ID, API key, and MOCK_MODE are still correct.
Then run /v1/health from PowerShell.
```

## 24. What Is Still Not Done

These are not solved by Luis's branch:

- M3 is still mock policy, not a real configurable policy engine.
- Justification Required UI/flow is not implemented.
- Full admin review page polish is not finished.
- M9 is not the default runtime.
- OCR is best-effort, not perfect.
- PDF redaction is text-only replacement, not layout-preserving redaction.
- Production auth, identity, permissions, and deployment are out of scope.

## 25. Suggested Next Development Order

Recommended order for the next teammate:

```text
1. Pull/checkout this branch.
2. Run memory-mode backend checks.
3. Run extension build and Chrome smoke tests.
4. Set up PostgreSQL + pgvector.
5. Upload/index internal docs.
6. Verify M8 hold JSON.
7. Continue M3 policy engine or admin review UI, depending on assigned module.
```

Keep changes scoped. If working on M3, do not modify detector contracts. If
working on dashboard/admin review, do not change M8 storage behavior unless the
team agrees.
