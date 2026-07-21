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
  return <div className="flex min-h-screen items-center justify-center bg-slate-50"><form className="w-80 space-y-4 rounded-xl border border-slate-200 bg-white p-7 shadow-sm" onSubmit={(event) => { event.preventDefault(); onLoggedIn(); }}><div><h1 className="text-lg font-bold">AI Governance Gateway</h1><p className="text-sm text-slate-500">Compliance dashboard</p></div><label className="block text-sm text-slate-700">Email<input type="email" className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" value={email} onChange={(event) => setEmail(event.target.value)} /></label><button type="submit" className="w-full rounded bg-emerald-800 px-3 py-2 text-sm font-semibold text-white">Log in</button><p className="text-xs text-slate-400">Demo login. Reviews are recorded as the demo administrator.</p></form></div>;
}

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", icon: "⌂" },
  { to: "/", label: "Audit Log", icon: "▤", end: true },
  { to: "/approvals", label: "Approval Queue", icon: "◈" },
];

function Sidebar() {
  const health = useHealthQuery();
  const pending = useLogsQuery({ limit: 1, offset: 0, status: "pending" });
  const live = Boolean(health.data && health.data.mocked.length === 0);
  return <aside className="sticky top-0 flex h-screen w-60 shrink-0 self-start flex-col bg-gradient-to-b from-[#033d35] via-[#023d35] to-[#012d29] px-3 py-5 text-white"><div className="mb-10 flex items-start gap-3 px-2"><span className="flex h-11 w-9 items-center justify-center rounded-[14px] border-2 border-white/90 text-2xl">♢</span><span className="text-lg font-bold leading-5">AI Governance<br />Gateway</span></div><nav className="space-y-1">{NAV_ITEMS.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition ${isActive ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-50 hover:bg-white/10"}`}><span className="w-4 text-center text-base">{item.icon}</span><span>{item.label}</span>{item.to === "/approvals" && (pending.data?.total ?? 0) > 0 && <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-xs">{pending.data?.total}</span>}</NavLink>)}<div className="pt-1"><NavLink to="/policy" className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition ${isActive ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-50 hover:bg-white/10"}`}><span className="w-4 text-center text-base">▧</span><span>Policy &amp; Tools</span></NavLink><div className="ml-5 mt-1 space-y-1 border-l border-white/15 pl-3"><NavLink to="/policy" end className={({ isActive }) => `block rounded px-2 py-2 text-xs font-medium ${isActive ? "bg-white/10 text-white" : "text-emerald-100 hover:text-white"}`}>Policy Rules</NavLink><NavLink to="/policy/redaction" className={({ isActive }) => `block rounded px-2 py-2 text-xs font-medium ${isActive ? "bg-white/10 text-white" : "text-emerald-100 hover:text-white"}`}>Redaction</NavLink><NavLink to="/policy/internal-documents" className={({ isActive }) => `block rounded px-2 py-2 text-xs font-medium ${isActive ? "bg-emerald-600 text-white" : "text-emerald-100 hover:text-white"}`}>Internal Documents</NavLink><NavLink to="/policy/ai-tools" className={({ isActive }) => `block rounded px-2 py-2 text-xs font-medium ${isActive ? "bg-white/10 text-white" : "text-emerald-100 hover:text-white"}`}>AI Tools</NavLink></div></div></nav><div className="mt-auto border-t border-white/10 pt-4"><div className="mb-4 flex items-center gap-2 px-3 text-xs text-emerald-100"><span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-300" : "bg-amber-300"}`} />{live ? "System live" : "Backend checking"}</div><div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold">CA</span><span className="min-w-0"><span className="block text-sm font-semibold">Compliance Admin</span><span className="block text-xs text-emerald-100">admin@acme.my</span></span></div></div></aside>;
}

function Shell() {
  return <div className="flex min-h-screen bg-[#f7f9fc]"><Sidebar /><div className="min-w-0 flex-1"><ErrorBoundary><Routes><Route path="/" element={<AuditLog />} /><Route path="/approvals" element={<ApprovalQueue />} /><Route path="/overview" element={<Overview />} /><Route path="/policy" element={<PolicyAndTools section="rules" />} /><Route path="/policy/redaction" element={<PolicyAndTools section="redaction" />} /><Route path="/policy/internal-documents" element={<PolicyAndTools section="documents" />} /><Route path="/policy/ai-tools" element={<PolicyAndTools section="tools" />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></ErrorBoundary></div></div>;
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => sessionStorage.getItem(LOGIN_STORAGE_KEY) === "1");
  if (!loggedIn) return <LoginGate onLoggedIn={() => { sessionStorage.setItem(LOGIN_STORAGE_KEY, "1"); setLoggedIn(true); }} />;
  return <HashRouter><Shell /></HashRouter>;
}
