# M4 — paste-ready prompt

Fresh session. Paste **part 1** (context block), then **part 2** (task).

> **Trimmed context block.** M4 is TypeScript and touches none of the Python
> internals, so the repo protocols and detector dataclasses are cut — pasting
> them into a TS session is noise that invites Codex to wander into Python.
> Everything that crosses M4's boundary is kept verbatim. If your team's rule
> is paste-it-whole, paste it whole; the trim is a judgment call, not a
> correction.

---

## Part 1 — CONTEXT BLOCK (M4 slice)

```
PROJECT
AI Governance Gateway. A Chrome extension plus a FastAPI policy plane that
inspects prompts and file attachments before they reach ChatGPT, Gemini or
Copilot, and returns one of four verdicts: allow | redact | hold | deny.

REPO LAYOUT (do not deviate)
  extension/                      M4  MV3 + Vite + TypeScript   <- YOU
    manifest.json
    vite.config.ts                    Vite + @crxjs/vite-plugin
    src/content.ts                    composer capture + send interception
    src/selectors.ts                  EVERY DOM selector, one exported object
    src/background.ts                 service worker: ALL network calls
    src/banner.ts                     inline banners
    src/types.ts                      IF-1/IF-2/IF-3 types
    src/mock.ts                       offline fallback, default OFF
    src/popup/                        badge + config
    README.md                         names every selector used
  backend/                        M0+M1  BUILT. Black box behind IF-2/IF-3.
  dashboard/                      M6  not built yet

FROZEN CONTRACTS
Never change these. Other modules are written against them in parallel by
people who cannot see your code.

IF-1  Content script -> Service worker
    chrome.runtime.sendMessage({
      prompt: string,
      files: { filename: string, mime: string, content_b64: string }[],
      targetHost: string
    })

IF-2  Service worker -> API      POST /v1/inspect
    request:
      { user_id: string, target_host: string, prompt: string,
        purpose: string = "GENERAL",
        attachments: { filename, mime, content_b64 }[] }
    response:
      { decision: "allow" | "redact" | "hold" | "deny",
        log_id: string,
        data_classes: string[],
        redacted_prompt: string | null,   // only when decision == "redact"
        reason: string }                  // one human-readable sentence

IF-3  Service worker -> API      GET /v1/inspect/{log_id}
    response: { decision, status }
    status ∈ auto | pending | approved | denied
    Poll while a prompt is held, until an admin approves or denies.

The decision enum is the spine of the whole system. It does not change.

GROUND RULES
1. The contracts above are law. If your module seems to need a change, stop
   and say so. Do not change it locally.
2. Build ONLY the module named in the task. Someone else already has the
   neighbouring one.
3. Every module ships with a way to prove it works from the command line.
4. Policy is data, not code. Never hardcode a rule or a hostname-to-tier
   mapping anywhere. The extension does not know what a data class means; it
   renders what the API tells it.
```

---

## Part 2 — M4 TASK

```
TASK: build M4, the Chrome extension. This is the entire demo. Budget
accordingly and do not gold-plate anything else.

Manifest V3, TypeScript, Vite, @crxjs/vite-plugin.

OWNERSHIP
I own the backbone: M0 (done), M1 (done), M4 (this task), M6 (day 4).
M2 detection, M3 decision engine, M5 file extractor and M7 vault belong to
other people and are not built. M1 serves mocks for all four, so the API
returns real verdicts over real HTTP today. Do not build any of them, and do
not build the dashboard.

THE BACKEND IS LIVE. DEVELOP AGAINST IT.                       [CHANGED]
    base URL  http://localhost:8000        (chrome.storage, overridable)
    header    X-Api-Key: <value from backend/.env>
    start     cd backend && REPO_BACKEND=memory uvicorn app.main:app --reload
    check     GET /v1/health -> { status, mocked: [...] }

The plan doc told you to develop against a hand-written mock because no
backend existed. One exists now. Real HTTP is the default and the only
integration proof — a mock agreeing with your own mock proves nothing.

WHILE M1'S MOCKS ARE ACTIVE, only these strings produce a non-allow verdict:
    "880412-08-5561"                    -> redact
    "sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d"  -> deny
    "RM 8,500"                          -> hold
    anything else                       -> allow
Everything else returning allow is CORRECT, not a bug in your interceptor.
When M2 lands, these become real patterns and not one line of yours changes.
Check GET /v1/health if a verdict surprises you.

IF-1 CARRIES NO user_id, BUT IF-2 REQUIRES ONE.            [GAP — read this]
The content script sends { prompt, files, targetHost }. POST /v1/inspect
requires user_id and purpose. The service worker supplies both:

  user_id  <- chrome.storage. DEFAULT IT TO A SEEDED USER. A fresh unpacked
              build with no user_id 403s on every prompt and looks broken.
              Seeded: admin@acme.my (admin/legal)
                      siti.finance@acme.my (staff/finance)
                      aiman.hr@acme.my (staff/hr)
                      wei.eng@acme.my (staff/engineering)
  purpose  <- "GENERAL".

NEVER send role or department. M1 resolves those from the users table (SD-2).
The extension runs on the employee's machine; a self-asserted role is a
self-issued permission, and that is the exact gap this product exists to
close.

CONTENT SCRIPT, matching chatgpt.com/* and gemini.google.com/*:
  - Find the composer. Anchor selectors on data-testid and ARIA roles, never
    on hashed class names. Put EVERY selector in one exported SELECTORS
    object in src/selectors.ts, so one file changes when a site changes.
  - Capture the send path in the CAPTURE phase: send-button click, and Enter
    without Shift in the composer. preventDefault and stopPropagation
    immediately; the site must not see the event until the verdict is back.
  - Capture attachments from the file input change event, read as base64.
  - Send via IF-1 to the service worker.
  - Act on the verdict:
      allow  -> replay the original send, guarded by a re-entrancy flag so
                the interceptor does not catch its own replay.
      redact -> replace composer contents with redacted_prompt, show an
                inline banner naming the data classes, then replay.
      hold   -> block, show a "waiting for approval" banner, poll IF-3 every
                3s for up to 5 minutes. On approved -> replay the ORIGINAL
                prompt. On denied -> denied banner, never replay. On timeout
                -> "still pending" banner, never replay.
      deny   -> block, show reason, never replay.

REPLAY: prefer clicking the real send button with the re-entrancy flag set
over re-dispatching a synthetic KeyboardEvent. React's handlers frequently
ignore synthetic key events, and you will lose an afternoon to it.

SERVICE WORKER: owns ALL network calls. POST IF-2, poll IF-3, attach
X-Api-Key, read base URL and user_id from chrome.storage. The content script
makes no fetch calls, ever.

POPUP: badge showing the last verdict, link to the dashboard, and fields for
base URL / user_id / API key. If GET /v1/health reports active mocks, say so
in the popup — during dev it is the difference between "my interceptor is
broken" and "the backend is mocked".

FAILURE MODES — decide these deliberately. This is where a governance tool
diverges from a demo that hangs.

  selector not found   -> do nothing, let the prompt through. Never throw,
                          never freeze the composer.
  API unreachable or
  timeout              -> fail OPEN: let it through, log, badge the popup.
                          A gateway that bricks the composer when the backend
                          blinks does not survive a demo. This IS a real
                          weakness: block the host and you bypass the tool.
                          Put it in the proposal as a known limitation with
                          fail-closed plus a local cache as future work. Do
                          not dress it up as a feature.
  403 unknown user     -> banner "extension not configured", let through.
  415 unsupported file -> BLOCK and say why. The API is up and telling us it
                          could not read the file. We cannot vouch for what
                          we never inspected, so this one fails CLOSED. Note
                          the distinction: fail-open on a dead backend is an
                          availability call; fail-open on a file we could not
                          read is a hole. Until M5 lands, mock_extract only
                          handles text/plain and text/csv, so PDFs 415 — that
                          is correct behaviour, not a bug.

MOCK_MODE: keep it, default OFF, in src/mock.ts. It exists for UI work with
no backend running. It is NOT the dev path and NOT the integration proof.

RISK: both sites obfuscate the DOM. A failed selector degrades to "do nothing
and let the prompt through" rather than throwing.

DELIVER
- A loadable unpacked build.
- README.md naming EVERY selector used, and where it came from.
- All four verdicts demonstrated against the REAL API using the trigger
  strings above, on a real chatgpt.com page.
- The full hold -> approve -> unblock loop, end to end. M6 does not exist
  yet, so approve with curl and watch the composer unblock within 3s:
      curl -X POST localhost:8000/v1/logs/{log_id}/decision \
           -H "X-Api-Key: $API_KEY" \
           -d '{"approve": true, "remark": "ok"}'
  This is the demo's climax and the riskiest thing I own. Prove it before
  polishing anything.
- MOCK_MODE working with the backend stopped, defaulting to off.
```

---

## Notes for whoever runs this

**Run `backbone_smoke.sh` before starting**, so a failure during M4 work is
provably M4's and not a backend regression.

**The `user_id` gap is the first thing to get right.** IF-1 has no `user_id`
and IF-2 requires one — a fresh build 403s on every prompt and looks like a
broken interceptor. Default it in `chrome.storage` to a seeded user.

**Two verdicts to check by hand,** since neither shows up in a unit test:
the re-entrancy flag (a replay that re-triggers the interceptor is an infinite
loop), and `redact` replacing composer contents *before* replay rather than
after.

**Open, still yours to decide:**
1. Fail-open on a dead backend. Right for the MVP, real weakness, belongs in
   the proposal rather than hidden.
2. `Forbidden` still lives in `vault/tokeniser.py` — move it before M7's owner
   rewrites that file under you.
3. `backbone_smoke.sh` has never run against `REPO_BACKEND=postgres`.
