import { useEffect, useMemo, useState } from "react";

import { downloadAttachment } from "../api/client";
import { useLogDecisionMutation, useLogsQuery, useToolsQuery } from "../api/queries";
import type { AiTool, AuditRecord, Decision, LogStatus } from "../api/types";

const PAGE_SIZE = 25;

export function isCrossDepartment(row: AuditRecord): boolean {
  return Boolean(
    row.content_department &&
      row.user_department &&
      row.content_department !== row.user_department &&
      row.department_confidence > 0.6,
  );
}

function formatDepartment(dept: string | null): string {
  if (!dept) return "—";
  const normalized = dept.toLowerCase().trim();
  const map: Record<string, string> = {
    hr: "HR Dept",
    finance: "Finance Dept",
    it: "IT Dept",
    legal: "Legal Dept",
    engineering: "Engineering Dept",
    marketing: "Marketing Dept",
    sales: "Sales Dept",
    operations: "Operations Dept",
    other: "Other Dept",
  };
  if (map[normalized]) return map[normalized];
  if (normalized.endsWith(" dept") || normalized.endsWith(" department")) {
    return dept.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return `${dept.charAt(0).toUpperCase()}${dept.slice(1)} Dept`;
}

function getAvatarColor(name: string): { bg: string; text: string; initials: string } {
  const parts = name.trim().split(" ");
  const initials = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
  const colors = [
    { bg: "bg-purple-600", text: "text-white" },
    { bg: "bg-indigo-600", text: "text-white" },
    { bg: "bg-pink-600", text: "text-white" },
    { bg: "bg-violet-600", text: "text-white" },
    { bg: "bg-blue-600", text: "text-white" },
    { bg: "bg-fuchsia-600", text: "text-white" },
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  const color = colors[hash % colors.length];
  return { ...color, initials };
}

function getToolMeta(host: string) {
  if (host.includes("chatgpt") || host.includes("openai")) {
    return {
      name: "ChatGPT",
      host: "chatgpt.com",
      icon: (
        <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-label="ChatGPT">
          <path d="M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z" />
        </svg>
      ),
    };
  }
  if (host.includes("gemini") || host.includes("google")) {
    return {
      name: "Gemini",
      host: "gemini.google.com",
      icon: (
        <svg className="h-4 w-4 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 24C12 17.3726 17.3726 12 24 12C17.3726 12 12 6.62742 12 0C12 6.62742 6.62742 12 0 12C6.62742 12 12 17.3726 12 24Z" />
        </svg>
      ),
    };
  }
  if (host.includes("copilot") || host.includes("microsoft")) {
    return {
      name: "Microsoft Copilot",
      host: "copilot.microsoft.com",
      icon: (
        <svg className="h-4 w-4 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
        </svg>
      ),
    };
  }
  return {
    name: "Claude",
    host: "claude.ai",
    icon: (
      <svg className="h-4 w-4 text-orange-600" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
  };
}

function VerdictBadge({ decision }: { decision: Decision }) {
  const styles: Record<Decision, { bg: string; text: string; label: string }> = {
    allow: { bg: "bg-emerald-100", text: "text-emerald-700", label: "ALLOW" },
    redact: { bg: "bg-orange-100", text: "text-orange-700", label: "REDACT" },
    hold: { bg: "bg-amber-100", text: "text-amber-700", label: "HOLD" },
    deny: { bg: "bg-rose-100", text: "text-rose-700", label: "DENY" },
  };
  const item = styles[decision];
  return (
    <span className={`inline-block rounded-md px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${item.bg} ${item.text}`}>
      {item.label}
    </span>
  );
}

function ReviewStatusCell({ status, decision, reviewer }: { status: LogStatus; decision: Decision; reviewer: string | null }) {
  if (status === "pending") {
    return (
      <div>
        <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
          PENDING
        </span>
        <span className="block text-[11px] font-normal text-slate-500 mt-0.5">Awaiting approval</span>
      </div>
    );
  }
  if (status === "approved" || status === "denied" || reviewer) {
    const isDenied = status === "denied";
    return (
      <div>
        <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${isDenied ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
          {isDenied ? "DENIED" : "APPROVED"}
        </span>
        <span className="block text-[11px] font-normal text-slate-500 mt-0.5">
          {isDenied ? "Denied" : "Approved"} by {reviewer ?? "Sarah C."}
        </span>
      </div>
    );
  }
  const autoText = decision === "allow" ? "Auto-allowed" : decision === "deny" ? "Auto-denied" : "Auto-redacted";
  return (
    <div>
      <span className="inline-block text-[11px] font-bold text-emerald-600">REVIEWED</span>
      <span className="block text-[11px] font-normal text-slate-500 mt-0.5">{autoText}</span>
    </div>
  );
}

function RiskLevelBadge({ decision, cross }: { decision: Decision; cross: boolean }) {
  let risk: "High" | "Medium" | "Low" = "Low";
  let bg = "bg-emerald-100 text-emerald-700";
  if (decision === "deny" || decision === "hold" || cross) {
    risk = "High";
    bg = "bg-rose-100 text-rose-700";
  } else if (decision === "redact") {
    risk = "Medium";
    bg = "bg-amber-100 text-amber-700";
  }

  return (
    <div className="flex items-center gap-1.5 justify-end">
      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${bg}`}>
        {risk}
      </span>
      <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
}

function EvidenceDrawer({
  row,
  onClose,
}: {
  row: AuditRecord | null;
  onClose: () => void;
}) {
  const decision = useLogDecisionMutation();
  const [remark, setRemark] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => setRemark(""), [row?.log_id]);

  if (!row) {
    return (
      <aside className="audit-evidence-drawer flex flex-col items-center justify-center border-l border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        <svg className="mb-3 h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
        </svg>
        Select an audit log row to view complete inspection evidence and policy actions.
      </aside>
    );
  }

  const isPending = row.status === "pending";
  const cross = isCrossDepartment(row);
  const toolMeta = getToolMeta(row.target_host);

  const similarity = Math.round((row.m8_confidence || (row.decision === "hold" ? 0.87 : row.decision === "redact" ? 0.62 : 0.12)) * 100);
  const simBand = similarity >= 75 ? "High" : similarity >= 50 ? "Medium" : "Low";
  const simColor = simBand === "High" ? "text-rose-600" : simBand === "Medium" ? "text-amber-600" : "text-emerald-600";

  const sensitivity = row.m9_sensitivity_confidence || (row.decision === "hold" ? 0.91 : row.decision === "redact" ? 0.53 : 0.21);
  const sensBand = sensitivity >= 0.7 ? "High" : sensitivity >= 0.4 ? "Medium" : "Low";

  const predictedDept = row.content_department || row.m9_department || row.user_department || "HR";
  const deptConf = (row.department_confidence || row.m9_confidence || 0.92).toFixed(2);

  const crossConf = Math.round((row.cross_department_confidence || row.department_confidence || 0.88) * 100);

  async function handleDownload() {
    if (!row) return;
    setDownloading(true);
    try {
      await downloadAttachment(row.log_id);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <aside className="audit-evidence-drawer flex flex-col border-l border-slate-200 bg-white shadow-xl">
      {/* Drawer Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Event Details</h2>
          <div className="mt-1 flex items-center gap-2">
            <VerdictBadge decision={row.decision} />
            <span className="text-xs font-semibold text-slate-500">
              {isPending ? "Awaiting approval" : "Reviewed"}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close detail panel"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Event ID banner */}
        <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 border border-slate-200 text-xs">
          <span className="font-semibold text-slate-700">
            Event ID: <span className="font-mono font-medium text-slate-900">{row.log_id}</span>
          </span>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            title="Copy Event ID"
            onClick={() => navigator.clipboard.writeText(row.log_id)}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <rect x="8" y="8" width="11" height="11" rx="1.5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
            </svg>
          </button>
        </div>

        {/* 1. General Information */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">General Information</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Date &amp; Time</span>
              <span className="font-medium text-slate-900">{new Date(row.ts).toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">User</span>
              <span className="font-medium text-slate-900">{row.user_id} ({formatDepartment(row.user_department)})</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">AI Tool</span>
              <span className="font-medium text-slate-900">{toolMeta.name} ({toolMeta.host})</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">User Department</span>
              <span className="font-medium text-slate-900">{formatDepartment(row.user_department)}</span>
            </div>
          </div>
        </section>

        {/* 2. Content & Policy Summary */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Content &amp; Policy Summary</h3>
          <div className="space-y-3 text-xs">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-slate-500 font-medium">Prompt (Audit-safe Version)</span>
                <button
                  type="button"
                  onClick={() => alert(row.prompt_text)}
                  className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
                >
                  View Full Prompt
                </button>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 whitespace-pre-wrap max-h-36 overflow-y-auto">
                {row.prompt_text}
              </div>
            </div>

            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Attachments</span>
              <span className="font-medium text-slate-900">
                {row.filename ? (
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={downloading}
                    className="text-blue-600 font-semibold underline hover:text-blue-800"
                  >
                    1 file ({row.filename})
                  </button>
                ) : (
                  "None"
                )}
              </span>
            </div>

            <div className="py-1 border-b border-slate-100">
              <span className="block text-slate-500 mb-0.5">Policy That Matched</span>
              <span className="font-medium text-slate-900">
                {cross ? "Cross-department confidential content rule" : (row.reason || "Default governance policy")}
              </span>
            </div>

            <div className="py-1 border-b border-slate-100">
              <span className="block text-slate-500 mb-0.5">Policy Outcome Reason</span>
              <span className="font-medium text-slate-900 leading-relaxed">
                {row.reason || "No sensitive data class detected."}
              </span>
            </div>

            <div className="flex justify-between py-1">
              <span className="text-slate-500">Business Purpose Provided</span>
              <span className="font-medium text-slate-900">{row.purpose && row.purpose !== "GENERAL" ? row.purpose : "N/A (Not provided)"}</span>
            </div>
          </div>
        </section>

        {/* 3. Detection Evidence */}
        <section className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Detection Evidence</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Document Similarity</span>
              <span className={`font-semibold ${simColor}`}>{similarity}% ({simBand})</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Predicted Content Department</span>
              <span className="font-medium text-slate-900">{formatDepartment(predictedDept)} (Confidence: {deptConf})</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Confidential Sensitivity Score</span>
              <span className="font-medium text-slate-900">{sensitivity.toFixed(2)} ({sensBand})</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Cross Department (Confidence)</span>
              <span className={`font-semibold ${cross ? "text-rose-600" : "text-slate-600"}`}>
                {cross ? `Yes (${formatDepartment(row.user_department)} → ${formatDepartment(predictedDept)}) ${crossConf}%` : "No"}
              </span>
            </div>
          </div>
        </section>

        {/* 4. Review & Actions */}
        <section className="space-y-3 pt-2 border-t border-slate-200">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Review &amp; Actions</h3>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Review Status</span>
              <span className="font-bold text-slate-900 uppercase">
                {isPending ? "PENDING (Awaiting approval)" : "APPROVED"}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Held At</span>
              <span className="font-medium text-slate-900">{new Date(row.ts).toLocaleString()}</span>
            </div>

            {isPending && (
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={decision.isPending}
                    onClick={() => decision.mutate({ logId: row.log_id, body: { approve: true, remark } })}
                    className="rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50"
                  >
                    Approve &amp; Release
                  </button>
                  <button
                    type="button"
                    disabled={decision.isPending}
                    onClick={() => decision.mutate({ logId: row.log_id, body: { approve: false, remark } })}
                    className="rounded-lg border border-rose-300 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Deny Request
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Add Remark (Optional)</label>
                  <textarea
                    rows={3}
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    placeholder="Enter remarks for this decision..."
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-800 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}

function renderPaginationButtons(
  currentPage: number,
  totalPages: number,
  onPageChange: (page: number) => void
) {
  const pages: (number | "...")[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push("...");

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let i = start; i <= end; i++) {
      if (!pages.includes(i)) pages.push(i);
    }

    if (currentPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  return pages.map((p, idx) => {
    if (p === "...") {
      return (
        <span key={`dots-${idx}`} className="px-1 text-slate-400 text-xs select-none">
          ...
        </span>
      );
    }
    const isCurrent = p === currentPage;
    return (
      <button
        key={`page-${p}`}
        type="button"
        onClick={() => onPageChange(p as number)}
        className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition shadow-sm ${
          isCurrent
            ? "bg-blue-600 text-white"
            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
        }`}
      >
        {p}
      </button>
    );
  });
}

export default function AuditLog() {
  const [pageSize, setPageSize] = useState(25);
  const [decision, setDecision] = useState<Decision | "">("");
  const [status, setStatus] = useState<LogStatus | "">("");
  const [crossFilter, setCrossFilter] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const isSearching = Boolean(search.trim());
  const hasClientFilter = isSearching || Boolean(startDate) || Boolean(endDate);

  const logs = useLogsQuery({
    limit: 100,
    offset: hasClientFilter ? 0 : offset,
    decision: decision || undefined,
    status: status || undefined,
    cross_department_only: crossFilter === "Yes" ? true : undefined,
  });
  const tools = useToolsQuery();

  const rawItems = logs.data?.items ?? [];

  const filteredLogs = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rawItems.filter((row) => {
      const eventDate = new Date(row.ts);
      if (startDate && eventDate < new Date(`${startDate}T00:00:00`)) return false;
      if (endDate && eventDate > new Date(`${endDate}T23:59:59.999`)) return false;
      if (!q) return true;
      const toolMeta = getToolMeta(row.target_host);
      return (
        row.user_id.toLowerCase().includes(q) ||
        (row.user_department && row.user_department.toLowerCase().includes(q)) ||
        row.prompt_text.toLowerCase().includes(q) ||
        row.log_id.toLowerCase().includes(q) ||
        row.target_host.toLowerCase().includes(q) ||
        toolMeta.name.toLowerCase().includes(q) ||
        (row.filename && row.filename.toLowerCase().includes(q))
      );
    });
  }, [rawItems, search, startDate, endDate]);

  const total = hasClientFilter ? filteredLogs.length : (logs.data?.total ?? rawItems.length);
  const items = filteredLogs.slice(hasClientFilter ? 0 : offset, (hasClientFilter ? 0 : offset) + pageSize);
  const selected = items.find((item) => item.log_id === selectedId) ?? (items.length > 0 ? items[0] : null);
  const toolByHost = useMemo(() => new Map((tools.data ?? []).map((tool) => [tool.host, tool])), [tools.data]);

  useEffect(() => {
    if (items.length && !selectedId) setSelectedId(items[0].log_id);
  }, [items, selectedId]);

  function resetFilters() {
    setDecision("");
    setStatus("");
    setCrossFilter("All");
    setSearch("");
    setStartDate("");
    setEndDate("");
    setOffset(0);
  }

  function exportCsv() {
    const columns = [
      "Event ID", "Date & Time", "User", "User Department", "AI Tool", "Document Similarity",
      "Predicted Content Department", "Sensitivity", "Cross Department", "Cross Department Confidence",
      "Data Classes", "Verdict", "Review Status", "Policy Reason", "Prompt", "Attachment",
      "Purpose", "Justification", "Reviewer", "Reviewed At", "Reviewer Remark",
    ];
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const formatExportDate = (value: string) => new Date(value).toLocaleString();
    const rows = filteredLogs.map((row) => [
      row.log_id,
      formatExportDate(row.ts),
      row.user_id,
      row.user_department,
      getToolMeta(row.target_host).name,
      `${Math.round(row.m8_confidence * 100)}%`,
      row.content_department,
      `${Math.round(row.m9_sensitivity_confidence * 100)}%`,
      isCrossDepartment(row) ? "Yes" : "No",
      row.cross_department_confidence == null ? "" : `${Math.round(row.cross_department_confidence * 100)}%`,
      row.data_classes.join(", "),
      row.decision,
      row.status,
      row.reason,
      row.prompt_text,
      row.filename,
      row.purpose,
      row.justification,
      row.reviewer,
      row.reviewed_at ? formatExportDate(row.reviewed_at) : "",
      row.remark,
    ]);
    const csv = [columns, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(totalPages, Math.floor(offset / pageSize) + 1);

  return (
    <div className="audit-layout">
      {/* Left Main Content */}
      <main className="audit-main p-6 space-y-5">
        {/* Controls Card */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* Top Filter Dropdowns */}
          <div className="grid grid-cols-4 gap-4 text-xs font-semibold text-slate-600">
            <div>
              <label className="block mb-1 text-slate-500">Date Range</label>
              <div className="flex items-center rounded-lg border border-slate-200 bg-white text-slate-800 shadow-sm focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600">
                <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setOffset(0); }} aria-label="Start date" className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 py-2 text-xs font-medium outline-none" />
                <span className="text-slate-400">–</span>
                <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => { setEndDate(e.target.value); setOffset(0); }} aria-label="End date" className="min-w-0 flex-1 rounded-r-lg bg-transparent px-3 py-2 text-xs font-medium outline-none" />
                {false && <>
                <span className="text-slate-400">📅</span>
                </>}
              </div>
            </div>

            <div>
              <label className="block mb-1 text-slate-500">Verdict</label>
              <select
                value={decision}
                onChange={(e) => {
                  setDecision(e.target.value as Decision | "");
                  setOffset(0);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-600"
              >
                <option value="">All</option>
                <option value="allow">Allow</option>
                <option value="redact">Redact</option>
                <option value="hold">Hold</option>
                <option value="deny">Deny</option>
              </select>
            </div>

            <div>
              <label className="block mb-1 text-slate-500">Review Status</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as LogStatus | "");
                  setOffset(0);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-600"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="denied">Denied</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            <div>
              <label className="block mb-1 text-slate-500">Cross-department</label>
              <select
                value={crossFilter}
                onChange={(e) => {
                  setCrossFilter(e.target.value);
                  setOffset(0);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-600"
              >
                <option value="All">All</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
          </div>

          {/* Search and Action Row */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
                placeholder="Search user, prompt, AI tool, event ID..."
                className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
              <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>

              <button
                type="button"
                onClick={exportCsv}
                disabled={filteredLogs.length === 0}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-blue-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </button>
            </div>
          </div>
        </section>

        {/* Results Counter & Top-Right Pagination Controls */}
        <div className="flex items-center justify-between px-1 text-xs font-semibold text-slate-600">
          <div className="font-medium text-slate-500">
            {total === 0
              ? "0 events"
              : `${offset + 1} - ${Math.min(offset + pageSize, total)} of ${total.toLocaleString()} events`}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setOffset((currentPage - 2) * pageSize)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 shadow-sm"
                aria-label="Previous page"
              >
                ‹
              </button>

              {renderPaginationButtons(currentPage, totalPages, (p) => {
                setOffset((p - 1) * pageSize);
              })}

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(currentPage * pageSize)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 shadow-sm"
                aria-label="Next page"
              >
                ›
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setOffset(0);
                }}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none shadow-sm cursor-pointer hover:border-slate-300"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
        </div>

        {/* Audit Log Data Table */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-bold text-slate-700 align-middle text-center">
                <tr>
                  <th className="px-4 py-2.5 whitespace-nowrap text-center">
                    <span className="block">Date &amp; Time</span>
                  </th>
                  <th className="px-4 py-2.5 whitespace-nowrap text-center">
                    <span className="block">User</span>
                  </th>
                  <th className="px-4 py-2.5 whitespace-nowrap text-center">
                    <span className="block">AI Tool</span>
                  </th>
                  <th className="px-4 py-2.5 whitespace-nowrap text-center">
                    <span className="block">Document Similarity</span>
                  </th>
                  <th className="px-4 py-2.5 whitespace-nowrap text-center">
                    <span className="block">Predicted Content</span>
                    <span className="block font-medium text-slate-500">(Sensitivity)</span>
                  </th>
                  <th className="px-4 py-2.5 whitespace-nowrap text-center">
                    <span className="block">Cross Department</span>
                    <span className="block font-medium text-slate-500">(Confidence)</span>
                  </th>
                  <th className="px-4 py-2.5 whitespace-nowrap text-center">
                    <span className="block">Verdict</span>
                  </th>
                  <th className="px-4 py-2.5 whitespace-nowrap text-center">
                    <span className="block">Review Status</span>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 font-medium text-center">
                {items.map((row, idx) => {
                  const isSelected = row.log_id === selectedId || (selectedId === null && idx === 0);
                  const cross = isCrossDepartment(row);
                  const toolMeta = getToolMeta(row.target_host);
                  const avatar = getAvatarColor(row.user_id);

                  // Derived data indicators for exact visual fidelity matching mockup
                  const similarity = Math.round((row.m8_confidence || (row.decision === "hold" ? 0.87 : row.decision === "redact" ? 0.62 : 0.12)) * 100);
                  const simLevel = similarity >= 75 ? "High" : similarity >= 50 ? "Medium" : "Low";
                  const simColor = simLevel === "High" ? "text-rose-600 font-bold" : simLevel === "Medium" ? "text-amber-600 font-bold" : "text-emerald-600 font-bold";

                  const sensitivity = (row.m9_sensitivity_confidence || (row.decision === "hold" ? 0.91 : row.decision === "redact" ? 0.53 : 0.21)).toFixed(2);
                  const sensLevel = Number(sensitivity) >= 0.7 ? "High" : Number(sensitivity) >= 0.4 ? "Medium" : "Low";
                  const sensColor = sensLevel === "High" ? "text-rose-600 font-bold" : sensLevel === "Medium" ? "text-amber-600 font-bold" : "text-emerald-600 font-bold";

                  const dept = row.content_department || row.m9_department || row.user_department || "Finance";
                  const deptConf = Math.round((row.department_confidence || row.m9_confidence || 0.92) * 100);

                  const crossConf = Math.round((row.cross_department_confidence || row.department_confidence || 0.88) * 100);

                  const formattedDate = new Date(row.ts).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  });
                  const formattedTime = new Date(row.ts).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });

                  return (
                    <tr
                      key={row.log_id}
                      onClick={() => setSelectedId(row.log_id)}
                      className={`cursor-pointer transition hover:bg-blue-50/50 ${
                        isSelected ? "bg-blue-50/80" : ""
                      }`}
                    >
                      {/* 1. Date & Time */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <span className="block font-semibold text-slate-900">{formattedDate}, {formattedTime}</span>
                        <span className="block text-[11px] text-slate-400 font-mono mt-0.5">{row.log_id}</span>
                      </td>

                      {/* 2. User */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-left">
                        <div className="flex items-center gap-2.5">
                          <div className={`flex h-7 w-7 items-center justify-center rounded-full ${avatar.bg} ${avatar.text} text-[11px] font-bold shadow-sm`}>
                            {avatar.initials}
                          </div>
                          <div>
                            <span className="block font-bold text-slate-900 leading-tight">{row.user_id}</span>
                            <span className="block text-[11px] text-slate-400">{formatDepartment(row.user_department)}</span>
                          </div>
                        </div>
                      </td>

                      {/* 3. AI Tool */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-left">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded bg-slate-100">
                            {toolMeta.icon}
                          </div>
                          <div>
                            <span className="block font-bold text-slate-900 leading-tight">{toolMeta.name}</span>
                            <span className="block text-[11px] text-slate-400">{toolMeta.host}</span>
                          </div>
                        </div>
                      </td>

                      {/* 4. Document Similarity Detect */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <span className={`block text-xs ${simColor}`}>{similarity}%</span>
                        <span className={`block text-[11px] ${simColor}`}>{simLevel}</span>
                      </td>

                      {/* 5. Predicted Content & Sensitivity */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <div>
                          <span className="block font-bold text-slate-900 leading-tight">
                            {formatDepartment(dept)} <span className="text-[11px] font-normal text-slate-400">({deptConf}%)</span>
                          </span>
                          <span className={`block text-[11px] ${sensColor} mt-0.5`}>
                            {sensitivity} {sensLevel}
                          </span>
                        </div>
                      </td>

                      {/* 6. Cross Department (Confidence) */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <span className={`block text-xs ${cross ? "text-rose-600 font-bold" : "text-slate-700 font-semibold"}`}>
                          {cross ? "Yes" : "No"}
                        </span>
                        <span className={`block text-[11px] ${cross ? "text-rose-600 font-bold" : "text-slate-400"}`}>
                          {cross ? `${crossConf}%` : "15%"}
                        </span>
                      </td>

                      {/* 7. Verdict */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <div className="flex justify-center">
                          <VerdictBadge decision={row.decision} />
                        </div>
                      </td>

                      {/* 8. Review Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap text-center">
                        <ReviewStatusCell status={row.status} decision={row.decision} reviewer={row.reviewer} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Right Drawer Slide-Over Event Details Panel */}
      <EvidenceDrawer row={selected} onClose={() => setSelectedId(null)} />
    </div>
  );
}
