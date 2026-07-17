# M6 — Employer dashboard

React + Vite + TypeScript + Tailwind + TanStack Query + Recharts + MSW +
react-router. Four screens over the backend's IF-7 and IF-10 endpoints:
audit log, approval queue, overview charts, and policy/tools.

## Run it

```bash
cd dashboard
npm install
cp .env.example .env       # edit if your backend runs somewhere else
npm run dev                 # http://localhost:5173
```

The backend must be running first (no Docker needed):

```bash
cd backend && REPO_BACKEND=memory uvicorn app.main:app --reload
```

It comes up seeded with 4 users, 15 rules, 3 AI tools and 30 audit rows —
enough for every chart and filter to have something to show on first load,
including 3 planted cross-department mismatches.

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run test         # vitest — the pivot and cross-department predicate
npm run build        # typecheck + production build to dist/
```

## VITE_USE_MSW

Three env vars, in `.env.example`:

- `VITE_API_BASE` — backend base URL.
- `VITE_API_KEY` — must match `backend/.env`'s `API_KEY`, or every request 403s.
- `VITE_USE_MSW` — **the offline fallback, not the default.** Leave it `false`
  to develop and demo against the real, live backend — that is the only real
  integration proof. Set it to `true` when you need the dashboard to run with
  no backend at all: on a train, or as a save-the-demo path if the hosted API
  is asleep. `src/mocks/handlers.ts` implements real filtering, real
  pagination and real optimistic writes against an in-memory list — the same
  shapes the real API returns — specifically so a mock you forgot you were
  running doesn't quietly lie to you.

  ```bash
  VITE_USE_MSW=true npm run dev   # backend can be stopped
  ```

## What's read-only in this MVP

**Screens 1 (Audit log) and 3 (Overview) are read-only.** Screen 2 (Approval
queue) and Screen 4 (Policy & tools' tools table) write — approve/deny a held
prompt, approve/block a tool. The **rules table on Screen 4 is read-only by
design for the MVP**: showing the rules at all is the point (policy is
configuration an organisation owns, not something hardcoded), and an edit
form is a stretch goal explicitly out of scope here. There is no "reveal
original prompt" control anywhere — a redacted prompt's original value lives
only in the encrypted vault, and retrieving it is itself audited; that is a
deliberate absence, not a missing feature.

## Auth

The login screen is cosmetic. It does not authenticate anyone, and the
backend records every review decision as a single hardcoded admin identity
(`DASHBOARD_ADMIN` in `backend/app/main.py`) regardless of what the login
form says. See the comment in `src/App.tsx`. Building real auth was
explicitly out of scope for this module.

## Design notes for whoever demos this

- Verdict colour is never the only signal — every badge pairs colour with a
  text label. `redact` and `hold` intentionally share the same amber; the
  label is what disambiguates them.
- The cross-department badge on Screen 1 and the `cross_department_only`
  server filter share one predicate (`isCrossDepartment`, exported from
  `src/screens/AuditLog.tsx`, unit-tested for the exact-0.6 boundary). The
  toggle filters server-side — it never filters the page you already loaded.
- The footer health chip reads `GET /v1/health` and shows which backend
  modules are still mocked. If a demo verdict looks wrong, check that chip
  before assuming the dashboard is broken.
