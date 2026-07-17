# M4 — Chrome extension

Manifest V3 + Vite + `@crxjs/vite-plugin` + TypeScript. Intercepts the send
path on `chatgpt.com` and `gemini.google.com`, routes the prompt through the
gateway API (IF-2/IF-3), and acts on the verdict before the site ever sees
the send.

## Build and load

```bash
cd extension
npm install
npm run build        # -> extension/dist, a loadable unpacked build
npm run dev           # HMR dev server, for iterating on content.ts/background.ts
```

Chrome -> `chrome://extensions` -> enable **Developer mode** -> **Load
unpacked** -> select `extension/dist`.

Backend must be running first:

```bash
cd backend && REPO_BACKEND=memory uvicorn app.main:app --reload
```

Open the popup once after loading to confirm `GET /v1/health` resolves — if
the backend is mocking any module, the popup says so.

## Every DOM selector, and where it came from

All selectors live in **`src/selectors.ts`**, nowhere else, as an ordered
list of candidates per site (first match wins). None are hashed class names.

| Site | Element | Candidates (in order) | Anchor |
|---|---|---|---|
| chatgpt.com | composer | `#prompt-textarea` | Stable element id on ChatGPT's contenteditable composer, unchanged across redesigns for a long time. |
| | | `[data-testid="prompt-textarea"]` | Fallback: same element by test id, in case the id above is dropped. |
| | | `form [contenteditable="true"]` | Last-resort structural fallback: the first contenteditable region inside the composer form. |
| chatgpt.com | send button | `[data-testid="send-button"]` | ChatGPT's send control has carried this test id for a long time; primary anchor. |
| | | `button[aria-label="Send prompt"]` | ARIA fallback if the test id changes. |
| | | `button[aria-label="Send message"]` | Second ARIA label ChatGPT has used for the same control. |
| chatgpt.com | file input | `input[type="file"]` | There is one file input feeding the composer's attachment flow; type selector is stable by construction (an `<input type="file">` cannot be restyled away). |
| gemini.google.com | composer | `rich-textarea div[contenteditable="true"]` | Gemini's composer is a `<rich-textarea>` custom element wrapping a contenteditable div; the custom element tag itself is a stable structural anchor. |
| | | `div[aria-label="Enter a prompt here"]` | ARIA label Gemini has shipped on the same input. |
| | | `[role="textbox"][contenteditable="true"]` | Structural ARIA-role fallback. |
| gemini.google.com | send button | `button[aria-label="Send message"]` | Primary ARIA anchor. |
| | | `button[aria-label="Submit"]` | Alternate label Gemini has used. |
| | | `[data-testid="send-button"]` | Test-id fallback in case Gemini adopts one. |
| gemini.google.com | file input | `input[type="file"]` | Same rationale as ChatGPT. |

**These candidates are built from publicly documented, historically stable
anchors, not verified against a live, logged-in session in this environment**
(no connected browser was available while building this). Before recording
the demo: open each site, inspect the composer/send button/file input, and
confirm the first candidate in each list still matches. If a site has
changed, add the new selector to the FRONT of that array in
`src/selectors.ts` — nothing else needs to change, by design.

If every candidate for an element fails to match, every lookup in
`selectors.ts` returns `null` and `content.ts` does nothing: no
`preventDefault`, no banner, the site's native send behaves exactly as if
the extension were not installed. There is no separate error path to keep
in sync — a missing composer and a missing send button degrade the same way.

## Wiring (IF-1 / IF-2 / IF-3)

- **`src/content.ts`** — capture-phase `click`/`keydown` listeners on
  `document` (not bound to a specific node, since both sites are SPAs that
  replace the composer/button on re-render). Intercepts a send, reads the
  composer text and any captured attachments, sends IF-1
  (`chrome.runtime.sendMessage`), and acts on the outcome. Never calls
  `fetch` — that is `background.ts`'s job alone.
- **`src/background.ts`** — the only place that calls `fetch`. Reads
  `baseUrl` / `userId` / `apiKey` / `mockMode` from `chrome.storage.local`,
  `POST`s IF-2, and for a `hold` verdict polls IF-3 every 3s for up to 5
  minutes *without* holding the original message channel open — it resolves
  the IF-1 response immediately (`hold`, pending) and later pushes a
  separate `HOLD_RESOLVED` message to the originating tab once the poll
  settles. This keeps the service worker's per-message lifetime short, which
  matters under MV3's lifecycle.
- **`src/types.ts`** — the TypeScript mirror of IF-1/IF-2/IF-3 and
  `backend/app/schemas.py`. Nothing else defines these shapes.
- **`src/mainworld.ts`** — a second content script injected with
  `"world": "MAIN"` (runs as the page's own JS, not the extension's isolated
  copy). It is the *only* code allowed to write the composer. `content.ts`
  runs isolated: it shares the DOM with the page but not the page's JS, so a
  DOM write from there is invisible to ChatGPT's/Gemini's own editor state
  (ProseMirror et al. keep an internal document model and re-render the DOM
  from it) — a write from the isolated world can leave the composer *looking*
  redacted while the internal model, which is what actually gets submitted,
  never saw it. `content.ts` asks `mainworld.ts` to do the write over
  `window.postMessage` (the standard bridge between the two worlds, since
  `window` message events are the one thing they share besides the DOM), then
  independently re-reads the DOM and requires it to hold the redacted text
  stable for 120ms before ever replaying. If the write fails or the text
  doesn't stick, the send is blocked entirely — redaction fails **closed**,
  never silently ships the original.

## user_id (the IF-1 -> IF-2 gap)

IF-1 carries no `user_id`; IF-2 requires one. `background.ts` defaults it to
a seeded user (`wei.eng@acme.my`) on install, so a fresh unpacked build
returns real verdicts instead of 403ing on the first prompt. Change it in
the popup — never role or department: those are resolved server-side from
the users table (SD-2), and the extension never sends either.

## Verdicts, against the mock plane

While M2/M3/M5/M7 are mocked, only these three strings produce a non-`allow`
verdict (see `GET /v1/health` for the current mocked list):

| Trigger string | Verdict |
|---|---|
| `880412-08-5561` | redact |
| `sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d` | deny |
| `RM 8,500` | hold |
| anything else | allow |

## Failure modes (deliberate, see `content.ts` / `background.ts`)

| Condition | Behaviour |
|---|---|
| selector not found | do nothing, let the prompt through untouched |
| API unreachable / timeout | fail **open**: replay the original send, log a console warning, badge the popup. Known limitation, not a feature — see below. |
| `403` unknown user | banner "extension not configured", then let it through |
| `415` unsupported file | fail **closed**: block, show why. We cannot vouch for a file we never inspected. |

## MOCK_MODE

`src/mock.ts`, toggled in the popup, **default off**. Cycles
allow -> redact -> hold -> deny on every send with no backend running,
auto-approving a `hold` after 3s so the offline demo still shows the full
loop. This is for UI iteration only — it is not the integration proof. The
real API, over real HTTP, is.

## Demo script: hold -> approve -> unblock

M6 doesn't exist yet, so approve by hand and watch the composer unblock
within ~3s of polling:

```bash
curl -X POST http://localhost:8000/v1/logs/<log_id>/decision \
     -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"approve": true, "remark": "ok"}'
```

Trigger a hold by sending `RM 8,500` as the prompt; `<log_id>` is in the
`InspectResponse` and in the popup's status line.

## Known limitations / open items

- **Fail-open on a dead backend is a real weakness**, not a demo shortcut.
  It is right for this MVP (a bricked composer does not survive a demo, and
  fail-closed here means the tool itself becomes the outage), but it belongs
  in the proposal as a named limitation, with fail-closed + a local decision
  cache as future work.
- `Forbidden` (used for the 403 mapping) currently lives in
  `backend/app/vault/tokeniser.py`, added by M1 as a seam. Move it before
  M7's owner rewrites that file out from under it.
- `backend/scripts/backbone_smoke.sh` has only run against
  `REPO_BACKEND=memory`, never `postgres`.
- Selectors are built from public knowledge, not a live-verified DOM — see
  the table above.
