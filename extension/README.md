# M4 Chrome Extension

Manifest V3 + Vite + `@crxjs/vite-plugin` + TypeScript. The extension
intercepts sends on `chatgpt.com` and `gemini.google.com`, routes prompt text
and captured attachments through the gateway API, then applies the returned
verdict before the target site receives the send.

## Build And Load

Backend must be running first. From the repo root, run `scripts/setup-dev.ps1`
once to create a local `.env` with `MOCK_MODULES=M3` and
`VAULT_FERNET_KEY`, then start the API:

```powershell
cd "C:\path\to\HackAttack 3.0\backend"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Build the extension:

```powershell
cd "C:\path\to\HackAttack 3.0\extension"
npm install
npm run typecheck
npm run build
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Remove any old `AI Governance Gateway` entry.
4. Click **Load unpacked**.
5. Select `extension\dist`.
6. Open the popup and confirm it can reach `http://localhost:8000`.

Popup settings for the local demo:

```text
Base URL: http://localhost:8000
User ID: wei.eng@acme.my
API key: dev-key-change-me
MOCK_MODE: off
```

Expected popup health in the current frame:

```text
Backend is mocking: M3
```

## Current Frame

M2, M5, M7 and M8 are real. M3 remains mocked by design:

- M2 detects structured sensitive data such as MyKad, salary and secrets.
- M5 extracts text from TXT, CSV, PDF, DOCX and PPTX attachments.
- TXT/CSV attachments can be replaced in-browser with backend-returned
  redacted copies before upload.
- DOCX/PDF/PPTX attachments are extracted for allow/redact/hold/deny decisions,
  but redacted replacement copies are not generated for those formats yet.
- M7 tokenises redacted spans into encrypted reversible vault mappings.
- M8 classifies department/confidential semantic signals with local embeddings.
- M3 is still `mock_decide`.

`GET /v1/health` is the source of truth. Do not claim an all-real-module run
until it returns an empty `mocked` list.

## Selectors

All selectors live in `src/selectors.ts` as ordered candidate lists. If ChatGPT
or Gemini changes its composer or send button DOM, update that file and rerun
live acceptance.

| Site | Element | Candidates |
|---|---|---|
| chatgpt.com | composer | `#prompt-textarea`, `[data-testid="prompt-textarea"]`, `form [contenteditable="true"]` |
| chatgpt.com | send button | `[data-testid="send-button"]`, `button[aria-label="Send prompt"]`, `button[aria-label="Send message"]` |
| chatgpt.com | file input | `input[type="file"]` |
| gemini.google.com | composer | `rich-textarea div[contenteditable="true"]`, `div[aria-label="Enter a prompt here"]`, `[role="textbox"][contenteditable="true"]` |
| gemini.google.com | send button | `button[aria-label="Send message"]`, `button[aria-label="Submit"]`, `[data-testid="send-button"]` |
| gemini.google.com | file input | `input[type="file"]` |

If a selector is not found, the extension does nothing and lets the page's
native send path behave normally.

## Wiring

- `src/content.ts`: capture-phase click/keydown listeners, composer reads,
  banner UI, hold state, and replaying allowed/redacted/approved sends.
- `src/background.ts`: the only file that calls `fetch`; it owns API base URL,
  API key, user ID, `POST /v1/inspect`, and `GET /v1/inspect/{log_id}`.
- `src/mainworld.ts`: runs in the page's MAIN world and is the only code
  allowed to write the composer during redaction.
- `src/types.ts`: TypeScript mirror of IF-1/IF-2/IF-3 wire shapes.

Redaction writes are verified before replaying the send. If the composer cannot
be safely rewritten, the extension fails closed and blocks the original prompt.

## Hold Approval Loop

For a hold verdict, `content.ts` stores the active `log_id` and asks
`background.ts` for status every 3 seconds. `background.ts` performs the
backend status request. This avoids relying only on a Manifest V3 service
worker timer, which Chrome can suspend.

When the backend status becomes `approved`, the extension shows
`approved -- sending now`, replays the original prompt, and clears the success
banner after a short delay.

## Live Acceptance Cases

Use a fresh or refreshed ChatGPT tab after reloading the unpacked extension.

| Case | Prompt | Expected |
|---|---|---|
| MyKad redact | `My IC is 880412-08-5561` | ChatGPT receives `My IC is [MYKAD_1]` |
| API key deny | `Use this API key: sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d` | Prompt is blocked and remains in composer |
| Salary hold | `Please review this salary: Gaji bulanan RM 8,500` | Prompt is held until approval |
| Salary approval | Approve the latest pending hold | Extension sends the held prompt |
| TXT attachment redaction | Upload `mykad.txt` containing `880412-08-5561` | File is replaced with `mykad.redacted.txt` before upload |

Find and approve a pending hold:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/logs?status=pending&decision=hold&limit=5" -Headers @{ "X-Api-Key" = "dev-key-change-me" } | ConvertTo-Json -Depth 6
```

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/v1/logs/<log_id>/decision" `
  -Method Post `
  -Headers @{ "X-Api-Key" = "dev-key-change-me"; "Content-Type" = "application/json" } `
  -Body '{"approve":true,"remark":"Approved for acceptance test"}'
```

## Failure Modes

| Condition | Behaviour |
|---|---|
| selector not found | Do nothing; native page send continues |
| API unreachable / timeout | Fail open and replay original send |
| unknown user | Show unconfigured banner, then let it through |
| unsupported file | Fail closed and block |
| redaction write cannot be verified | Fail closed and block |

## MOCK_MODE

`src/mock.ts`, toggled in the popup, defaults off. It cycles
allow -> redact -> hold -> deny without a backend and auto-approves a hold
after 3 seconds. This is for UI iteration only, not integration proof.
