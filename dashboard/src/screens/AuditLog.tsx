import { useEffect, useMemo, useState } from "react";

import { downloadAttachment } from "../api/client";
import { useLogDecisionMutation, useLogsQuery, useStatsQuery, useToolsQuery } from "../api/queries";
import type { AiTool, AuditRecord, Decision, LogStatus } from "../api/types";
import { DataClassPills } from "../components/DataClassPills";
import { EmptyState, ErrorState, SkeletonRows } from "../components/EmptyState";
import { StatusBadge, VerdictBadge } from "../components/VerdictBadge";

const PAGE_SIZE = 20;
const COLUMN_COUNT = 10;

const verdictMeta: Record<Decision, { label: string; symbol: string; ring: string; tone: string }> = {
  allow: { label: "Allow", symbol: "✓", ring: "border-emerald-600 text-emerald-700", tone: "bg-emerald-50" },
  redact: { label: "Redact", symbol: "✎", ring: "border-amber-500 text-amber-600", tone: "bg-amber-50" },
  hold: { label: "Hold", symbol: "Ⅱ", ring: "border-violet-600 text-violet-700", tone: "bg-violet-50" },
  deny: { label: "Deny", symbol: "／", ring: "border-red-600 text-red-600", tone: "bg-red-50" },
};

function excerpt(text: string, max = 72): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
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

function shortTime(ts: string): { date: string; time: string } {
  const date = new Date(ts);
  return {
    date: date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }),
    time: date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

export function isCrossDepartment(row: AuditRecord): boolean {
  return Boolean(
    row.content_department &&
      row.user_department &&
      row.content_department !== row.user_department &&
      row.department_confidence > 0.6,
  );
}

function Confidence({ value }: { value: number }) {
  return <span className="font-medium tabular-nums text-slate-700">{value.toFixed(2)}</span>;
}

function VerdictCard({ decision, count, total }: { decision: Decision; count: number; total: number }) {
  const meta = verdictMeta[decision];
  const pct = total === 0 ? "0.0" : ((count / total) * 100).toFixed(1);
  return (
    <article className="flex min-w-0 items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
        <span className={`flex h-8 w-8 items-center justify-center rounded-full border-[3px] text-xl font-bold ${meta.ring}`}>
          {meta.symbol}
        </span>
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{count.toLocaleString()}</p>
        <p className="text-xs text-slate-500">({pct}%)</p>
      </div>
    </article>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3.5">
      <h3 className="mb-3 text-sm font-bold text-slate-800">{title}</h3>
      {children}
    </section>
  );
}

function DetailPair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-2 py-1 text-xs leading-5">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 break-words font-medium text-slate-700">{children}</span>
    </div>
  );
}

function DetectorLine({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <span className={`mt-0.5 h-5 w-5 rounded-md ${tone} text-center text-sm leading-5`}>⌁</span>
        {label}
      </span>
      <span className="text-right text-xs text-slate-600">
        <span className="block font-medium">{value}</span>
        {detail && <span className="block text-slate-500">{detail}</span>}
      </span>
    </div>
  );
}

function EvidenceDrawer({
  row,
  tool,
  onClose,
}: {
  row: AuditRecord | null;
  tool: AiTool | undefined;
  onClose: () => void;
}) {
  const decision = useLogDecisionMutation();
  const [remark, setRemark] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => setRemark(""), [row?.log_id]);

  if (!row) {
    return (
      <aside className="audit-evidence-drawer flex min-h-[580px] items-center justify-center border-l border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
        Select an audit event to inspect its policy evidence.
      </aside>
    );
  }

  const isPending = row.status === "pending";
  const cross = isCrossDepartment(row);
  const selectedLogId = row.log_id;

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadAttachment(selectedLogId);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <aside className="audit-evidence-drawer relative flex min-h-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-700">Event ID: <span className="font-medium">{row.log_id.slice(0, 18)}…</span></p>
          <p className="mt-2 text-xs font-semibold text-slate-700">
            {isPending ? "This request is waiting for compliance approval." : "Inspection evidence and review history."}
          </p>
        </div>
        <button type="button" className="-mr-1 -mt-1 rounded p-1 text-lg leading-none text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Close event detail">×</button>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        <DetailSection title="Overview">
          <DetailPair label="Time">{formatTs(row.ts)}</DetailPair>
          <DetailPair label="User">{row.user_id}</DetailPair>
          <DetailPair label="User department">{row.user_department ?? "—"}</DetailPair>
          <DetailPair label="Target host">{row.target_host}</DetailPair>
          <DetailPair label="AI tool tier">{tool?.tier ?? "UNKNOWN"}</DetailPair>
          <DetailPair label="Request type">{row.filename ? "Prompt + file" : "Prompt"}</DetailPair>
          <DetailPair label="Character count">{row.prompt_text.length} characters</DetailPair>
        </DetailSection>

        <DetailSection title="Full prompt">
          <p className="mb-2 text-[11px] text-slate-500">
            Audit-safe content. Redacted requests show the redacted version.
          </p>
          <div className="max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700 whitespace-pre-wrap">
            {row.prompt_text}
          </div>
        </DetailSection>

        {row.filename && (
          <DetailSection title="Attachment">
            <p className="mb-3 break-all text-xs font-medium text-slate-700">⌕ {row.filename}</p>
            <button type="button" onClick={handleDownload} disabled={downloading} className="w-full rounded-md border border-emerald-700 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
              {downloading ? "Downloading…" : "↓ Download attachment"}
            </button>
          </DetailSection>
        )}

        <DetailSection title="Policy decision">
          <DetailPair label="Verdict"><VerdictBadge decision={row.decision} /></DetailPair>
          <DetailPair label="Policy reason">{row.reason}</DetailPair>
        </DetailSection>

        <DetailSection title="Purpose & justification">
          <DetailPair label="Purpose">{row.purpose}</DetailPair>
          <DetailPair label="Justification">{row.justification ?? "—"}</DetailPair>
        </DetailSection>

        <DetailSection title="Departments">
          <DetailPair label="User department">{row.user_department ?? "—"}</DetailPair>
          <DetailPair label="Content department">{row.content_department ? `${row.content_department} (${row.department_confidence.toFixed(2)})` : "—"}</DetailPair>
          <DetailPair label="Cross-department">{cross ? `Yes (${row.cross_department_confidence?.toFixed(2) ?? row.department_confidence.toFixed(2)})` : "No"}</DetailPair>
        </DetailSection>

        <DetailSection title="Detection evidence">
          <DetectorLine label="M2 structured detection" value={row.data_classes.length ? row.data_classes.join(", ") : "No structured classes"} tone="bg-red-50 text-red-600" />
          <DetectorLine label="M8 similarity" value={row.m8_department ? `${row.m8_department} · ${row.m8_confidence.toFixed(2)}` : "No M8 attribution"} tone="bg-emerald-50 text-emerald-600" />
          <DetectorLine label="M9 classification" value={row.m9_department ? `Department: ${row.m9_department} (${row.m9_confidence.toFixed(2)})` : "No M9 attribution"} detail={`Sensitivity: ${row.m9_sensitivity_confidence.toFixed(2)}`} tone="bg-violet-50 text-violet-600" />
        </DetailSection>

        <DetailSection title="Review information">
          <DetailPair label="Review status"><StatusBadge status={row.status} /></DetailPair>
          <DetailPair label="Reviewer">{row.reviewer ?? "—"}</DetailPair>
          <DetailPair label="Reviewed at">{row.reviewed_at ? formatTs(row.reviewed_at) : "—"}</DetailPair>
          <DetailPair label="Reviewer remark">{row.remark ?? "—"}</DetailPair>
        </DetailSection>

      </div>

      {isPending && (
        <div className="space-y-2 border-t border-slate-200 bg-white p-4">
          <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Reviewer remark (optional)" className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs outline-none focus:border-emerald-600" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={decision.isPending} onClick={() => decision.mutate({ logId: row.log_id, body: { approve: false, remark } })} className="rounded-md border border-red-300 px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Deny</button>
            <button type="button" disabled={decision.isPending} onClick={() => decision.mutate({ logId: row.log_id, body: { approve: true, remark } })} className="rounded-md bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Approve & release</button>
          </div>
        </div>
      )}
    </aside>
  );
}

export default function AuditLog() {
  const [decision, setDecision] = useState<Decision | "">("");
  const [status, setStatus] = useState<LogStatus | "">("");
  const [crossDepartmentOnly, setCrossDepartmentOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const logs = useLogsQuery({
    limit: PAGE_SIZE,
    offset,
    decision: decision || undefined,
    status: status || undefined,
    cross_department_only: crossDepartmentOnly || undefined,
  });
  const stats = useStatsQuery();
  const tools = useToolsQuery();

  const items = logs.data?.items ?? [];
  const total = logs.data?.total ?? 0;
  const selected = items.find((item) => item.log_id === selectedId) ?? null;
  const toolByHost = useMemo(() => new Map((tools.data ?? []).map((tool) => [tool.host, tool])), [tools.data]);

  useEffect(() => {
    if (items.length && !selectedId) setSelectedId(items[0].log_id);
    if (selectedId && !items.some((item) => item.log_id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  function resetFilters() {
    setDecision("");
    setStatus("");
    setCrossDepartmentOnly(false);
    setOffset(0);
  }

  const byDecision = stats.data?.by_decision ?? {};
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="audit-layout">
      <main className="audit-main min-w-0 px-5 py-6 lg:px-7">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">Audit Log</h1>
            <p className="mt-1 text-sm text-slate-500">Evidence trail for every AI request inspected by the gateway.</p>
          </div>
          <div className="flex items-center gap-3 pt-2 text-xs text-slate-600">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Live</span>
            <span>Updated every 3s</span>
            <button type="button" onClick={() => void logs.refetch()} className="rounded p-1 text-lg text-slate-600 hover:bg-slate-100" title="Refresh audit log">↻</button>
          </div>
        </header>

        <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {(["allow", "redact", "hold", "deny"] as Decision[]).map((item) => (
            <VerdictCard key={item} decision={item} count={byDecision[item] ?? 0} total={Object.values(byDecision).reduce((sum, value) => sum + value, 0)} />
          ))}
        </section>

        <section className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <label className="grid gap-1 text-xs font-medium text-slate-600">Verdict
            <select value={decision} onChange={(e) => { setDecision(e.target.value as Decision | ""); setOffset(0); }} className="min-w-40 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-emerald-600">
              <option value="">All</option><option value="allow">Allow</option><option value="redact">Redact</option><option value="hold">Hold</option><option value="deny">Deny</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-600">Review status
            <select value={status} onChange={(e) => { setStatus(e.target.value as LogStatus | ""); setOffset(0); }} className="min-w-40 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-emerald-600">
              <option value="">All</option><option value="auto">Auto</option><option value="pending">Pending review</option><option value="approved">Approved</option><option value="denied">Denied</option>
            </select>
          </label>
          <label className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={crossDepartmentOnly} onChange={(e) => { setCrossDepartmentOnly(e.target.checked); setOffset(0); }} className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600" /> Cross-department events only <span title="Content department differs from user department at confidence above 0.60" className="rounded-full border border-slate-300 px-1.5 text-slate-500">i</span></label>
          <button type="button" onClick={resetFilters} className="mb-0.5 ml-auto rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">↻ Clear filters</button>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[1120px] w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  {["Time", "User (department)", "Target host (tier)", "Request", "Data classes", "Departments", "M8 / M9", "Purpose", "Verdict", "Status"].map((heading) => <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.isLoading && <SkeletonRows rows={7} columns={COLUMN_COUNT} />}
                {!logs.isLoading && items.map((row) => {
                  const time = shortTime(row.ts);
                  const cross = isCrossDepartment(row);
                  const tool = toolByHost.get(row.target_host);
                  const selectedRow = row.log_id === selectedId;
                  return <tr key={row.log_id} onClick={() => setSelectedId(row.log_id)} className={`cursor-pointer align-top transition-colors hover:bg-emerald-50/40 ${selectedRow ? "bg-blue-50/70" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-4 font-medium text-slate-700"><span className="block">{time.date}</span><span className="mt-1 block text-slate-500">{time.time}</span></td>
                    <td className="px-3 py-4"><span className="block font-medium text-slate-800">{row.user_id}</span><span className="mt-1 block text-slate-500">{row.user_department ?? "—"}</span></td>
                    <td className="px-3 py-4"><span className="block font-medium text-slate-700">{row.target_host}</span><span className="mt-1 block text-[10px] font-semibold tracking-wide text-slate-500">{tool?.tier ?? "UNKNOWN"}</span></td>
                    <td className="max-w-[190px] px-3 py-4"><span className="block leading-5 text-slate-700">{row.filename ? `▧ ${row.filename}` : `“${excerpt(row.prompt_text, 56)}”`}</span><span className="mt-1 block text-slate-500">{row.filename ? "Attachment" : `Prompt · ${row.prompt_text.length} chars`}</span></td>
                    <td className="px-3 py-4"><DataClassPills dataClasses={row.data_classes} /></td>
                    <td className="px-3 py-4"><span className="block text-slate-700">{row.user_department ?? "—"} → {row.content_department ?? "—"}</span>{cross ? <><span className="mt-1 inline-flex rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Cross-department</span><span className="mt-1 block text-slate-500">Conf: <Confidence value={row.department_confidence} /></span></> : <span className="mt-1 block text-slate-500">Conf: <Confidence value={row.department_confidence} /></span>}</td>
                    <td className="px-3 py-4 leading-5"><span className="block"><span className="mr-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-700">M8</span> {row.m8_department ?? "—"} · <Confidence value={row.m8_confidence} /></span><span className="mt-1 block"><span className="mr-1 rounded bg-violet-100 px-1 py-0.5 text-[10px] font-bold text-violet-700">M9</span> {row.m9_department ?? "—"} · <Confidence value={row.m9_confidence} /></span><span className="mt-1 block text-slate-500">Sensitivity · <Confidence value={row.m9_sensitivity_confidence} /></span></td>
                    <td className="max-w-[115px] px-3 py-4 text-slate-700">{row.purpose}</td>
                    <td className="px-3 py-4"><VerdictBadge decision={row.decision} /></td>
                    <td className="px-3 py-4"><StatusBadge status={row.status} /></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {!logs.isLoading && logs.isError && <ErrorState message={(logs.error as Error).message} />}
          {!logs.isLoading && !logs.isError && items.length === 0 && <EmptyState title="No matching prompts" hint="Try clearing a filter, or come back once traffic arrives." />}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
            <span>{total === 0 ? "0 results" : `Showing ${offset + 1} to ${Math.min(offset + PAGE_SIZE, total)} of ${total} results`}</span>
            <div className="flex items-center gap-2"><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="rounded border border-slate-200 px-3 py-1.5 disabled:opacity-40">‹</button><span className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800">{currentPage}</span><span>of {pageCount}</span><button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} className="rounded border border-slate-200 px-3 py-1.5 disabled:opacity-40">›</button></div>
            <span className="rounded border border-slate-200 px-3 py-1.5">20 / page</span>
          </footer>
        </section>
      </main>
      <EvidenceDrawer row={selected} tool={selected ? toolByHost.get(selected.target_host) : undefined} onClose={() => setSelectedId(null)} />
    </div>
  );
}
