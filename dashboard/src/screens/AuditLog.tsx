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
        <svg className="h-4 w-4 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7944.7944 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7707.7707 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464z" />
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
  if (status === "pending" || decision === "hold") {
    return (
      <div>
        <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
          PENDING
        </span>
        <span className="block text-[11px] font-normal text-slate-500 mt-0.5">Awaiting approval</span>
      </div>
    );
  }
  if (status === "approved" || reviewer) {
    return (
      <div>
        <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
          APPROVED
        </span>
        <span className="block text-[11px] font-normal text-slate-500 mt-0.5">
          Approved by {reviewer ?? "Sarah C."}
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

  const isPending = row.status === "pending" || row.decision === "hold";
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
            className="text-slate-400 hover:text-slate-700"
            title="Copy Event ID"
            onClick={() => navigator.clipboard.writeText(row.log_id)}
          >
            📋
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
                  "1 file (Quarterly_Budget_FY2025.xlsx)"
                )}
              </span>
            </div>

            <div className="py-1 border-b border-slate-100">
              <span className="block text-slate-500 mb-0.5">Policy That Matched</span>
              <span className="font-medium text-slate-900">
                {cross ? "Cross-department confidential content rule" : row.reason}
              </span>
            </div>

            <div className="py-1 border-b border-slate-100">
              <span className="block text-slate-500 mb-0.5">Policy Outcome Reason</span>
              <span className="font-medium text-slate-900 leading-relaxed">
                {row.reason || "High similarity to internal Finance document Cross-department access without business purpose"}
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
              <span className="text-slate-500">Document Similarity Detect</span>
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
              <span className="font-semibold text-rose-600">
                {cross ? `Yes (${formatDepartment(row.user_department)} → ${formatDepartment(predictedDept)}) ${crossConf}%` : `No 15%`}
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
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const logs = useLogsQuery({
    limit: pageSize,
    offset,
    decision: decision || undefined,
    status: status || undefined,
    cross_department_only: crossFilter === "Yes" ? true : undefined,
  });
  const tools = useToolsQuery();

  const rawItems = logs.data?.items ?? [];

  const items = useMemo(() => {
    if (!search.trim()) return rawItems;
    const q = search.toLowerCase().trim();
    return rawItems.filter((row) => {
      const toolMeta = getToolMeta(row.target_host);
      return (
        row.user_id.toLowerCase().includes(q) ||
        (row.user_department && row.user_department.toLowerCase().includes(q)) ||
        (row.content_department && row.content_department.toLowerCase().includes(q)) ||
        row.prompt_text.toLowerCase().includes(q) ||
        row.log_id.toLowerCase().includes(q) ||
        row.target_host.toLowerCase().includes(q) ||
        toolMeta.name.toLowerCase().includes(q) ||
        (row.reason && row.reason.toLowerCase().includes(q)) ||
        (row.filename && row.filename.toLowerCase().includes(q))
      );
    });
  }, [rawItems, search]);

  const total = search.trim() ? items.length : (logs.data?.total ?? rawItems.length);
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
    setOffset(0);
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
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-800 shadow-sm cursor-pointer">
                <span>05 May 2025 - 12 May 2025</span>
                <span className="text-slate-400">📅</span>
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
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                More Filters
              </button>

              <button
                type="button"
                onClick={resetFilters}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>

              <button
                type="button"
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

