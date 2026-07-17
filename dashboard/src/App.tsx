// M6  Router + hardcoded admin login. Do NOT build real auth.

import { useState } from "react";
import { NavLink, Navigate, Route, HashRouter, Routes } from "react-router-dom";

import { useHealthQuery } from "./api/queries";
import ApprovalQueue from "./screens/ApprovalQueue";
import AuditLog from "./screens/AuditLog";
import Overview from "./screens/Overview";
import PolicyAndTools from "./screens/PolicyAndTools";

const LOGIN_STORAGE_KEY = "aigg-dashboard-logged-in";

// This "login" is cosmetic, for the demo, and does not authenticate anyone.
// Whatever is typed here, the backend records every review decision as
// DASHBOARD_ADMIN (see backend/app/main.py, DASHBOARD_ADMIN) -- there is
// exactly one reviewer identity in this MVP. Do not "fix" this form into a
// false claim about who approved what; building real auth is out of scope.
function LoginGate({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("admin@acme.my");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form
        className="w-80 space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          onLoggedIn();
        }}
      >
        <div>
          <h1 className="text-lg font-semibold text-gray-900">AI Governance Gateway</h1>
          <p className="text-sm text-gray-500">Compliance dashboard</p>
        </div>
        <label className="block text-sm text-gray-700">
          Email
          <input
            type="email"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Log in
        </button>
        <p className="text-xs text-gray-400">
          Demo login. Every review is recorded as the admin account regardless of who signs in.
        </p>
      </form>
    </div>
  );
}

function HealthChip() {
  const { data, isError } = useHealthQuery();

  if (isError) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600">
        <span className="h-2 w-2 rounded-full bg-gray-400" /> Backend unreachable
      </span>
    );
  }
  if (!data) {
    return <span className="text-xs text-gray-400">checking backend…</span>;
  }
  if (data.mocked.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">
        <span className="h-2 w-2 rounded-full bg-green-600" /> Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
      <span className="h-2 w-2 rounded-full bg-amber-600" /> Mocked: {data.mocked.join(", ")}
    </span>
  );
}

const NAV_ITEMS = [
  { to: "/", label: "Audit log", end: true },
  { to: "/approvals", label: "Approval queue", end: false },
  { to: "/overview", label: "Overview", end: false },
  { to: "/policy", label: "Policy & tools", end: false },
];

function Shell() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="text-base font-semibold text-gray-900">AI Governance Gateway</span>
          <nav className="flex gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded px-3 py-1.5 text-sm font-medium ${
                    isActive ? "bg-slate-900 text-white" : "text-gray-600 hover:bg-gray-100"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Routes>
          <Route path="/" element={<AuditLog />} />
          <Route path="/approvals" element={<ApprovalQueue />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/policy" element={<PolicyAndTools />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="border-t border-gray-200 bg-white px-4 py-2">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-xs text-gray-400">
          <span>Logged in as admin@acme.my (demo login -- see App.tsx)</span>
          <HealthChip />
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => sessionStorage.getItem(LOGIN_STORAGE_KEY) === "1");

  if (!loggedIn) {
    return (
      <LoginGate
        onLoggedIn={() => {
          sessionStorage.setItem(LOGIN_STORAGE_KEY, "1");
          setLoggedIn(true);
        }}
      />
    );
  }

  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
