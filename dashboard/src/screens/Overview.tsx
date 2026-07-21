import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";

import { useLogsQuery, useStatsQuery, useToolsQuery } from "../api/queries";
import type { Decision } from "../api/types";
import { DataClassPills } from "../components/DataClassPills";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { StatusBadge, VerdictBadge } from "../components/VerdictBadge";

const DECISIONS: Decision[] = ["allow", "redact", "hold", "deny"];
const COLORS: Record<Decision, { solid: string; soft: string; icon: string; symbol: string; description: string }> = {
  allow: { solid: "#169b5b", soft: "#e5f7ec", icon: "text-emerald-700", symbol: "✓", description: "Requests sent automatically" },
  redact: { solid: "#f59a20", soft: "#fff1dc", icon: "text-amber-600", symbol: "✎", description: "Sensitive values protected before send" },
  hold: { solid: "#7441dc", soft: "#efe9ff", icon: "text-violet-700", symbol: "Ⅱ", description: "Requests requiring review" },
  deny: { solid: "#ef3f3c", soft: "#ffe8e7", icon: "text-red-600", symbol: "／", description: "Requests blocked by policy" },
};

export interface DayPoint {
  date: string;
  allow: number;
  redact: number;
  hold: number;
  deny: number;
}

export function pivotByDay(byDay: [string, string, number][]): DayPoint[] {
  const map = new Map<string, DayPoint>();
  for (const [date, decision, count] of byDay) {
    const existing = map.get(date) ?? { date, allow: 0, redact: 0, hold: 0, deny: 0 };
    if (DECISIONS.includes(decision as Decision)) existing[decision as Decision] += count;
    map.set(date, existing);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function dateTime(ts: string) {
  return new Date(ts).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function promptExcerpt(text: string, max = 68) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function KpiCard({ decision, count, total, pending }: { decision: Decision; count: number; total: number; pending?: number }) {
  const color = COLORS[decision];
  return <article className="flex min-w-0 gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm"><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-3xl font-bold" style={{ backgroundColor: color.soft, color: color.solid }}>{color.symbol}</span><div><p className="font-semibold" style={{ color: color.solid }}>{decision[0].toUpperCase() + decision.slice(1)}</p><p className="mt-0.5 text-3xl font-bold tracking-tight text-slate-900">{count}</p><p className="mt-1 text-xs text-slate-600">{total ? `${((count / total) * 100).toFixed(1)}% of ${total} events` : "No activity yet"}</p><p className="mt-1 text-xs text-slate-600">{color.description}</p>{decision === "hold" && pending !== undefined && pending > 0 && <span className="mt-1 inline-flex rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">{pending} pending review</span>}</div></article>;
}

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}><div className="mb-3"><h2 className="text-sm font-bold text-slate-800">{title} <span className="ml-1 text-slate-400">ⓘ</span></h2>{subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div>{children}</section>;
}

function AttentionItem({ tone, symbol, title, description, to, action }: { tone: string; symbol: string; title: string; description: string; to: string; action: string }) {
  return <div className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-0"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${tone}`}>{symbol}</span><div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-800">{title}</p><p className="mt-0.5 text-xs leading-4 text-slate-500">{description}</p></div><Link to={to} className="whitespace-nowrap rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">{action} ›</Link></div>;
}

export default function Overview() {
  const stats = useStatsQuery();
  const pending = useLogsQuery({ limit: 1, offset: 0, status: "pending" });
  const cross = useLogsQuery({ limit: 1, offset: 0, cross_department_only: true });
  const recent = useLogsQuery({ limit: 100, offset: 0 });
  const tools = useToolsQuery();

  if (stats.isLoading) return <div className="p-7"><div className="h-12 w-56 animate-pulse rounded bg-slate-200" /><div className="mt-6 grid grid-cols-4 gap-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-slate-200" />)}</div></div>;
  if (stats.isError || !stats.data) return <div className="p-7"><ErrorState message={(stats.error as Error)?.message ?? "Unknown error"} /></div>;

  const byDecision = stats.data.by_decision;
  const total = DECISIONS.reduce((sum, decision) => sum + (byDecision[decision] ?? 0), 0);
  const byDay = pivotByDay(stats.data.by_day).slice(-7).map((row) => ({
    ...row,
    label: new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  }));
  const dataClasses = stats.data.top_data_classes.map(([name, count]) => ({ name, count }));
  const topUsers = stats.data.top_users.map(([name, count]) => ({ name, count }));
  const unapprovedTools = (tools.data ?? []).filter((tool) => tool.status === "unapproved").length;
  const highRisk = [...(recent.data?.items ?? [])].filter((row) => row.decision !== "allow").sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 5);
  const maxClass = Math.max(1, ...dataClasses.map((row) => row.count));
  const maxUser = Math.max(1, ...topUsers.map((row) => row.count));

  return <main className="space-y-4 px-5 py-6 lg:px-7">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold tracking-tight text-slate-950">Overview</h1><p className="mt-1 text-sm text-slate-500">Monitor AI usage, policy outcomes and current risk across the organization.</p></div><div className="flex items-center gap-4 pt-2 text-xs text-slate-600"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Live</span><span>Updated every 3s</span><button type="button" onClick={() => void stats.refetch()} className="text-lg text-slate-700">↻</button></div></header>

    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">{DECISIONS.map((decision) => <KpiCard key={decision} decision={decision} count={byDecision[decision] ?? 0} total={total} pending={decision === "hold" ? pending.data?.total : undefined} />)}</section>

    <section className="overview-top-grid gap-3"><Card title="Verdict Activity by Day" subtitle="Inspection outcomes by day (last 7 days)"><div className="h-48"><ResponsiveContainer width="100%" height="100%"><BarChart data={byDay} margin={{ top: 12, right: 5, left: -18, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e8edf4" /><XAxis dataKey="label" tick={{ fontSize: 11, fill: "#52627a" }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#52627a" }} axisLine={false} tickLine={false} /><Tooltip /><Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="allow" stackId="verdict" name="Allow" fill={COLORS.allow.solid} /><Bar dataKey="redact" stackId="verdict" name="Redact" fill={COLORS.redact.solid} /><Bar dataKey="hold" stackId="verdict" name="Hold" fill={COLORS.hold.solid} /><Bar dataKey="deny" stackId="verdict" name="Deny" fill={COLORS.deny.solid} /></BarChart></ResponsiveContainer></div></Card><Card title="Attention Required"><AttentionItem tone="bg-violet-100 text-violet-700" symbol="Ⅱ" title={`${pending.data?.total ?? 0} Pending Reviews`} description="Requests waiting for an administrator decision" to="/approvals" action="Open Approval Queue" /><AttentionItem tone="bg-amber-100 text-amber-700" symbol="◇" title={`${unapprovedTools} Unapproved AI Tools`} description="New hosts require approval or blocking" to="/policy/ai-tools" action="Review AI Tools" /><AttentionItem tone="bg-blue-100 text-blue-700" symbol="⌘" title={`${cross.data?.total ?? 0} Cross-department Events`} description="Higher-risk department mismatch detected" to="/" action="View Audit Log" /></Card></section>

    <section className="overview-middle-grid gap-3"><Card title="Top Detected Data Classes" subtitle="By number of detections (last 7 days)"><div className="space-y-2.5 pt-2">{dataClasses.length ? dataClasses.map((row, index) => <div key={row.name} className="grid grid-cols-[122px_1fr_28px] items-center gap-3 text-xs"><span className="font-semibold text-slate-700">{row.name}</span><span className="h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${(row.count / maxClass) * 100}%`, backgroundColor: ["#7441dc", "#4e87ed", "#10a295", "#f59a20", "#f6b644", "#5392f5"][index % 6] }} /></span><span className="font-bold text-slate-700">{row.count}</span></div>) : <EmptyState title="No detections yet" />}</div></Card><Card title="Top Users by Risk Events" subtitle="Counts only Redact, Hold and Deny events."><div className="space-y-3 pt-1">{topUsers.length ? topUsers.map((row, index) => <div key={row.name} className="grid grid-cols-[170px_1fr_26px] items-center gap-3 text-xs"><span className="flex min-w-0 items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 font-bold text-violet-700">{row.name[0].toUpperCase()}</span><span className="min-w-0"><span className="block truncate font-semibold text-slate-700">{row.name}</span><span className="block text-slate-500">Risk activity</span></span></span><span className="h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-violet-600" style={{ width: `${(row.count / maxUser) * 100}%` }} /></span><span className="font-bold text-slate-700">{row.count}</span></div>) : <EmptyState title="No risk events yet" />}</div></Card></section>

    <Card title="Recent High-Risk Activity" subtitle="Latest events with Hold, Redact or Deny verdicts."><div className="mb-3 flex justify-end"><Link to="/" className="text-xs font-semibold text-blue-700">View all in Audit Log ›</Link></div><div className="overflow-x-auto"><table className="min-w-[960px] w-full divide-y divide-slate-100 text-xs"><thead className="bg-slate-50 text-left text-slate-600"><tr>{["Time", "User (Department)", "Target Host (Tier)", "Data Classes", "Request / File", "Verdict", "Status"].map((title) => <th key={title} className="px-3 py-2.5 font-bold">{title}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{highRisk.map((row) => <tr key={row.log_id}><td className="whitespace-nowrap px-3 py-3 font-medium text-slate-700">{dateTime(row.ts)}</td><td className="px-3 py-3"><span className="block font-semibold text-slate-700">{row.user_id}</span><span className="block text-slate-500">{row.user_department ?? "—"}</span></td><td className="px-3 py-3"><span className="block font-semibold text-slate-700">{row.target_host}</span><span className="block text-slate-500">PUBLIC_AI</span></td><td className="px-3 py-3"><DataClassPills dataClasses={row.data_classes} /></td><td className="max-w-[320px] px-3 py-3"><span className="block text-slate-700">{row.filename ? `▧ ${row.filename}` : `“${promptExcerpt(row.prompt_text)}”`}</span><span className="block text-slate-500">{row.filename ? "Attachment" : "Prompt"}</span></td><td className="px-3 py-3"><VerdictBadge decision={row.decision} /></td><td className="px-3 py-3"><StatusBadge status={row.status} /></td></tr>)}</tbody></table>{highRisk.length === 0 && <EmptyState title="No high-risk activity yet" />}</div></Card>
  </main>;
}
