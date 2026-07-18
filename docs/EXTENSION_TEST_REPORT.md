# Extension integration test report

Date: 2026-07-18

## Scope

This report verifies the extension build, the backend HTTP contract that the
extension consumes, and the live Chrome acceptance flow on ChatGPT. The
extension was manually reloaded from `extension/dist`, configured through the
popup, and verified against the local backend.

## Environment

- Backend: local FastAPI server on `127.0.0.1:8000`
- Real modules: M2 deterministic detection, M7 tokenisation, M8 embedding similarity
- Remaining mocks: M3 policy engine, M5 file extractor
- M8 model: `sentence-transformers/all-MiniLM-L6-v2`, cached locally and loaded offline
- Backend launch uses `MOCK_MODULES=M3,M5`. A local `.env` supplies
  `VAULT_FERNET_KEY`; this file is intentionally ignored by git.

## Build checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run build` | Pass; loadable `extension/dist` generated |
| Backend suite in `.venv` | 88 passed, 41 skipped |
| Real M2 + M7 + M8 integration suite | 39 passed |

## Live HTTP smoke checks

`GET /v1/health` returned `mocked: ["M3", "M5"]`.

| Case | Input | Expected | Actual |
| --- | --- | --- | --- |
| Deterministic redaction | `My IC is 880412-08-5561` | redact | redact; `My IC is [MYKAD_1]` |
| Secret prevention | OpenAI API key | deny | deny |
| Salary review | `Gaji bulanan RM 8,500` | hold | hold |
| Semantic finance signal | `Quarterly revenue is below forecast.` | hold | hold; `DEPT_CONFIDENTIAL` |

## Live Chrome acceptance

Evidence was captured by manual screenshots during the live ChatGPT run.

| Case | Screenshot evidence | Result |
| --- | --- | --- |
| Popup health | Manual screenshot | Pass. Popup connected to `http://localhost:8000`, `MOCK_MODE` was off, and health displayed `Backend is mocking: M3, M5`. |
| MyKad redact | Manual screenshot | Pass. `880412-08-5561` was tokenised to `[MYKAD_1]` before ChatGPT received the prompt; banner showed `redacted before sending (MYKAD)`. |
| API key deny | Manual screenshot | Pass. Prompt containing `sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d` was blocked and remained in the composer; no ChatGPT user bubble was sent. |
| Salary hold | Manual screenshot | Pass. `Gaji bulanan RM 8,500` produced `held for compliance review -- waiting for approval` and was not sent immediately. |
| Salary approval send | Manual screenshot + backend status | Pass. `POST /v1/logs/{log_id}/decision` changed status to `approved`; the extension detected the approval and replayed the original salary prompt to ChatGPT. |

One UX polish landed after the acceptance run: successful sent-state banners
(`redacted before sending` and `approved -- sending now`) now disappear after
three seconds. Blocking banners such as `deny` and `waiting for approval` remain
visible.

## Push recommendation

The M2, M7 and M8 module changes plus the extension live acceptance flow are
ready for review. M3 and M5 remain mocked by design in this frame, so do not
claim an all-real-module demo until those land and `GET /v1/health` reports an
empty `mocked` list.
