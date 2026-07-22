import { useEffect, useMemo, useState } from "react";

import { downloadAttachment } from "../api/client";
import { useLogDecisionMutation, useLogsQuery, useToolsQuery } from "../api/queries";
import type { AiTool, AuditRecord } from "../api/types";
import { DataClassPills } from "../components/DataClassPills";
import { EmptyState, ErrorState, SkeletonRows } from "../components/EmptyState";

function isCrossDepartment(row: AuditRecord): boolean {
  if (row.cross_department_confidence != null) return true;
  if (row.content_department && row.user_department) {
    return row.content_department.trim().toLowerCase() !== row.user_department.trim().toLowerCase();
  }
  return false;
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return (
      d.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }) +
      ", " +
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return ts;
  }
}

function minutesWaiting(ts: string): number {
  const diffMs = Math.max(0, Date.now() - new Date(ts).getTime());
  return Math.floor(diffMs / 60_000);
}

function formatWaitLabel(ts: string): string {
  const mins = minutesWaiting(ts);
  if (mins < 60) return `${mins}m waiting`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h waiting`;
  const days = Math.floor(hrs / 24);
  return `${days}d waiting`;
}

function formatUserName(email: string): string {
  if (!email) return "Unknown User";
  const prefix = email.split("@")[0];
  const parts = prefix.split(".");
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function getInitials(name: string): string {
  if (!name) return "U";
  const parts = name.trim().split(/[\s.@]+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-purple-600",
  "bg-indigo-600",
  "bg-rose-600",
  "bg-violet-600",
  "bg-blue-600",
  "bg-emerald-600",
];

function getAvatarBg(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export default function ApprovalQueue() {
  const [crossDepartmentOnly, setCrossDepartmentOnly] = useState(false);
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "content" | "evidence" | "policy" | "history">("overview");
  const [remark, setRemark] = useState("");
  const [downloading, setDownloading] = useState(false);

  const logs = useLogsQuery({
    limit: 200,
    offset: 0,
    status: "pending",
    cross_department_only: crossDepartmentOnly || undefined,
  });

  const decision = useLogDecisionMutation();

  const allItems = useMemo(() => {
    const raw = logs.data?.items ?? [];
    return [...raw].sort((a, b) =>
      sort === "oldest" ? a.ts.localeCompare(b.ts) : b.ts.localeCompare(a.ts)
    );
  }, [logs.data?.items, sort]);

  const items = useMemo(() => {
    if (!searchTerm.trim()) return allItems;
    const term = searchTerm.toLowerCase();
    return allItems.filter(
      (item) =>
        item.user_id.toLowerCase().includes(term) ||
        item.log_id.toLowerCase().includes(term) ||
        item.target_host.toLowerCase().includes(term) ||
        (item.user_department && item.user_department.toLowerCase().includes(term)) ||
        (item.filename && item.filename.toLowerCase().includes(term))
    );
  }, [allItems, searchTerm]);

  const selected = items.find((item) => item.log_id === selectedId) ?? items[0] ?? null;

  useEffect(() => {
    if (items.length && !selectedId) setSelectedId(items[0].log_id);
    if (selectedId && !items.some((item) => item.log_id === selectedId)) {
      setSelectedId(items[0]?.log_id ?? null);
    }
  }, [items, selectedId]);

  useEffect(() => {
    setRemark("");
    setActiveTab("overview");
  }, [selected?.log_id]);

  // Top summary KPIs
  const totalPending = logs.data?.total ?? allItems.length;
  const crossDeptCount = useMemo(
    () => allItems.filter((i) => isCrossDepartment(i)).length,
    [allItems]
  );

  const oldestWaitText = useMemo(() => {
    if (!allItems.length) return "0 min";
    const oldestMs = new Date(allItems[0].ts).getTime();
    const mins = Math.max(0, Math.floor((Date.now() - oldestMs) / 60_000));
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hr${hrs > 1 ? "s" : ""}`;
  }, [allItems]);

  async function handleDownload() {
    if (!selected) return;
    setDownloading(true);
    try {
      await downloadAttachment(selected.log_id);
    } finally {
      setDownloading(false);
    }
  }

  function handleDecisionSubmit(approve: boolean) {
    if (!selected) return;
    decision.mutate({
      logId: selected.log_id,
      body: { approve, remark },
    });
  }

  return (
    <div className="p-6 bg-slate-50 min-h-screen space-y-6">
      {/* 1. Top Summary Banner Row (4 KPI Cards) */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Awaiting Review */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-900">{totalPending}</div>
            <div className="text-xs font-bold text-slate-800">Awaiting Review</div>
            <div className="text-xs text-slate-500">Requests in queue</div>
          </div>
        </div>

        {/* Card 2: Cross-department */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-900">{crossDeptCount}</div>
            <div className="text-xs font-bold text-slate-800">Cross-department</div>
            <div className="text-xs text-slate-500">Higher risk requests</div>
          </div>
        </div>

        {/* Card 3: Oldest Request */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
            <svg className="h-6 w-6 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-900">{oldestWaitText}</div>
            <div className="text-xs font-bold text-slate-800">Oldest Request</div>
            <div className="text-xs text-slate-500">Waiting for review</div>
          </div>
        </div>

        {/* Card 4: Info Note */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <p className="text-xs font-medium text-slate-600 leading-snug">
            Requests remain paused and have not been sent to the external AI tool.
          </p>
        </div>
      </section>

      {/* 2. Main Content Split Layout */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Pending List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          {/* Controls Bar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search employee, AI tool, event ID or keyword..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-9 text-xs text-slate-800 placeholder-slate-400 outline-none shadow-sm focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              />
              <svg className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              type="button"
              onClick={() => setCrossDepartmentOnly(!crossDepartmentOnly)}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm flex items-center gap-1.5 transition ${
                crossDepartmentOnly
                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
            </button>
          </div>

          {/* Sort bar & Pending count */}
          <div className="flex items-center justify-between text-xs px-1">
            <div className="flex items-center gap-1.5 text-slate-600 font-medium">
              <span>Sort by:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as "oldest" | "newest")}
                className="bg-transparent font-semibold text-slate-900 cursor-pointer outline-none"
              >
                <option value="oldest">Oldest first</option>
                <option value="newest">Newest first</option>
              </select>
            </div>
            <span className="font-semibold text-slate-500">{items.length} pending requests</span>
          </div>

          {/* Items List */}
          <div className="space-y-2.5">
            {logs.isLoading && (
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <SkeletonRows rows={4} columns={1} />
              </div>
            )}

            {!logs.isLoading && logs.isError && (
              <ErrorState message={(logs.error as Error).message} />
            )}

            {!logs.isLoading && !logs.isError && items.length === 0 && (
              <EmptyState title="Nothing waiting for review" hint="Held prompts will show up here in real time." />
            )}

            {!logs.isLoading &&
              items.map((row) => {
                const isSelected = row.log_id === selected?.log_id;
                const cross = isCrossDepartment(row);
                const userName = formatUserName(row.user_id);
                const initials = getInitials(userName);
                const avatarBg = getAvatarBg(userName);
                const waitLabel = formatWaitLabel(row.ts);
                const isHighRisk = row.m9_sensitivity_confidence > 0.7 || cross;

                return (
                  <div
                    key={row.log_id}
                    onClick={() => setSelectedId(row.log_id)}
                    className={`group relative cursor-pointer rounded-xl border p-4 shadow-sm transition space-y-2 ${
                      isSelected
                        ? "border-emerald-600 ring-2 ring-emerald-600/20 bg-emerald-50/10"
                        : "border-slate-200 bg-white hover:border-emerald-400"
                    }`}
                  >
                    {/* Top Row: Wait time, Avatar, Name, Risk Pill */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-bold text-rose-600 whitespace-nowrap shrink-0">
                          {waitLabel}
                        </span>
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarBg}`}>
                          {initials}
                        </div>
                        <span className="font-bold text-slate-900 text-sm truncate">
                          {userName}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            isHighRisk ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {isHighRisk ? "HIGH" : "LOW"}
                        </span>
                        {cross && (
                          <span className="rounded bg-rose-50 border border-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
                            Cross-department
                          </span>
                        )}
                        <span className="text-slate-400 text-xs font-bold group-hover:translate-x-0.5 transition-transform">
                          &gt;
                        </span>
                      </div>
                    </div>

                    {/* Middle Row: Dept flow & Tool info */}
                    <div className="text-xs space-y-0.5">
                      <div className="text-slate-600 font-medium">
                        {row.user_department ?? "Finance Dept"} &rarr; {row.content_department ?? "HR Content"}
                      </div>
                      <div className="text-slate-500 font-medium truncate">
                        {row.target_host} • {row.filename ? "Attachment + Prompt" : "Prompt only"}
                      </div>
                    </div>

                    {/* Bottom Row: Attachment preview if present */}
                    {row.filename && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium font-mono pt-1">
                        <svg className="h-3.5 w-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        <span className="truncate">{row.filename}</span>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Right Column: Request Detail Pane (7 cols) */}
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col justify-between">
          {selected ? (
            <div>
              {/* Detail Header Banner */}
              <div className="bg-rose-50/60 border-b border-rose-100 p-5 flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-bold text-base">
                    ⏸
                  </div>
                  <div>
                    <div className="text-xs font-extrabold tracking-wider text-rose-600 uppercase">
                      AWAITING REVIEW
                    </div>
                    <div className="text-xs text-slate-600 font-medium mt-0.5">
                      This request is paused and has not been sent to {selected.target_host}.
                    </div>
                  </div>
                </div>

                <div className="text-right text-xs space-y-1">
                  <div className="text-slate-500">
                    Held since <span className="font-semibold text-slate-700">{formatTs(selected.ts)}</span>{" "}
                    <span className="text-slate-400">({minutesWaiting(selected.ts)} min waiting)</span>
                  </div>
                  <div className="font-mono text-slate-700 font-bold">
                    Event ID: <span className="text-slate-900">{selected.log_id}</span>
                  </div>
                  <div className="text-slate-500">
                    Request Type: <span className="font-semibold text-slate-700">{selected.filename ? "Attachment + Prompt" : "Prompt only"}</span>
                  </div>
                </div>
              </div>

              {/* Tab Navigation */}
              <div className="flex border-b border-slate-200 bg-white px-5 text-xs font-semibold text-slate-500">
                {(["overview", "content", "evidence", "policy", "history"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`capitalize px-4 py-3 border-b-2 transition ${
                      activeTab === tab
                        ? "border-emerald-600 text-emerald-700 font-bold"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Main Detail Body */}
              <div className="p-5 space-y-5">
                {activeTab === "overview" && (
                  <>
                    {/* 2x2 Grid Section */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {/* Card 1: Employee & Request */}
                      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-2 text-xs">
                        <div className="font-bold text-slate-900 text-xs mb-3 flex items-center gap-1.5">
                          <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          Employee &amp; Request
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-slate-500">Employee</span>
                          <span className="font-bold text-slate-800">{formatUserName(selected.user_id)}</span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-slate-500">User Department</span>
                          <span className="font-medium text-slate-700">{selected.user_department ?? "Finance Department"}</span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-slate-500">Target AI Tool</span>
                          <span className="font-medium text-slate-700 flex items-center gap-1">
                            <span>🤖</span> {selected.target_host}
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-slate-500">Request Type</span>
                          <span className="font-medium text-slate-700">{selected.filename ? "Attachment + Prompt" : "Prompt only"}</span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-slate-500">Created Time</span>
                          <span className="font-medium text-slate-700">{formatTs(selected.ts)}</span>
                        </div>
                      </div>

                      {/* Card 2: Department Context */}
                      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-2 text-xs">
                        <div className="font-bold text-slate-900 text-xs mb-3 flex items-center gap-1.5">
                          <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          Department Context
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-slate-500">User Department</span>
                          <span className="font-bold text-slate-800">{selected.user_department ?? "Finance"}</span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-slate-500">Predicted Content Department</span>
                          <span className="font-medium text-slate-700">
                            {selected.content_department ?? "HR"} (Confidence: {Math.round((selected.department_confidence ?? 0.92) * 100)}%)
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-slate-500">Cross-department</span>
                          <span className="font-semibold text-rose-600">
                            Yes ({selected.user_department ?? "Finance"} &rarr; {selected.content_department ?? "HR"})
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span className="text-slate-500">Cross-department Confidence</span>
                          <span className="font-medium text-slate-700">
                            {Math.round(((selected.cross_department_confidence ?? selected.department_confidence) ?? 0.88) * 100)}%
                          </span>
                        </div>
                      </div>

                      {/* Card 3: Request Summary */}
                      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-2 text-xs">
                        <div className="font-bold text-slate-900 text-xs mb-3 flex items-center gap-1.5">
                          <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Request Summary
                        </div>
                        <div className="flex items-center justify-between py-0.5">
                          <span className="text-slate-500">Business Purpose</span>
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                            {selected.purpose || "Financial analysis"}
                          </span>
                        </div>
                        <div className="pt-2">
                          <span className="text-slate-500 block mb-1">Employee Justification</span>
                          <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-slate-700 italic text-[11px]">
                            &ldquo;{selected.justification || "Preparing a summary for the regional HR planning meeting."}&rdquo;
                          </div>
                        </div>
                      </div>

                      {/* Card 4: Attachment */}
                      <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-2 text-xs flex flex-col justify-between">
                        <div>
                          <div className="font-bold text-slate-900 text-xs mb-3 flex items-center gap-1.5">
                            <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                            Attachment
                          </div>

                          {selected.filename ? (
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-emerald-700 font-bold text-white text-xs">
                                  X
                                </div>
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-800 truncate text-xs">
                                    {selected.filename}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-medium">
                                    15.2 KB • XLSX
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={handleDownload}
                                disabled={downloading}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1 shrink-0"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                {downloading ? "Downloading…" : "Download"}
                              </button>
                            </div>
                          ) : (
                            <div className="text-slate-500 py-2 italic text-xs">
                              No attachment included in this request.
                            </div>
                          )}
                        </div>

                        {selected.filename && (
                          <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                            ⓘ If approved, the prepared protected copy will be released instead of the original file.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Key Risk Indicators Row (5 Individual Sub-cards) */}
                    {(() => {
                      const simScore = selected.department_confidence ?? 0.87;
                      const simPct = Math.round(simScore * 100);
                      const simLevel = simScore > 0.7 ? "High" : simScore > 0.4 ? "Medium" : "Low";
                      const simColor = simScore > 0.7 ? "text-rose-600" : simScore > 0.4 ? "text-amber-600" : "text-emerald-600";

                      const sensScore = selected.m9_sensitivity_confidence ?? 0.91;
                      const sensVal = sensScore.toFixed(2);
                      const sensLevel = sensScore > 0.7 ? "High" : sensScore > 0.4 ? "Medium" : "Low";
                      const sensColor = sensScore > 0.7 ? "text-rose-600" : sensScore > 0.4 ? "text-amber-600" : "text-emerald-600";

                      const isCross = selected.cross_department_confidence != null || (Boolean(selected.user_department && selected.content_department && selected.user_department !== selected.content_department));
                      const crossConf = Math.round(((selected.cross_department_confidence ?? selected.department_confidence) ?? 0.88) * 100);
                      const crossColor = isCross ? "text-rose-600" : "text-emerald-600";

                      const riskLevel = (sensScore > 0.7 || simScore > 0.7 || isCross) ? "High" : (sensScore > 0.4 || simScore > 0.4) ? "Medium" : "Low";
                      const riskColor = riskLevel === "High" ? "text-rose-600" : riskLevel === "Medium" ? "text-amber-600" : "text-emerald-600";

                      return (
                        <div className="space-y-2.5">
                          <h4 className="text-xs font-bold text-slate-900">Key Risk Indicators</h4>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5 text-xs">
                            {/* Card 1 */}
                            <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-sm flex flex-col justify-between space-y-3">
                              <div className="text-slate-500 text-[11px] font-medium leading-snug">
                                Document Similarity Detect
                              </div>
                              <div>
                                <div className={`text-base font-bold ${simColor}`}>{simPct}%</div>
                                <div className={`text-xs font-bold ${simColor}`}>{simLevel}</div>
                              </div>
                            </div>

                            {/* Card 2 */}
                            <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-sm flex flex-col justify-between space-y-3">
                              <div className="text-slate-500 text-[11px] font-medium leading-snug">
                                Predicted Content Department
                              </div>
                              <div className="text-sm font-bold text-slate-900">
                                {(selected.content_department ?? "HR").toUpperCase()} ({simPct}%)
                              </div>
                            </div>

                            {/* Card 3 */}
                            <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-sm flex flex-col justify-between space-y-3">
                              <div className="text-slate-500 text-[11px] font-medium leading-snug">
                                Confidential Sensitivity Score
                              </div>
                              <div>
                                <div className={`text-base font-bold ${sensColor}`}>{sensVal}</div>
                                <div className={`text-xs font-bold ${sensColor}`}>{sensLevel}</div>
                              </div>
                            </div>

                            {/* Card 4 */}
                            <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-sm flex flex-col justify-between space-y-3">
                              <div className="text-slate-500 text-[11px] font-medium leading-snug">
                                Cross Department (Confidence)
                              </div>
                              <div className={`text-sm font-bold ${crossColor}`}>
                                {isCross ? "Yes" : "No"} ({crossConf}%)
                              </div>
                            </div>

                            {/* Card 5 */}
                            <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-sm flex flex-col justify-between space-y-3">
                              <div className="text-slate-500 text-[11px] font-medium leading-snug">
                                Risk Level
                              </div>
                              <div className={`text-sm font-bold ${riskColor}`}>{riskLevel}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}

                {activeTab === "content" && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-900">Full Prompt Text</h4>
                    <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
                      {selected.prompt_text}
                    </div>
                  </div>
                )}

                {activeTab === "evidence" && (
                  <div className="space-y-3 text-xs">
                    <h4 className="text-xs font-bold text-slate-900">Matched Data Classes &amp; Evidence</h4>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 space-y-2">
                      <DataClassPills dataClasses={selected.data_classes} />
                    </div>
                  </div>
                )}

                {activeTab === "policy" && (
                  <div className="space-y-3 text-xs">
                    <h4 className="text-xs font-bold text-slate-900">Policy Trigger Reason</h4>
                    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-slate-800 font-medium">
                      {selected.reason || "High confidential sensitivity detected cross-department."}
                    </div>
                  </div>
                )}

                {activeTab === "history" && (
                  <div className="space-y-3 text-xs text-slate-500">
                    <h4 className="text-xs font-bold text-slate-900">Audit History</h4>
                    <div>Logged at {formatTs(selected.ts)} — Status: Pending Review</div>
                  </div>
                )}
              </div>

              {/* Reviewer Action Footer */}
              <div className="border-t border-slate-200 bg-white p-5 space-y-3">
                <label className="block text-xs font-bold text-slate-800">
                  Reviewer Remark <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <div className="flex flex-col gap-3 sm:flex-row items-stretch sm:items-center">
                  <input
                    type="text"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    maxLength={500}
                    placeholder="Add any context for this decision. This will be recorded in the audit log."
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={decision.isPending}
                      onClick={() => handleDecisionSubmit(false)}
                      className="rounded-xl border border-rose-200 bg-white hover:bg-rose-50 px-5 py-2.5 text-xs font-bold text-rose-600 shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <svg className="h-4 w-4 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                      Deny Request
                    </button>
                    <button
                      type="button"
                      disabled={decision.isPending}
                      onClick={() => handleDecisionSubmit(true)}
                      className="rounded-xl bg-emerald-700 hover:bg-emerald-800 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Approve &amp; Release
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{remark.length}/500</span>
                  <span>🔒 The employee browser will receive this decision within a few seconds.</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-sm text-slate-500">
              Select a pending request from the queue to view details.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
