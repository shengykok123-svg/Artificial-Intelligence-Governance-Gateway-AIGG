import { useState } from "react";
import { NavLink, Navigate, Route, HashRouter, Routes } from "react-router-dom";

import { useHealthQuery, useLogsQuery } from "./api/queries";
import { ErrorBoundary } from "./components/ErrorBoundary";
import ApprovalQueue from "./screens/ApprovalQueue";
import AuditLog from "./screens/AuditLog";
import Overview from "./screens/Overview";
import PolicyAndTools from "./screens/PolicyAndTools";

const LOGIN_STORAGE_KEY = "aigg-dashboard-logged-in";

function LoginGate({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("admin@acme.my");
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form
        className="w-84 space-y-4 rounded-xl border border-slate-200 bg-white p-8 shadow-md"
        onSubmit={(event) => {
          event.preventDefault();
          onLoggedIn();
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shadow">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">AI Governance Gateway</h1>
            <p className="text-xs text-slate-500">Employer Compliance Dashboard</p>
          </div>
        </div>
        <label className="block text-xs font-semibold text-slate-700">
          Email address
          <input
            type="email"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-700 transition"
        >
          Log in
        </button>
        <p className="text-center text-xs text-slate-400">Demo administrator login.</p>
      </form>
    </div>
  );
}

const NAV_ITEMS = [
  {
    to: "/overview",
    label: "Overview",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: "/",
    label: "Audit Log",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
    end: true,
  },
  {
    to: "/approvals",
    label: "Approval Queue",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
      </svg>
    ),
  },
];

function Sidebar() {
  const health = useHealthQuery();
  const pending = useLogsQuery({ limit: 1, offset: 0, status: "pending" });
  const live = Boolean(health.data && health.data.mocked.length === 0);

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-[#0b1426] px-4 py-5 text-white">
      {/* Brand Header */}
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div>
          <span className="block text-xs font-extrabold uppercase tracking-wider text-white">
            AI GOVERNANCE GATEWAY
          </span>
          <span className="block text-[11px] font-medium text-slate-400">Employer Dashboard</span>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <span>{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.to === "/approvals" && (
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                {pending.data?.total ?? 23}
              </span>
            )}
          </NavLink>
        ))}

        {/* Policy & Tools Section */}
        <div className="pt-1">
          <NavLink
            to="/policy"
            className={({ isActive }) =>
              `flex items-center justify-between rounded-lg px-3 py-2.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <div className="flex items-center gap-3">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              <span>Policy &amp; Tools</span>
            </div>
            <svg className="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </NavLink>

          <div className="ml-5 mt-1 space-y-0.5 border-l border-slate-700 pl-3">
            <NavLink
              to="/policy"
              end
              className={({ isActive }) =>
                `block rounded px-2.5 py-1.5 text-xs font-medium ${
                  isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
                }`
              }
            >
              Policy Rules
            </NavLink>
            <NavLink
              to="/policy/redaction"
              className={({ isActive }) =>
                `block rounded px-2.5 py-1.5 text-xs font-medium ${
                  isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
                }`
              }
            >
              Redaction
            </NavLink>
            <NavLink
              to="/policy/internal-documents"
              className={({ isActive }) =>
                `block rounded px-2.5 py-1.5 text-xs font-medium ${
                  isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
                }`
              }
            >
              Internal Documents
            </NavLink>
            <NavLink
              to="/policy/ai-tools"
              className={({ isActive }) =>
                `block rounded px-2.5 py-1.5 text-xs font-medium ${
                  isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
                }`
              }
            >
              AI Tools
            </NavLink>
          </div>
        </div>
      </nav>

      {/* Footer System Overview */}
      <div className="mt-auto border-t border-slate-800/80 pt-4">
        <p className="mb-2.5 px-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
          SYSTEM OVERVIEW
        </p>
        <div className="space-y-2 px-2 text-xs">
          <div className="flex items-center justify-between text-slate-300">
            <span>Inspection Service</span>
            <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Healthy
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span>Database</span>
            <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Healthy
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span>Extension Connectivity</span>
            <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Healthy
            </span>
          </div>
        </div>
        <p className="mt-4 px-2 text-[11px] text-slate-500">Version 1.0.0</p>
      </div>
    </aside>
  );
}

function HeaderBar() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Audit Log</h1>
        <p className="text-xs text-slate-500">
          Complete audit trail of all AI prompt inspections, policy decisions, and review actions.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Data as of: 12 May 2025, 10:24 AM</span>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
            title="Refresh data"
          >
            ↻
          </button>
        </div>

        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
          title="Help &amp; Documentation"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white shadow-sm">
            SC
          </div>
          <div className="text-left">
            <span className="block text-xs font-bold leading-none text-slate-900">Sarah Chong</span>
            <span className="block text-[11px] font-medium leading-tight text-slate-500">Compliance Administrator</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function Shell() {
  return (
    <div className="flex min-h-screen bg-[#f8fafc]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <HeaderBar />
        <main className="min-w-0 flex-1">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<AuditLog />} />
              <Route path="/approvals" element={<ApprovalQueue />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/policy" element={<PolicyAndTools section="rules" />} />
              <Route path="/policy/redaction" element={<PolicyAndTools section="redaction" />} />
              <Route path="/policy/internal-documents" element={<PolicyAndTools section="documents" />} />
              <Route path="/policy/ai-tools" element={<PolicyAndTools section="tools" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => sessionStorage.getItem(LOGIN_STORAGE_KEY) === "1");
  if (!loggedIn)
    return (
      <LoginGate
        onLoggedIn={() => {
          sessionStorage.setItem(LOGIN_STORAGE_KEY, "1");
          setLoggedIn(true);
        }}
      />
    );
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
