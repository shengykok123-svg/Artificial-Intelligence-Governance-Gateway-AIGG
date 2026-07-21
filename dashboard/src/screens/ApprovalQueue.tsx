import { useEffect, useMemo, useState } from "react";

import { downloadAttachment } from "../api/client";
import { useLogDecisionMutation, useLogsQuery, useToolsQuery } from "../api/queries";
import type { AiTool, AuditRecord } from "../api/types";
import { DataClassPills } from "../components/DataClassPills";
import { EmptyState, ErrorState, SkeletonRows } from "../components/EmptyState";
import { StatusBadge, VerdictBadge } from "../components/VerdictBadge";

const COLUMN_COUNT = 6;

function isCrossDepartment(row: AuditRecord): boolean {
  return Boolean(
    row.content_department &&
      row.user_department &&
      row.content_department !== row.user_department &&
      row.department_confidence > 0.6,
  );
}

function minutesAgo(ts: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60_000));
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function excerpt(text: string, max = 58): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function CompactDetail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[118px_1fr] gap-2 py-1.5 text-xs leading-5"><span className="text-slate-500">{label}</span><span className="min-w-0 break-words font-medium text-slate-700">{children}</span></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-4"><h3 className="mb-3 text-sm font-bold text-slate-800">{title}</h3>{children}</section>;
}

function PendingDetail({
  row,
  tool,
  close,
}: {
  row: AuditRecord | null;
  tool: AiTool | undefined;
  close: () => void;
}) {
  const decision = useLogDecisionMutation();
  const [remark, setRemark] = useState("");
  const [tab, setTab] = useState<"overview" | "prompt" | "attachment">("overview");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => { setRemark(""); setTab("overview"); }, [row?.log_id]);

  if (!row) return <aside className="flex min-h-[680px] items-center justify-center border-l border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">Select a pending request to review its evidence.</aside>;

  const cross = isCrossDepartment(row);
  const selectedLogId = row.log_id;
  async function handleDownload() {
    setDownloading(true);
    try { await downloadAttachment(selectedLogId); } finally { setDownloading(false); }
  }

  return <aside className="relative flex min-h-0 flex-col border-l border-slate-200 bg-slate-50">
    <div className="flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
      <div><span className="inline-flex rounded bg-violet-100 px-2 py-1 text-[10px] font-bold tracking-wide text-violet-700">PENDING REVIEW</span><p className="mt-2 text-xs font-semibold text-slate-700">Event ID: {row.log_id.slice(0, 18)}…</p></div>
      <button type="button" onClick={close} className="rounded p-1 text-lg leading-none text-slate-500 hover:bg-slate-100" aria-label="Close request detail">×</button>
    </div>
    <div className="border-b border-slate-200 bg-white px-5 pb-4"><div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-slate-700"><p className="font-bold">⚠ This request has not been sent to any AI tool.</p><p className="mt-1">Your decision will be sent to the employee's browser within ~3 seconds.</p></div></div>
    <div className="flex border-b border-slate-200 bg-white px-5"><button type="button" onClick={() => setTab("overview")} className={`border-b-2 px-4 py-3 text-xs font-semibold ${tab === "overview" ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500"}`}>Overview</button><button type="button" onClick={() => setTab("prompt")} className={`border-b-2 px-4 py-3 text-xs font-semibold ${tab === "prompt" ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500"}`}>Full prompt</button><button type="button" disabled={!row.filename} onClick={() => setTab("attachment")} className={`border-b-2 px-4 py-3 text-xs font-semibold disabled:opacity-40 ${tab === "attachment" ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500"}`}>Attachment{row.filename ? " (1)" : ""}</button></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {tab === "prompt" && <Panel title="Full prompt"><p className="max-h-[520px] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-700">{row.prompt_text}</p></Panel>}
      {tab === "attachment" && row.filename && <Panel title="Attachment"><p className="mb-4 break-all text-sm font-semibold text-slate-700">▧ {row.filename}</p><button type="button" onClick={handleDownload} disabled={downloading} className="rounded-md border border-emerald-700 px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">{downloading ? "Downloading…" : "↓ Download attachment"}</button><p className="mt-4 text-xs leading-5 text-slate-500">The prepared redacted copy will be released if this request is approved.</p></Panel>}
      {tab === "overview" && <div className="approval-detail-grid gap-3">
        <Panel title="Basic information"><CompactDetail label="Time">{formatTs(row.ts)}</CompactDetail><CompactDetail label="Employee">{row.user_id}</CompactDetail><CompactDetail label="User department">{row.user_department ?? "—"}</CompactDetail><CompactDetail label="Target host">{row.target_host}</CompactDetail><CompactDetail label="AI tool tier">{tool?.tier ?? "UNKNOWN"}</CompactDetail></Panel>
        <Panel title="Policy decision"><CompactDetail label="Verdict"><VerdictBadge decision={row.decision} /></CompactDetail><CompactDetail label="Policy reason">{row.reason}</CompactDetail></Panel>
        <Panel title="Purpose & justification"><CompactDetail label="Purpose">{row.purpose}</CompactDetail><CompactDetail label="Justification">{row.justification ?? "—"}</CompactDetail></Panel>
        <Panel title="Detection evidence"><div className="border-b border-slate-100 py-2 text-xs"><p className="font-semibold text-slate-700">⌁ M2 structured detection</p><div className="mt-2"><DataClassPills dataClasses={row.data_classes} /></div></div><div className="flex justify-between border-b border-slate-100 py-2 text-xs"><span className="font-semibold text-slate-700">⌁ M8 similarity</span><span>{row.m8_department ?? "—"} · {row.m8_confidence.toFixed(2)}</span></div><div className="flex justify-between py-2 text-xs"><span className="font-semibold text-slate-700">⌁ M9 classification</span><span className="text-right">{row.m9_department ?? "—"} · {row.m9_confidence.toFixed(2)}<br />Sensitivity · {row.m9_sensitivity_confidence.toFixed(2)}</span></div></Panel>
        <Panel title="Review information"><CompactDetail label="Review status"><StatusBadge status={row.status} /></CompactDetail><CompactDetail label="Reviewer">{row.reviewer ?? "—"}</CompactDetail><CompactDetail label="Reviewed at">{row.reviewed_at ? formatTs(row.reviewed_at) : "—"}</CompactDetail><CompactDetail label="Reviewer remark">{row.remark ?? "—"}</CompactDetail></Panel>
        <Panel title="Attachment">{row.filename ? <><p className="mb-3 break-all text-xs font-semibold text-slate-700">▧ {row.filename}</p><button type="button" onClick={handleDownload} disabled={downloading} className="rounded-md border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">{downloading ? "Downloading…" : "↓ Download attachment"}</button><p className="mt-3 text-xs text-slate-500">Prepared redacted copy will be released if approved.</p></> : <p className="text-xs text-slate-500">No attachment was included.</p>}</Panel>
      </div>}
    </div>
    <footer className="border-t border-slate-200 bg-white p-4"><label className="mb-2 block text-xs font-semibold text-slate-600">Reviewer remark <span className="font-normal">(optional)</span></label><div className="flex flex-col gap-3 sm:flex-row"><input value={remark} onChange={(event) => setRemark(event.target.value)} maxLength={500} placeholder="Add a comment that will be recorded in the audit log…" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-3 text-sm outline-none focus:border-emerald-600" /><button type="button" disabled={decision.isPending} onClick={() => decision.mutate({ logId: row.log_id, body: { approve: false, remark } })} className="rounded-md border border-red-300 px-5 py-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Deny request</button><button type="button" disabled={decision.isPending} onClick={() => decision.mutate({ logId: row.log_id, body: { approve: true, remark } })} className="rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">✓ Approve & release</button></div><p className="mt-1 text-xs text-slate-400">{remark.length} / 500 characters</p></footer>
  </aside>;
}

export default function ApprovalQueue() {
  const [crossDepartmentOnly, setCrossDepartmentOnly] = useState(false);
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const logs = useLogsQuery({ limit: 200, offset: 0, status: "pending", cross_department_only: crossDepartmentOnly || undefined });
  const tools = useToolsQuery();
  const toolByHost = useMemo(() => new Map((tools.data ?? []).map((tool) => [tool.host, tool])), [tools.data]);
  const items = useMemo(() => [...(logs.data?.items ?? [])].sort((a, b) => sort === "oldest" ? a.ts.localeCompare(b.ts) : b.ts.localeCompare(a.ts)), [logs.data?.items, sort]);
  const selected = items.find((item) => item.log_id === selectedId) ?? null;

  useEffect(() => { if (items.length && !selectedId) setSelectedId(items[0].log_id); if (selectedId && !items.some((item) => item.log_id === selectedId)) setSelectedId(null); }, [items, selectedId]);

  return <div className="approval-layout">
    <main className="min-w-0 px-5 py-6 lg:px-7"><header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-bold tracking-tight text-slate-950">Approval Queue <span className="align-middle rounded-full bg-violet-100 px-2 py-1 text-base text-violet-700">{logs.data?.total ?? 0}</span></h1><p className="mt-1 text-sm text-slate-500">Review AI requests that are on hold. Nothing in this queue has been sent to an AI tool.</p></div><button type="button" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm">⚙ Queue settings</button></header>
      <section className="mb-4 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><label className="grid gap-1 text-xs font-medium text-slate-600">Sort by<select value={sort} onChange={(event) => setSort(event.target.value as "oldest" | "newest")} className="min-w-44 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label><label className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={crossDepartmentOnly} onChange={(event) => setCrossDepartmentOnly(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-700" /> Cross-department events only</label><button type="button" onClick={() => { setCrossDepartmentOnly(false); setSort("oldest"); }} className="mb-0.5 ml-auto text-xs font-semibold text-slate-700">☷ Clear filters</button></section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="divide-y divide-slate-100">{logs.isLoading && <table className="w-full"><tbody><SkeletonRows rows={6} columns={COLUMN_COUNT} /></tbody></table>}{!logs.isLoading && items.map((row) => { const cross = isCrossDepartment(row); const isSelected = row.log_id === selectedId; const tool = toolByHost.get(row.target_host); return <button type="button" key={row.log_id} onClick={() => setSelectedId(row.log_id)} className={`approval-list-row w-full gap-3 px-3 py-4 text-left text-xs transition hover:bg-emerald-50/40 ${isSelected ? "border-l-4 border-violet-600 bg-violet-50/50 pl-2" : "border-l-4 border-transparent"}`}><span className="font-semibold text-slate-700">{minutesAgo(row.ts)}</span><span><span className="block font-semibold text-slate-800">{row.user_id}</span><span className="mt-1 block text-slate-500">{row.user_department ?? "—"} → {row.content_department ?? "—"}</span>{cross && <span className="mt-2 inline-flex rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Cross-department ({row.department_confidence.toFixed(2)})</span>}</span><span><span className="block font-semibold text-slate-700">{row.target_host}</span><span className="mt-1 block text-[10px] font-semibold tracking-wide text-slate-500">{tool?.tier ?? "UNKNOWN"}</span></span><span><span className="block leading-5 text-slate-700">{row.filename ? `▧ ${row.filename}` : `“${excerpt(row.prompt_text)}”`}</span>{row.filename && <span className="mt-1 block text-slate-500">⌕ 1 attachment</span>}</span><span><DataClassPills dataClasses={row.data_classes} /></span><span className="self-center text-lg text-slate-700">›</span></button>; })}</div>{!logs.isLoading && logs.isError && <ErrorState message={(logs.error as Error).message} />}{!logs.isLoading && !logs.isError && items.length === 0 && <EmptyState title="Nothing waiting for review" hint="Held prompts will show up here in real time." />}</section><p className="mt-4 text-xs text-slate-500">Showing 1 to {items.length} of {logs.data?.total ?? 0} pending requests</p></main>
    <div className="approval-detail-pane"><PendingDetail row={selected} tool={selected ? toolByHost.get(selected.target_host) : undefined} close={() => setSelectedId(null)} /></div>
  </div>;
}
