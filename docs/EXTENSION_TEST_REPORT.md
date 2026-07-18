# Extension integration test report

Date: 2026-07-18

## Scope

This report verifies the extension build, the backend HTTP contract that the
extension consumes, and the live Chrome acceptance flow on ChatGPT. The
extension was manually reloaded from `extension/dist`, configured through the
popup, and verified against the local backend.

## Environment

- Backend: local FastAPI server on `127.0.0.1:8000`
- Real modules: M2 deterministic detection, M5 file extraction, M7 tokenisation, M8 embedding similarity
- Remaining mocks: M3 policy engine
- M8 model: `sentence-transformers/all-MiniLM-L6-v2`, cached locally and loaded offline
- Backend launch uses `MOCK_MODULES=M3`. A local `.env` supplies
  `VAULT_FERNET_KEY`; this file is intentionally ignored by git.

## Build checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run build` | Pass; loadable `extension/dist` generated |
| Backend suite in `.venv` | 100 passed, 41 skipped |
| Real M2 + M7 + M8 integration suite | 39 passed |
| Real M5 extraction suite | 8 passed |

## Live HTTP smoke checks

`GET /v1/health` returned `mocked: ["M3"]` after M5 landed.

| Case | Input | Expected | Actual |
| --- | --- | --- | --- |
| Deterministic redaction | `My IC is 880412-08-5561` | redact | redact; `My IC is [MYKAD_1]` |
| Secret prevention | OpenAI API key | deny | deny |
| Salary review | `Gaji bulanan RM 8,500` | hold | hold |
| Semantic finance signal | `Quarterly revenue is below forecast.` | hold | hold; `DEPT_CONFIDENTIAL` |

## M5 file extraction checks

M5 now extracts text from TXT, CSV, PDF, DOCX and PPTX in tests, rejects invalid
base64, rejects unsupported types, and enforces a 5 MB attachment size limit.
When a TXT, CSV, PDF, DOCX or PPTX attachment causes a `redact` verdict,
`/v1/inspect` now returns a redacted attachment copy in `redacted_attachments`.

Browser-side replacement is wired for TXT/CSV/PDF/DOCX/PPTX attachments. The
extension intercepts the file input `change` event at `document_start`, checks
the file with the backend before upload, and injects the returned redacted file
copy when the verdict is `redact`.

## Live Chrome acceptance

Evidence was captured by manual screenshots during the live ChatGPT run.

| Case | Screenshot evidence | Result |
| --- | --- | --- |
| Popup health | Manual screenshot | Pass. Popup connected to `http://localhost:8000`, `MOCK_MODE` was off, and health displayed the active mock list. |
| MyKad redact | Manual screenshot | Pass. `880412-08-5561` was tokenised to `[MYKAD_1]` before ChatGPT received the prompt; banner showed `redacted before sending (MYKAD)`. |
| API key deny | Manual screenshot | Pass. Prompt containing `sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d` was blocked and remained in the composer; no ChatGPT user bubble was sent. |
| Salary hold | Manual screenshot | Pass. `Gaji bulanan RM 8,500` produced `held for compliance review -- waiting for approval` and was not sent immediately. |
| Salary approval send | Manual screenshot + backend status | Pass. `POST /v1/logs/{log_id}/decision` changed status to `approved`; the extension detected the approval and replayed the original salary prompt to ChatGPT. |
| TXT attachment deny | Manual screenshot + backend log `67aab510-01f1-433e-8c78-99a4afba4341` | Pass. `secret.txt` contained the fake OpenAI API key; M5 extracted it, M2 classified `SECRET`, and the extension blocked the send. |
| DOCX attachment hold + approval send | Manual screenshot + backend log `1a0b1db1-119f-4add-a484-282225d490d0` | Pass. `salary.docx` contained `Gaji bulanan RM 8,500`; M5 extracted it, M2 classified `SALARY`, M3 mock held it, and approval replayed the attachment prompt to ChatGPT. |
| TXT attachment redaction replacement | Manual screenshot + backend logs `75dc6972-7b26-4546-9e49-1cf4acae64a7`, `928302a6-f14b-4ee0-9f28-c837966e00b8` | Pass. `mykad.txt` was inspected and replaced with `mykad.redacted.txt`; ChatGPT read `Employee IC [MYKAD_1] needs a reply.` and the replaced file passed the follow-up send-time inspection as `allow`. |
| DOCX attachment redaction replacement | Manual screenshot + backend logs `4e29f889-4d4e-4d23-902c-0e0ae2f96957`, `d9498500-8b6c-4df1-9ceb-cf7188308dc8` | Pass. `mykad.docx` was inspected and replaced with `mykad.redacted.docx`; ChatGPT read `Employee IC [MYKAD_1] needs a reply.` and the replaced file passed the follow-up send-time inspection as `allow`. |
| PPTX attachment redaction replacement | Manual screenshot + backend logs `23dbeffc-75ce-4d89-b474-ad9f45d5a82d`, `ae863792-f240-4702-b587-b5bd06b31bf6` | Pass. `mykad.pptx` was inspected and replaced with `mykad.redacted.pptx`; ChatGPT read `Employee IC [MYKAD_1] needs a reply.` and the replaced file passed the follow-up send-time inspection as `allow`. |
| PDF attachment redaction replacement | Manual screenshot + backend logs `58a9ab25-b8e6-4d3f-bc06-f49f13a7d7bf`, `954de026-a486-4ef3-b197-3159c161ae9e` | Pass. `mykad.pdf` was inspected and replaced with `mykad.redacted.pdf`; ChatGPT read `Employee IC [MYKAD_1] needs a reply.` and the replaced file passed the follow-up send-time inspection as `allow`. |

One UX polish landed after the acceptance run: successful sent-state banners
(`redacted before sending` and `approved -- sending now`) now disappear after
three seconds. Blocking banners such as `deny` and `waiting for approval` remain
visible.

Current file-redaction replacement support covers TXT, CSV, PDF, DOCX and
PPTX. The generated PDF redaction copy is intentionally a new text-only PDF
containing the tokenised text, so the original PDF objects are not carried
forward into the replacement file.

## Push recommendation

The M2, M5, M7 and M8 module changes plus the extension live acceptance flow
are ready for review. M3 remains mocked by design in this frame, so do not
claim an all-real-module demo until it lands and `GET /v1/health` reports an
empty `mocked` list.
