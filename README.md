# AI Governance Gateway

A Chrome extension plus a FastAPI policy plane that inspects prompts and file
attachments before they reach ChatGPT, Gemini or Copilot, and returns one of
four verdicts: **allow | redact | hold | deny**. Every event lands in an
auditable log; an employer dashboard is where a held prompt gets approved or
denied, and the extension unblocks the employee after approval.

## Current Status

This repository is currently a **local hackathon prototype**, not a
consumer one-click Chrome Web Store install. The core browser acceptance flow
has been verified locally with a backend on `http://localhost:8000`.

| | Module | P | Status |
|---|---|---|---|
| OK | **M0** Database and persistence | P0 | Built, tested |
| OK | **M1** API skeleton + mock plane | P0 | Built, tested |
| OK | **M2** Deterministic detection | P0 | Real: MyKad, email, phone, bank account, salary, secret and person patterns |
| MOCK | **M3** Decision engine | P0 | Mocked by design in this frame: `mock_decide` |
| OK | **M4** Chrome extension | P0 | Built and live-tested on ChatGPT |
| MOCK | **M5** File extractor | P1 | Mocked by design in this frame |
| OK | **M6** Employer dashboard | P1 | Built |
| OK | **M7** Tokenisation vault | P2 | Real: Fernet-encrypted reversible token maps |
| OK | **M8** Embedding similarity | P1 | Real: local `sentence-transformers/all-MiniLM-L6-v2` embeddings |
| TODO | **M9** Fine-tuned DistilBERT | P3 | Proposal only |

`GET /v1/health` is the source of truth. For the current frame it should
return:

```json
{"status":"ok","mocked":["M3","M5"]}
```

Do not claim an all-real-module demo until M3 and M5 land and `mocked` is an
empty list.

## What Was Verified

Backend HTTP smoke checks passed with `MOCK_MODULES=M3,M5`:

| Case | Input | Expected | Verified |
|---|---|---|---|
| MyKad redaction | `My IC is 880412-08-5561` | redact | `My IC is [MYKAD_1]` |
| API key prevention | `sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d` | deny | blocked |
| Salary review | `Gaji bulanan RM 8,500` | hold | pending approval |
| Semantic finance signal | `Quarterly revenue is below forecast.` | hold | `DEPT_CONFIDENTIAL` |

Chrome extension live acceptance passed on ChatGPT:

- Popup connects to `http://localhost:8000` and reports `Backend is mocking: M3, M5`.
- MyKad prompt is redacted before send; ChatGPT receives `[MYKAD_1]`.
- API key prompt is denied and remains in the composer.
- Salary prompt is held and not sent immediately.
- Backend approval changes the hold to `approved`; the extension detects it and sends the prompt.
- Successful send-state banners disappear automatically after a short delay.

See `docs/EXTENSION_TEST_REPORT.md` for the detailed acceptance record.

## Local Setup

### 1. Create local `.env`

`.env` is ignored by git because it contains `VAULT_FERNET_KEY`. To generate it
on Windows:

```powershell
.\scripts\setup-dev.ps1
```

If you prefer to do it manually, copy `.env.example` to `.env`, set
`MOCK_MODULES=M3,M5`, and generate a Fernet key:

```powershell
cd "C:\path\to\HackAttack 3.0\backend"
.\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste the output into `.env` as `VAULT_FERNET_KEY=...`.

### 2. Backend

```powershell
cd "C:\path\to\HackAttack 3.0\backend"
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Health check from a second terminal:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/health" -Headers @{ "X-Api-Key" = "dev-key-change-me" }
```

Expected current result: `mocked` contains only `M3` and `M5`.

### 3. Extension

```powershell
cd "C:\path\to\HackAttack 3.0\extension"
npm install
npm run typecheck
npm run build
```

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Remove any old `AI Governance Gateway` entry.
4. Click **Load unpacked**.
5. Select `extension\dist`.
6. Open the extension popup and set:

```text
Base URL: http://localhost:8000
User ID: wei.eng@acme.my
API key: dev-key-change-me
MOCK_MODE: off
```

After reloading the extension, open a fresh `https://chatgpt.com/` tab or
refresh the existing ChatGPT tab.

### 4. Dashboard

```powershell
cd "C:\path\to\HackAttack 3.0\dashboard"
npm install
npm run dev
```

The dashboard runs at `http://localhost:5173`.

## Tests

```powershell
cd backend
$env:REPO_BACKEND="memory"
$env:MOCK_MODULES="M3,M5"
.\.venv\Scripts\pytest.exe
```

```powershell
cd extension
npm run typecheck
npm run build
```

```powershell
cd dashboard
npm run test
```

## Layout

```text
backend/app/main.py             M1 FastAPI app and routers
backend/app/schemas.py          M1 Pydantic wire models
backend/app/mocks.py            M1 mocks for modules not active in this frame
backend/app/db.py               M0 engine, session, create_all, reset
backend/app/repo/               M0 repository interfaces and implementations
backend/app/detect/rules.py     M2 deterministic detection
backend/app/detect/embed.py     M8 embedding similarity
backend/app/extract/files.py    M5 file extraction, currently mocked in this frame
backend/app/policy/engine.py    M3 decision engine, currently mocked in this frame
backend/app/vault/tokeniser.py  M7 encrypted reversible tokenisation
extension/                      M4 MV3 Chrome extension
dashboard/                      M6 React dashboard
docs/EXTENSION_TEST_REPORT.md   Live extension acceptance record
```

## Prototype vs Consumer Install

The current local flow requires a backend, `.env`, `npm run build`, and
Chrome **Load unpacked**. That is expected for this prototype.

A consumer-ready version should move these responsibilities out of the user
setup:

- Hosted backend instead of `localhost`.
- Server-side secret management or KMS for the vault key.
- Chrome Web Store packaged extension.
- Login or managed org configuration for backend URL and API token.
- No user-generated Fernet key, no manual `dist` loading, and no local npm
  build for normal users.

## Docs

- `docs/EXTENSION_TEST_REPORT.md` - live extension acceptance result.
- `docs/README_M0.md` - persistence layer notes.
- `extension/README.md` - extension wiring, selectors and failure modes.
- `dashboard/README.md` - dashboard run notes and screen details.
