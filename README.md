# AI Governance Gateway (AIGG)

AIGG lets organisations adopt public AI tools without losing control of their
data. A Chrome extension checks prompts and file attachments before they reach
ChatGPT or Gemini, and a policy engine returns one of four verdicts:

| Verdict | What happens |
|---|---|
| **Allow** | The prompt is sent as written, with a stated purpose if policy requires one |
| **Redact** | Sensitive data is masked before the prompt or file is sent |
| **Hold** | The request waits for an admin decision |
| **Deny** | The request is blocked |

## Key features

- **Sensitive data detection:** catches MyKad numbers, emails, phone numbers,
  bank accounts, salaries and API keys with deterministic rules.
- **Confidential content detection:** compares content against indexed internal
  documents, with an optional fine-tuned DeBERTa classifier.
- **File inspection:** checks TXT, CSV, PDF, DOCX, PPTX, XLSX, PNG and JPEG
  attachments, and swaps in a redacted copy in the browser.
- **Editable policy:** rules are stored as data, so compliance teams can change
  them without redeploying code.
- **Approval workflow:** admins review held requests alongside the employee's
  stated purpose and justification.
- **Audit log:** records each decision, with attachments available to download.
- **Shadow AI discovery:** flags visits to about 2,200 known AI sites.

## Tech stack

| Layer | Technologies |
|---|---|
| Browser extension | Chrome Manifest V3, TypeScript, Vite |
| Admin dashboard | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts |
| Backend | Python 3.11, FastAPI, Pydantic, SQLAlchemy |
| Database | PostgreSQL 16, pgvector |
| AI / ML | Sentence Transformers (`all-MiniLM-L6-v2`), DeBERTa-v3-small (PyTorch, Hugging Face Transformers) |
| File processing | pdfplumber, python-docx, python-pptx, pandas, Tesseract OCR |
| Security | Fernet-encrypted reversible tokenisation |

## Getting started

```bash
# Backend (http://localhost:8000), using seeded in-memory data
cp .env.example .env
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
REPO_BACKEND=memory uvicorn app.main:app --reload
```

```bash
# Extension: then load extension/dist as an unpacked extension in chrome://extensions
cd extension
npm install && npm run build
```

```bash
# Dashboard (http://localhost:5173)
cd dashboard
npm install
cp .env.example .env
npm run dev
```

Internal-document matching needs PostgreSQL with pgvector:

```bash
docker compose up -d
cd backend
REPO_BACKEND=postgres python reset_db.py
python scripts/index_internal_docs_pgvector.py
REPO_BACKEND=postgres uvicorn app.main:app --reload
```
