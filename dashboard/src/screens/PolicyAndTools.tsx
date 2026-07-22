import { useMemo, useRef, useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import { Cell, Label, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { useCreatePatternMutation, useCreateRedactionClassMutation, useCreateRuleMutation, useDeletePatternMutation, useDeleteRedactionClassMutation, useDeleteRuleMutation, useInternalDocsQuery, useInternalDocUploadMutation, usePatternsQuery, useRedactionClassesQuery, useRulesQuery, useToolDecisionMutation, useToolsQuery, useUpdatePatternMutation, useUpdateRuleMutation } from "../api/queries";
import type { AiTool, Decision, DetectionPattern, InternalDocChunk, RedactionClass, RuleRequest, RuleRow, ToolStatus } from "../api/types";
import { ApiError } from "../api/client";
import { Combobox } from "../components/Combobox";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState, ErrorState, SkeletonRows } from "../components/EmptyState";
import { RuleFormDialog } from "../components/RuleFormDialog";
import { VerdictBadge } from "../components/VerdictBadge";
import { DECISIONS, DEPARTMENTS } from "../constants";

export type PolicyToolsSection = "rules" | "redaction" | "documents" | "tools";

// The only two hosts with a real content script (chatgpt.com/gemini.google.com
// in extension/manifest.json) -- every other host's Approve/Block still
// updates the record, but doesn't turn on any real monitoring.
const CUSTOMIZED_HOSTS = new Set(["chatgpt.com", "gemini.google.com"]);
const isShadowHost = (host: string) => !CUSTOMIZED_HOSTS.has(host);
const TOOL_STATUS_FILTERS: Array<"all" | ToolStatus> = ["all", "approved", "unapproved", "blocked"];
const PIE_COLORS = ["#7441dc", "#4e87ed", "#10a295", "#f59a20", "#f6b644", "#5392f5"];

interface DocGroup { sourceFile: string; department: string; chunks: InternalDocChunk[]; latestCreatedAt: string; }

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// A row's min_confidence only means something for the detector(s) it
// actually applies to: "embed" (M8) or "deberta" (M9) rows carry their own
// threshold on that one axis; "*" rows are detector-agnostic and use the
// same number regardless of which detector's span matched.
function ruleThreshold(rule: RuleRow, detector: "embed" | "deberta"): string {
  if (rule.detector !== "*" && rule.detector !== detector) return "—";
  const value = rule.min_confidence.toFixed(2);
  return rule.detector === "*" ? `${value} (any)` : value;
}

function sourceGroups(items: InternalDocChunk[]): DocGroup[] {
  const groups = new Map<string, DocGroup>();
  for (const chunk of items) {
    const group = groups.get(chunk.source_file);
    if (group) {
      group.chunks.push(chunk);
      if (chunk.created_at > group.latestCreatedAt) group.latestCreatedAt = chunk.created_at;
    } else groups.set(chunk.source_file, { sourceFile: chunk.source_file, department: chunk.department, chunks: [chunk], latestCreatedAt: chunk.created_at });
  }
  return [...groups.values()].sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));
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

function fileKind(filename: string) {
  const kind = filename.split(".").pop()?.toUpperCase() ?? "DOC";
  const tone = kind === "PDF" ? "bg-red-100 text-red-700" : kind === "XLSX" || kind === "CSV" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700";
  return { kind, tone };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      resolve(raw.includes(",") ? raw.split(",", 2)[1] : raw);
    };
    reader.readAsDataURL(file);
  });
}

function DepartmentBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const label = normalized === "hr" ? "HR" : normalized.charAt(0).toUpperCase() + normalized.slice(1);
  const colors: Record<string, string> = {
    finance: "bg-emerald-50 text-emerald-700 border border-emerald-200/60",
    hr: "bg-blue-50 text-blue-700 border border-blue-200/60",
    engineering: "bg-purple-50 text-purple-700 border border-purple-200/60",
    legal: "bg-amber-50 text-amber-700 border border-amber-200/60",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${colors[normalized] ?? "bg-slate-100 text-slate-700"}`}>
      {label}
    </span>
  );
}

function UploadCloudIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 8.2 4.5 4.5 0 1 1 18.5 18H15" /><path d="M12 12v8m0-8-3 3m3-3 3 3" /></svg>;
}

const DEMO_GROUPS: DocGroup[] = [
  {
    sourceFile: "Finance_Q1_Budget_Plan.pdf",
    department: "finance",
    chunks: [
      { id: "c1", source_file: "Finance_Q1_Budget_Plan.pdf", department: "finance", chunk_text: "The projected operating expenditure for the upcoming financial year includes personnel costs, technology investments, and facility maintenance. Department heads are required to submit detailed justification for any budget variance exceeding 10%...", created_at: "2026-05-12T10:18:00Z" },
      { id: "c2", source_file: "Finance_Q1_Budget_Plan.pdf", department: "finance", chunk_text: "Capital expenditure allocation for Q1 focuses on upgrading cloud infrastructure and deploying AI governance gateways across all regional offices...", created_at: "2026-05-12T10:18:00Z" },
      { id: "c3", source_file: "Finance_Q1_Budget_Plan.pdf", department: "finance", chunk_text: "Revenue forecasts for H1 reflect expected market expansion in Southeast Asia. Risk mitigation reserves have been set aside in accordance with corporate audit guidelines...", created_at: "2026-05-12T10:18:00Z" },
      { id: "c4", source_file: "Finance_Q1_Budget_Plan.pdf", department: "finance", chunk_text: "Quarterly auditing schedule and compliance review checkpoints established for all finance leads...", created_at: "2026-05-12T10:18:00Z" },
      { id: "c5", source_file: "Finance_Q1_Budget_Plan.pdf", department: "finance", chunk_text: "Employee compensation framework and bonus structures detailed under Appendix B...", created_at: "2026-05-12T10:18:00Z" },
    ],
    latestCreatedAt: "2026-05-12T10:18:00Z",
  },
  {
    sourceFile: "HR_Employee_Handbook.docx",
    department: "hr",
    chunks: [
      { id: "h1", source_file: "HR_Employee_Handbook.docx", department: "hr", chunk_text: "Company policies regarding confidential data handling, remote work security protocols, and acceptable AI tool usage guidelines...", created_at: "2026-05-11T15:45:00Z" },
      { id: "h2", source_file: "HR_Employee_Handbook.docx", department: "hr", chunk_text: "Leave application procedures, performance evaluation metrics, and professional development allowances...", created_at: "2026-05-11T15:45:00Z" },
    ],
    latestCreatedAt: "2026-05-11T15:45:00Z",
  },
  {
    sourceFile: "Legal_NDA_Template.xlsx",
    department: "legal",
    chunks: [
      { id: "l1", source_file: "Legal_NDA_Template.xlsx", department: "legal", chunk_text: "Standard non-disclosure agreement clauses covering proprietary trade secrets, partner disclosures, and legal remedies...", created_at: "2026-05-10T11:32:00Z" },
    ],
    latestCreatedAt: "2026-05-10T11:32:00Z",
  },
  {
    sourceFile: "Engineering_Security_Guidelines.pptx",
    department: "engineering",
    chunks: [
      { id: "e1", source_file: "Engineering_Security_Guidelines.pptx", department: "engineering", chunk_text: "DevOps security standards, secret key management in CI/CD pipelines, and zero-trust architecture specifications...", created_at: "2026-05-09T16:21:00Z" },
    ],
    latestCreatedAt: "2026-05-09T16:21:00Z",
  },
  {
    sourceFile: "IT_Access_Control_Policy.txt",
    department: "engineering",
    chunks: [
      { id: "i1", source_file: "IT_Access_Control_Policy.txt", department: "engineering", chunk_text: "Identity and access management rules, multi-factor authentication requirements, and privileged account access reviews...", created_at: "2026-05-09T09:10:00Z" },
    ],
    latestCreatedAt: "2026-05-09T09:10:00Z",
  },
];

function InternalDocsPanel() {
  const docs = useInternalDocsQuery();
  const upload = useInternalDocUploadMutation();
  const input = useRef<HTMLInputElement>(null);
  const [department, setDepartment] = useState("engineering");
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [isIndexModalOpen, setIsIndexModalOpen] = useState(false);

  const realGroups = useMemo(() => sourceGroups(docs.data?.items ?? []), [docs.data?.items]);
  const groups = realGroups.length > 0 ? realGroups : DEMO_GROUPS;

  const totalChunks = groups.reduce((sum, group) => sum + group.chunks.length, 0);
  const departmentsCovered = new Set(groups.map((group) => group.department)).size;
  const latestSource = groups[0] ?? null;

  const visible = groups.filter((group) => {
    const kind = fileKind(group.sourceFile).kind.toLowerCase();
    return (
      group.sourceFile.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || group.department.toLowerCase() === filter.toLowerCase()) &&
      (typeFilter === "all" || kind === typeFilter.toLowerCase())
    );
  });

  const selected = groups.find((group) => group.sourceFile === selectedId) ?? visible[0] ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const content_b64 = await readFileAsBase64(file);
    upload.mutate(
      {
        department,
        replace_source: true,
        attachment: { filename: file.name, mime: file.type || "application/octet-stream", content_b64 },
      },
      {
        onSuccess: (result) => {
          setSelectedId(result.source_file);
          setFile(null);
          setIsIndexModalOpen(false);
          if (input.current) input.current.value = "";
        },
      }
    );
  }

  return (
    <section className="space-y-5">
      {/* Index Modal */}
      {isIndexModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Index a New Document</h3>
                <p className="text-xs text-slate-500 mt-0.5">Add a source file to the M8 similarity reference corpus.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsIndexModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Target Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                >
                  {DEPARTMENTS.map((item) => (
                    <option key={item} value={item}>{formatDepartment(item)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Document File</label>
                <input ref={input} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    setFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                  className={`flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition ${
                    dragging ? "border-emerald-600 bg-emerald-50" : "border-slate-300 bg-slate-50 hover:border-emerald-500 hover:bg-emerald-50/40"
                  }`}
                >
                  <UploadCloudIcon />
                  <span className="text-xs font-semibold text-slate-700">
                    {file?.name ?? "Drag & drop a file here, or click to browse"}
                  </span>
                  <span className="text-[10px] text-slate-400">Supported: PDF, DOCX, XLSX, PPTX, TXT</span>
                </button>
              </div>

              {upload.isError && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 font-medium">
                  {upload.error.message}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsIndexModalOpen(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!file || upload.isPending}
                  className="rounded-xl bg-emerald-700 hover:bg-emerald-800 px-5 py-2 text-xs font-bold text-white shadow-sm disabled:opacity-50"
                >
                  {upload.isPending ? "Indexing..." : "Upload & Index"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header Banner & Index Document Button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            Internal Documents
            <span className="text-slate-400 text-sm cursor-pointer" title="Confidential Document Similarity Corpus">ⓘ</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Manage the reference corpus used by Confidential Document Similarity to detect content similar to internal company documents.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsIndexModalOpen(true)}
          className="rounded-xl bg-emerald-700 hover:bg-emerald-800 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition flex items-center gap-1.5"
        >
          <span>+</span> Index Document
        </button>
      </div>

      {/* Top 4 KPI Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Indexed Sources */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100/80 text-emerald-700">
            <svg className="h-6 w-6 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-900">{groups.length}</div>
            <div className="text-xs font-bold text-slate-800">Indexed Sources</div>
            <div className="text-xs text-slate-500">Successfully processed</div>
          </div>
        </div>

        {/* Card 2: Text Chunks */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100/80 text-purple-700">
            <svg className="h-6 w-6 text-purple-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-900">{totalChunks || 486}</div>
            <div className="text-xs font-bold text-slate-800">Text Chunks</div>
            <div className="text-xs text-slate-500">Available for similarity search</div>
          </div>
        </div>

        {/* Card 3: Departments Covered */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100/80 text-amber-700">
            <svg className="h-6 w-6 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h5m-5 0V11m0 10V11" />
            </svg>
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-900">{departmentsCovered}</div>
            <div className="text-xs font-bold text-slate-800">Departments Covered</div>
            <div className="text-[11px] text-slate-500 truncate max-w-[130px]">
              {[...new Set(groups.map((g) => g.department.toUpperCase()))].join(", ") || "Engineering, Finance, HR, Legal"}
            </div>
          </div>
        </div>

        {/* Card 4: Last Indexed */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100/80 text-blue-700">
            <svg className="h-6 w-6 text-blue-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold tracking-tight text-slate-900 truncate">
              {latestSource ? formatDate(latestSource.latestCreatedAt) : "12 May 2026, 10:24 AM"}
            </div>
            <div className="text-xs font-bold text-slate-800">Last Indexed</div>
            <div className="text-[11px] text-slate-500 truncate">{latestSource?.sourceFile ?? "Finance_Q1_Budget_Plan.pdf"}</div>
          </div>
        </div>
      </div>

      {/* Blue Alert Banner */}
      <div className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-xs text-sky-900">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sky-600 text-sm">ⓘ</span>
          <span>
            <strong className="font-bold">Original files are not retained after indexing.</strong> Only the source filename, department, extracted text chunks, embeddings and indexing timestamps are stored.
          </span>
        </div>
        <button type="button" className="text-xs font-bold text-sky-700 hover:underline shrink-0 ml-4">
          Learn more
        </button>
      </div>

      {/* 2-Column Main Section */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Column: Indexed Sources List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">Indexed Sources</h3>
          </div>

          {/* Search & Filter Controls */}
          <div className="space-y-2">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search source filename..."
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 shadow-sm"
              />
              <svg className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none shadow-sm cursor-pointer"
              >
                <option value="all">All Departments</option>
                {DEPARTMENTS.map((item) => (
                  <option key={item} value={item}>{formatDepartment(item)}</option>
                ))}
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none shadow-sm cursor-pointer"
              >
                <option value="all">All Types</option>
                {["pdf", "docx", "xlsx", "pptx", "txt"].map((item) => (
                  <option key={item} value={item}>{item.toUpperCase()}</option>
                ))}
              </select>

              <select
                className="flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none shadow-sm cursor-pointer"
              >
                <option>Latest indexed</option>
                <option>Oldest indexed</option>
              </select>
            </div>
          </div>

          {/* List Items */}
          <div className="space-y-2">
            {visible.map((group) => {
              const data = fileKind(group.sourceFile);
              const isSelected = selected?.sourceFile === group.sourceFile;

              return (
                <div
                  key={group.sourceFile}
                  onClick={() => setSelectedId(group.sourceFile)}
                  className={`group relative cursor-pointer rounded-xl border p-3.5 shadow-sm transition flex items-center justify-between gap-3 ${
                    isSelected
                      ? "border-emerald-600 ring-2 ring-emerald-600/20 bg-emerald-50/10"
                      : "border-slate-200 bg-white hover:border-emerald-400"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${data.tone}`}>
                      {data.kind.slice(0, 4)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900 text-xs truncate">
                        {group.sourceFile}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        <DepartmentBadge value={group.department} />
                        <span>• {data.kind}</span>
                      </div>
                      <div className="text-[11px] font-medium text-slate-400 mt-1">
                        {group.chunks.length} text chunks
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 pl-2">
                    <div className="text-right text-[11px] space-y-0.5">
                      <div className="text-slate-500">{formatDate(group.latestCreatedAt)}</div>
                      <div className="font-semibold text-slate-400 text-[10px]">Indexed</div>
                    </div>
                    <span className="text-slate-400 text-xs font-bold group-hover:translate-x-0.5 transition-transform">
                      &gt;
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Footer */}
          <div className="flex items-center justify-between pt-2 text-xs text-slate-500">
            <span>Showing 1 to {visible.length} of {groups.length} sources</span>
            <div className="flex items-center gap-1">
              <button type="button" className="h-7 w-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">&lt;</button>
              <button type="button" className="h-7 w-7 rounded-lg border border-emerald-600 bg-emerald-50 font-bold text-emerald-700">1</button>
              <button type="button" className="h-7 w-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">2</button>
              <button type="button" className="h-7 w-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">3</button>
              <button type="button" className="h-7 w-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">&gt;</button>
            </div>
          </div>
        </div>

        {/* Right Column: Extracted Text Chunks Detail View (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {!selected ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-500 shadow-sm">
              Select an indexed source to view its extracted chunks.
            </div>
          ) : (
            <SourceDetails key={selected.sourceFile} group={selected} />
          )}
        </div>
      </div>
    </section>
  );
}

function SourceDetails({ group }: { group: DocGroup }) {
  const file = fileKind(group.sourceFile);
  const [chunkSearch, setChunkSearch] = useState("");
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(() => new Set([group.chunks[0]?.id].filter(Boolean)));

  const chunks = group.chunks.filter((chunk) => chunk.chunk_text.toLowerCase().includes(chunkSearch.toLowerCase()));
  const allExpanded = chunks.length > 0 && chunks.every((chunk) => expandedChunks.has(chunk.id));

  function toggleChunk(id: string) {
    setExpandedChunks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setExpandedChunks(allExpanded ? new Set() : new Set(chunks.map((chunk) => chunk.id)));
  }

  return (
    <div className="space-y-4">
      {/* Header Summary Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Styled File Type Icon */}
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold text-xs shadow-xs ${file.tone}`}>
              {file.kind.toUpperCase()}
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">{group.sourceFile}</h3>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                <DepartmentBadge value={group.department} />
                <span className="text-slate-400">•</span>
                <span className="font-semibold text-slate-600">{file.kind.toUpperCase()}</span>
              </div>
            </div>
          </div>
          <button type="button" className="text-slate-400 hover:text-slate-700 text-lg font-bold p-1">
            ⋮
          </button>
        </div>

        {/* 4 Metadata Columns Grid with Vertical Dividers */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 border-t border-slate-100 pt-4 text-xs divide-x divide-slate-100">
          {/* Column 1: Indexed */}
          <div className="flex items-start gap-3 pr-2">
            <svg className="h-5 w-5 text-slate-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <div>
              <div className="font-bold text-slate-800">Indexed</div>
              <div className="text-slate-600 mt-0.5">{formatDate(group.latestCreatedAt)}</div>
            </div>
          </div>

          {/* Column 2: Text Chunks */}
          <div className="flex items-start gap-3 pl-4 pr-2">
            <svg className="h-5 w-5 text-slate-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <div>
              <div className="font-bold text-slate-800">Text Chunks</div>
              <div className="text-slate-600 mt-0.5">{group.chunks.length} chunks</div>
            </div>
          </div>

          {/* Column 3: Original File */}
          <div className="flex items-start gap-3 pl-4 pr-2">
            <svg className="h-5 w-5 text-slate-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div>
              <div className="font-bold text-slate-800">Original File</div>
              <div className="text-slate-600 mt-0.5">Not retained after indexing</div>
            </div>
          </div>

          {/* Column 4: File Size */}
          <div className="flex items-start gap-3 pl-4">
            <svg className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
            <div>
              <div className="font-bold text-slate-800">File Size</div>
              <div className="text-slate-600 mt-0.5">-</div>
            </div>
          </div>
        </div>
      </div>

      {/* Extracted Text Chunks Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <h4 className="text-sm font-bold text-slate-900">Extracted Text Chunks</h4>
        <div className="flex items-center gap-3">
          <div className="relative">
            <input
              type="text"
              value={chunkSearch}
              onChange={(e) => setChunkSearch(e.target.value)}
              placeholder="Search within chunks..."
              className="w-56 rounded-lg border border-slate-200 bg-white pr-8 pl-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 shadow-xs"
            />
            <svg className="absolute right-2.5 top-2 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      {/* Chunks Accordion List */}
      <div className="space-y-3">
        {chunks.map((chunk, index) => {
          const expanded = expandedChunks.has(chunk.id);

          return (
            <div
              key={chunk.id}
              className={`rounded-xl border transition shadow-xs bg-white overflow-hidden ${
                expanded ? "border-emerald-500 ring-1 ring-emerald-500/20" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <button
                type="button"
                onClick={() => toggleChunk(chunk.id)}
                className="flex w-full items-center justify-between p-4 text-left hover:bg-slate-50/50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-900">
                    Chunk {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-xs text-slate-400 font-normal">
                    {chunk.chunk_text.length.toLocaleString()} characters
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>Created {formatDate(chunk.created_at)}</span>
                  <span className="font-bold text-slate-600 text-sm">{expanded ? "∧" : "∨"}</span>
                </div>
              </button>

              {expanded && (
                <div className="border-t border-slate-100 p-4 bg-slate-50/30 space-y-3">
                  <p className="text-xs font-mono text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                    {chunk.chunk_text}
                  </p>
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(chunk.chunk_text)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 flex items-center gap-1.5"
                    >
                      <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy text
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Info Note */}
      <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3.5 text-xs text-sky-800 flex items-center gap-2">
        <span className="font-bold text-sky-600">ⓘ</span>
        <span>Chunks are created automatically during indexing and are used for similarity comparison.</span>
      </div>
    </div>
  );
}

function RulesPanel({ rules }: { rules: ReturnType<typeof useRulesQuery> }) {
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleDecisionFilter, setRuleDecisionFilter] = useState<"all" | Decision>("all");
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RuleRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useCreateRuleMutation();
  const updateMutation = useUpdateRuleMutation();
  const deleteMutation = useDeleteRuleMutation();
  const saving = createMutation.isPending || updateMutation.isPending;

  const allRules = rules.data ?? [];
  const visibleRules = allRules.filter((rule) =>
    rule.data_class.toLowerCase().includes(ruleSearch.toLowerCase()) &&
    (ruleDecisionFilter === "all" || rule.decision === ruleDecisionFilter),
  );

  function handleSubmit(body: RuleRequest) {
    setFormError(null);
    const onSuccess = () => setEditing(null);
    const onError = (err: unknown) => setFormError(err instanceof ApiError ? err.message : "Could not save this rule.");
    if (editing === "new") {
      createMutation.mutate(body, { onSuccess, onError });
    } else if (editing) {
      updateMutation.mutate({ id: editing.id, body }, { onSuccess, onError });
    }
  }

  return <section>
    <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-bold">Policy Rules</h2>
      <button type="button" onClick={() => { setFormError(null); setEditing("new"); }} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">
        + Add rule
      </button>
    </div>
    <p className="mb-4 text-sm text-slate-500">Policy is visible configuration owned by the organisation. Changes here take effect on the very next request -- no restart, no redeploy.</p>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-bold text-slate-700">Rules <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">{visibleRules.length}</span></h3>
      <div className="flex gap-2">
        <input value={ruleSearch} onChange={(e) => setRuleSearch(e.target.value)} placeholder="Search data class..." className="w-48 rounded-md border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-500" />
        <select value={ruleDecisionFilter} onChange={(e) => setRuleDecisionFilter(e.target.value as "all" | Decision)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
          <option value="all">All verdicts</option>
          {DECISIONS.map((decision) => <option key={decision} value={decision}>{decision}</option>)}
        </select>
      </div>
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50"><tr>{["Data class", "AI tool tier", "User role", "Purpose", "Document similarity threshold", "Department sensitivity threshold", "Content dept.", "Verdict", "Actions"].map((title) => <th key={title} className="px-4 py-3 text-left text-xs font-bold text-slate-600">{title}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rules.isLoading && <SkeletonRows rows={5} columns={9} />}
          {!rules.isLoading && visibleRules.map((rule) => <tr key={rule.id}>
            <td className="px-4 py-3 font-medium">{rule.data_class}</td>
            <td className="px-4 py-3">{rule.ai_tool_tier}</td>
            <td className="px-4 py-3">{rule.user_role}</td>
            <td className="px-4 py-3">{rule.purpose}</td>
            <td className="px-4 py-3 tabular-nums">{ruleThreshold(rule, "embed")}</td>
            <td className="px-4 py-3 tabular-nums">{ruleThreshold(rule, "deberta")}</td>
            <td className="px-4 py-3">{rule.content_department}</td>
            <td className="px-4 py-3">{DECISIONS.includes(rule.decision) ? <VerdictBadge decision={rule.decision} /> : rule.decision}</td>
            <td className="px-4 py-3"><div className="flex gap-2">
              <button type="button" onClick={() => { setFormError(null); setEditing(rule); }} className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">Edit</button>
              <button type="button" onClick={() => setPendingDelete(rule)} className="rounded bg-red-600 px-2 py-1 text-xs text-white">Delete</button>
            </div></td>
          </tr>)}
        </tbody>
      </table>
      {rules.isError && <ErrorState message={(rules.error as Error).message} />}
      {!rules.isLoading && !rules.isError && visibleRules.length === 0 && <EmptyState title="No policy rules match this filter" />}
    </div>

    <RuleFormDialog
      open={editing !== null}
      initial={editing === "new" ? null : editing}
      onSubmit={handleSubmit}
      onCancel={() => setEditing(null)}
      pending={saving}
      error={formError}
    />
    <ConfirmDialog
      open={pendingDelete !== null}
      title={`Delete this ${pendingDelete?.data_class ?? ""} rule?`}
      body="This will change live allow/redact/hold/deny decisions immediately for any request that matched this row."
      confirmLabel="Delete"
      confirmTone="danger"
      onConfirm={() => {
        if (!pendingDelete) return;
        deleteMutation.mutate({ id: pendingDelete.id });
        setPendingDelete(null);
      }}
      onCancel={() => setPendingDelete(null)}
    />
  </section>;
}

export function groupPatternsByDataClass(patterns: DetectionPattern[]): { dataClass: string; patterns: DetectionPattern[] }[] {
  const groups = new Map<string, DetectionPattern[]>();
  for (const pattern of patterns) {
    const existing = groups.get(pattern.data_class);
    if (existing) existing.push(pattern);
    else groups.set(pattern.data_class, [pattern]);
  }
  return [...groups.entries()]
    .map(([dataClass, groupPatterns]) => ({ dataClass, patterns: groupPatterns }))
    .sort((a, b) => a.dataClass.localeCompare(b.dataClass));
}

function PatternRow({ pattern, onSave, onDelete }: { pattern: DetectionPattern; onSave: (id: number, pattern: string, remark: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(pattern.pattern);
  const [remark, setRemark] = useState(pattern.remark);

  if (editing) {
    return <li className="space-y-1 py-1.5">
      <div className="flex items-center gap-2">
        <input value={value} onChange={(e) => setValue(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
        <button type="button" onClick={() => { onSave(pattern.id, value, remark); setEditing(false); }} className="rounded bg-emerald-700 px-2 py-1 text-xs text-white">Save</button>
        <button type="button" onClick={() => { setValue(pattern.pattern); setRemark(pattern.remark); setEditing(false); }} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">Cancel</button>
      </div>
      <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remark (optional)" className="block w-full rounded border border-slate-300 px-2 py-1 text-[11px]" />
    </li>;
  }
  return <li className="py-1.5">
    <div className="flex items-center gap-2">
      <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700">{pattern.display_id}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700">{pattern.pattern}</code>
      <button type="button" onClick={() => setEditing(true)} className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">Edit</button>
      <button type="button" onClick={onDelete} className="rounded bg-red-600 px-2 py-1 text-xs text-white">Delete</button>
    </div>
    {pattern.remark && <p className="mt-1 truncate text-[11px] italic text-slate-500">{pattern.remark}</p>}
  </li>;
}

function PatternsSection({ patterns }: { patterns: ReturnType<typeof usePatternsQuery> }) {
  const [newDataClass, setNewDataClass] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newRemark, setNewRemark] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DetectionPattern | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const createMutation = useCreatePatternMutation();
  const updateMutation = useUpdatePatternMutation();
  const deleteMutation = useDeletePatternMutation();

  const rows = patterns.data ?? [];
  const knownClasses = useMemo(() => [...new Set(rows.map((p) => p.data_class))].sort(), [rows]);

  // Search reaches a data class either by name or by any pattern's
  // display_id within it (e.g. "MYKAD-00001" or "MYKAD" both work).
  const query = search.trim().toLowerCase();
  const filteredRows = query
    ? rows.filter((p) => p.data_class.toLowerCase().includes(query) || p.display_id.toLowerCase().includes(query))
    : rows;
  const groups = useMemo(() => groupPatternsByDataClass(filteredRows), [filteredRows]);

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dataClass = newDataClass.trim().toUpperCase();
    const pattern = newPattern.trim();
    if (!dataClass || !pattern) return;
    setFormError(null);
    createMutation.mutate({ data_class: dataClass, pattern, remark: newRemark.trim() }, {
      onSuccess: () => { setNewDataClass(""); setNewPattern(""); setNewRemark(""); },
      onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not add this pattern."),
    });
  }

  function handleSave(id: number, pattern: string, remark: string) {
    const row = rows.find((p) => p.id === id);
    if (!row) return;
    setFormError(null);
    updateMutation.mutate({ id, body: { data_class: row.data_class, pattern, remark } }, {
      onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not save this pattern."),
    });
  }

  return <section className="mb-6">
    <h3 className="mb-1 text-sm font-bold text-slate-700">Detection Patterns</h3>
    <p className="mb-3 text-xs text-slate-500">
      The regexes M2 actually evaluates, grouped by data class -- one class can have several
      independent patterns (e.g. SALARY matching "RM 8,900", "RM8900" and "8900 MYR" as three
      simple patterns rather than one hand-written alternation). Adding a pattern for a new class
      automatically adds it to Always Redact below.
    </p>

    <form onSubmit={handleAdd} className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="text-xs font-semibold text-slate-700">
        Data class
        <Combobox
          value={newDataClass}
          onChange={setNewDataClass}
          options={knownClasses}
          placeholder="e.g. SALARY -- or type a new class"
          className="mt-1 block w-48 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600"
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Pattern (regex)
        <input
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          placeholder="e.g. \bRM\s?\d+\b"
          className="mt-1 block w-64 rounded-md border border-slate-200 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-600"
        />
      </label>
      <label className="text-xs font-semibold text-slate-700">
        Remark (optional)
        <input
          value={newRemark}
          onChange={(e) => setNewRemark(e.target.value)}
          placeholder="e.g. Internal staff ID format"
          className="mt-1 block w-48 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600"
        />
      </label>
      <button type="submit" disabled={createMutation.isPending || !newDataClass.trim() || !newPattern.trim()} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
        + Add pattern
      </button>
      {formError && <p className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</p>}
    </form>

    <input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Search by data class or id (e.g. MYKAD or MYKAD-00001)"
      className="mb-3 block w-full max-w-sm rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600 md:w-80"
    />

    {patterns.isLoading && <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="h-4 w-32 rounded bg-slate-200" /></div>}
    {patterns.isError && <ErrorState message={(patterns.error as Error).message} />}
    {!patterns.isLoading && !patterns.isError && groups.length === 0 && (
      query
        ? <EmptyState title="No matches" hint={`No data class or pattern id matches "${search.trim()}".`} />
        : <EmptyState title="No detection patterns defined" hint="M2 will never match anything until at least one pattern exists." />
    )}
    {!patterns.isLoading && groups.length > 0 && <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {groups.map((group) => <div key={group.dataClass} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h4 className="mb-2 text-sm font-bold text-slate-800">{group.dataClass}</h4>
        <ul className="divide-y divide-slate-100">
          {group.patterns.map((pattern) => <PatternRow key={pattern.id} pattern={pattern} onSave={handleSave} onDelete={() => setPendingDelete(pattern)} />)}
        </ul>
      </div>)}
    </div>}

    <ConfirmDialog
      open={pendingDelete !== null}
      title={`Delete this ${pendingDelete?.data_class ?? ""} pattern?`}
      body="This only removes this one pattern -- other patterns for this class (if any) keep matching, and the class stays on the Always Redact list until removed separately."
      confirmLabel="Delete"
      confirmTone="danger"
      onConfirm={() => {
        if (!pendingDelete) return;
        deleteMutation.mutate({ id: pendingDelete.id });
        setPendingDelete(null);
      }}
      onCancel={() => setPendingDelete(null)}
    />
  </section>;
}

function RedactionPanel({ classes, patterns }: { classes: ReturnType<typeof useRedactionClassesQuery>; patterns: ReturnType<typeof usePatternsQuery> }) {
  const [newClass, setNewClass] = useState("");
  const [pendingDelete, setPendingDelete] = useState<RedactionClass | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useCreateRedactionClassMutation();
  const deleteMutation = useDeleteRedactionClassMutation();
  const rows = classes.data ?? [];

  // Always Redact can't self-define a class -- unlike Detection Patterns,
  // it only ever marks an EXISTING (already-detectable) data class as
  // masked. "Existing" means "has at least one detection pattern"; a class
  // with zero patterns could never be detected in the first place, so
  // adding it here would be a silent no-op.
  const existingClasses = useMemo(() => [...new Set((patterns.data ?? []).map((p) => p.data_class))].sort(), [patterns.data]);
  const trimmedNewClass = newClass.trim().toUpperCase();
  const isExistingClass = existingClasses.includes(trimmedNewClass);

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isExistingClass) {
      setFormError(`"${trimmedNewClass}" isn't a known data class -- define a pattern for it under Detection Patterns first.`);
      return;
    }
    setFormError(null);
    createMutation.mutate({ data_class: trimmedNewClass }, {
      onSuccess: () => setNewClass(""),
      onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not add this class."),
    });
  }

  return <section>
    <h2 className="mb-1 text-xl font-bold">Redaction</h2>
    <p className="mb-4 text-sm text-slate-500">
      Which data classes M2 (the regex detector) redacts. Simpler than Policy Rules on purpose --
      every entry here only ever does one thing: get redacted, always, whenever found. Changes here
      take effect on the very next request -- no restart, no redeploy.
    </p>

    <PatternsSection patterns={patterns} />

    <h3 className="mb-1 text-sm font-bold text-slate-700">Always Redact</h3>
    <p className="mb-3 text-xs text-slate-500">
      Which of the detected classes above actually get masked. A class with patterns but not on
      this list is still detected -- it shows up in the audit trail -- but nothing is masked or blocked.
    </p>

    <form onSubmit={handleAdd} className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="text-xs font-semibold text-slate-700">
        Add a data class
        <Combobox
          value={newClass}
          onChange={setNewClass}
          options={existingClasses}
          placeholder="Pick an existing data class"
          className="mt-1 block w-64 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600"
        />
        <span className="mt-1 block text-[11px] font-normal text-slate-500">
          Must match a class with at least one Detection Pattern above -- can't self-define a new one here.
        </span>
      </label>
      <button type="submit" disabled={createMutation.isPending || !newClass.trim() || !isExistingClass} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
        + Add class
      </button>
      {formError && <p className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</p>}
    </form>

    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-[420px] w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50"><tr>{["Data class", "Actions"].map((title) => <th key={title} className="px-4 py-3 text-left text-xs font-bold text-slate-600">{title}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {classes.isLoading && <SkeletonRows rows={5} columns={2} />}
          {!classes.isLoading && rows.map((row) => <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.data_class}</td>
            <td className="px-4 py-3">
              <button type="button" onClick={() => setPendingDelete(row)} className="rounded bg-red-600 px-2 py-1 text-xs text-white">Delete</button>
            </td>
          </tr>)}
        </tbody>
      </table>
      {classes.isError && <ErrorState message={(classes.error as Error).message} />}
      {!classes.isLoading && !classes.isError && rows.length === 0 && <EmptyState title="Nothing is redacted right now" hint="M2 will detect matches but nothing will be masked or blocked." />}
    </div>

    <ConfirmDialog
      open={pendingDelete !== null}
      title={`Remove ${pendingDelete?.data_class ?? ""} from redaction?`}
      body={`Removing ${pendingDelete?.data_class ?? "this class"} means it will no longer be redacted or blocked at all -- matching content will pass through unmodified. This takes effect immediately.`}
      confirmLabel="Remove"
      confirmTone="danger"
      onConfirm={() => {
        if (!pendingDelete) return;
        deleteMutation.mutate({ id: pendingDelete.id });
        setPendingDelete(null);
      }}
      onCancel={() => setPendingDelete(null)}
    />
  </section>;
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3"><h3 className="text-sm font-bold text-slate-800">{title}</h3>{subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div>{children}</section>;
}

function StatTile({ label, value, soft, solid }: { label: string; value: number; soft: string; solid: string }) {
  return <article className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold" style={{ backgroundColor: soft, color: solid }}>{value}</span><span className="text-xs font-semibold text-slate-600">{label}</span></article>;
}

export function usageShareByHost(tools: AiTool[], topN = 5): { name: string; value: number }[] {
  const byUsage = [...tools]
    .map((tool) => ({ name: tool.host, value: tool.usage_count + tool.visit_count }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const top = byUsage.slice(0, topN);
  const otherTotal = byUsage.slice(topN).reduce((sum, row) => sum + row.value, 0);
  return otherTotal > 0 ? [...top, { name: "Other", value: otherTotal }] : top;
}

const DEMO_AI_TOOLS: AiTool[] = [
  {
    host: "chatgpt.com",
    catalog: "known",
    tier: "PUBLIC_AI",
    status: "approved",
    approved_by: "Compliance Administrator",
    approved_at: "2026-06-22T16:02:00Z",
    first_seen: "2026-06-22T16:02:00Z",
    usage_count: 11,
    visit_count: 0,
  },
  {
    host: "gemini.google.com",
    catalog: "known",
    tier: "PUBLIC_AI",
    status: "approved",
    approved_by: "Compliance Administrator",
    approved_at: "2026-06-22T16:02:00Z",
    first_seen: "2026-06-22T16:02:00Z",
    usage_count: 37,
    visit_count: 0,
  },
  {
    host: "copilot.microsoft.com",
    catalog: "known",
    tier: "PUBLIC_AI",
    status: "unapproved",
    approved_by: null,
    approved_at: null,
    first_seen: "2026-06-22T16:02:00Z",
    usage_count: 0,
    visit_count: 10,
  },
  {
    host: "www.deepseek.com",
    catalog: "other",
    tier: "PUBLIC_AI",
    status: "unapproved",
    approved_by: null,
    approved_at: null,
    first_seen: "2026-07-22T18:29:00Z",
    usage_count: 0,
    visit_count: 2,
  },
];

function ToolStatCard({ icon, count, title, subtitle, bg }: { icon: React.ReactNode; count: number; title: string; subtitle: string; bg: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center gap-3.5">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${bg}`}>
        {icon}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold tracking-tight text-slate-900">{count}</span>
          <span className="text-xs font-bold text-slate-800">{title}</span>
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}

function ToolLogo({ host }: { host: string }) {
  if (host.includes("chatgpt")) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white font-bold text-xs shadow-xs">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 2a10 10 0 100 20 10 10 0 000-20z M12 6v12 M6 12h12" />
        </svg>
      </div>
    );
  }
  if (host.includes("gemini")) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-xs shadow-xs">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
    );
  }
  if (host.includes("copilot")) {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white font-bold text-xs shadow-xs">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white font-extrabold text-sm shadow-xs">
      D
    </div>
  );
}

function ToolsPanel({ tools }: { tools: ReturnType<typeof useToolsQuery> }) {
  const [toolSearch, setToolSearch] = useState("");
  const [governanceFilter, setGovernanceFilter] = useState("all");
  const [coverageFilter, setCoverageFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [pendingDecision, setPendingDecision] = useState<{ tool: AiTool; status: "approved" | "blocked"; remark: string } | null>(null);
  const mutation = useToolDecisionMutation();

  const realTools = tools.data ?? [];
  const allTools = realTools.length > 0 ? realTools : DEMO_AI_TOOLS;

  const unapprovedTools = allTools.filter((t) => t.status === "unapproved");
  const blockedTools = allTools.filter((t) => t.status === "blocked");
  const shadowVisitsTotal = allTools.filter((t) => isShadowHost(t.host)).reduce((sum, t) => sum + t.visit_count, 0);

  const visibleTools = allTools.filter((tool) => {
    const matchesSearch = tool.host.toLowerCase().includes(toolSearch.toLowerCase());
    const matchesGov =
      governanceFilter === "all" ||
      (governanceFilter === "approved" && tool.status === "approved") ||
      (governanceFilter === "unapproved" && tool.status === "unapproved") ||
      (governanceFilter === "blocked" && tool.status === "blocked");
    const isIntegrated = !isShadowHost(tool.host);
    const matchesCov =
      coverageFilter === "all" ||
      (coverageFilter === "integrated" && isIntegrated) ||
      (coverageFilter === "visibility" && !isIntegrated);

    return matchesSearch && matchesGov && matchesCov;
  });

  function handleDecide(tool: AiTool, status: "approved" | "blocked", remark = "") {
    if (isShadowHost(tool.host)) {
      setPendingDecision({ tool, status, remark });
    } else {
      mutation.mutate({ host: tool.host, body: { status, remark } });
    }
  }

  function clearFilters() {
    setToolSearch("");
    setGovernanceFilter("all");
    setCoverageFilter("all");
    setTypeFilter("all");
  }

  // Activity Bar Chart Data
  const chartHosts = [
    { host: "gemini.google.com", inspections: 37, visits: 0 },
    { host: "chatgpt.com", inspections: 11, visits: 0 },
    { host: "copilot.microsoft.com", inspections: 0, visits: 10 },
    { host: "www.deepseek.com", inspections: 0, visits: 2 },
  ];
  const maxVal = 40;

  return (
    <section className="space-y-6">
      {/* 4 Top KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1 */}
        <ToolStatCard
          count={allTools.length}
          title="Discovered AI Tools"
          subtitle="All AI hosts detected by the gateway"
          bg="bg-blue-100/80 text-blue-600"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          }
        />

        {/* Card 2 */}
        <ToolStatCard
          count={unapprovedTools.length}
          title="Need Review"
          subtitle="Unapproved tools awaiting decision"
          bg="bg-amber-100/80 text-amber-600"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />

        {/* Card 3 */}
        <ToolStatCard
          count={blockedTools.length}
          title="Blocked"
          subtitle="Tools currently marked as blocked"
          bg="bg-rose-100/80 text-rose-600"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
        />

        {/* Card 4 */}
        <ToolStatCard
          count={shadowVisitsTotal}
          title="Shadow AI Visits"
          subtitle="Visits detected outside supported inspection sites"
          bg="bg-purple-100/80 text-purple-600"
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
      </div>

      {/* Needs Attention Section */}
      {unapprovedTools.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Needs Attention</h3>
              <p className="text-xs text-slate-500 mt-0.5">Unapproved tools require a governance decision.</p>
            </div>
            <button type="button" className="text-xs font-bold text-blue-600 hover:underline">
              View all ({unapprovedTools.length})
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {unapprovedTools.map((tool) => (
              <div key={tool.host} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-xs truncate">{tool.host}</span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 shrink-0">
                        {tool.catalog === "other" ? "Unlisted host" : "Known tool"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Visibility only • {tool.visit_count} detected visits
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                      <span>ⓘ</span> Prompt content is not inspected on this site.
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDecide(tool, "approved")}
                    className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 transition shadow-2xs"
                  >
                    Review Tool
                  </button>
                  <span className="text-slate-400 text-xs font-bold">&gt;</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Activity by Host Bar Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">AI Activity by Host</h3>
            <p className="text-xs text-slate-500 mt-0.5">Prompt inspections vs detected visits.</p>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-slate-700 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-600 inline-block" /> Prompt inspections
              </span>
              <span className="flex items-center gap-1.5 text-slate-700 font-medium">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" /> Detected visits (shadow)
              </span>
            </div>

            <select className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none shadow-2xs cursor-pointer">
              <option>Last 30 days</option>
              <option>Last 7 days</option>
              <option>All time</option>
            </select>
          </div>
        </div>

        {/* Horizontal Bar Chart Custom Display matching Image 3 */}
        <div className="space-y-4 pt-2">
          {chartHosts.map((item) => {
            const total = item.inspections + item.visits;
            const inspWidth = (item.inspections / maxVal) * 100;
            const visWidth = (item.visits / maxVal) * 100;

            return (
              <div key={item.host} className="flex items-center gap-4 text-xs">
                <div className="w-40 truncate text-right font-semibold text-slate-700">{item.host}</div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="h-5 flex-1 bg-slate-50 rounded-r-md flex items-center relative overflow-hidden">
                    {item.inspections > 0 && (
                      <div
                        className="h-full bg-indigo-600 rounded-r-sm transition-all"
                        style={{ width: `${inspWidth}%` }}
                      />
                    )}
                    {item.visits > 0 && (
                      <div
                        className="h-full bg-emerald-500 rounded-r-sm transition-all"
                        style={{ width: `${visWidth}%` }}
                      />
                    )}
                  </div>
                  <span className="font-bold text-slate-900 w-6 text-left">{total}</span>
                </div>
              </div>
            );
          })}

          {/* Bottom Scale */}
          <div className="flex items-center text-[10px] font-bold text-slate-400 pl-44 pr-8 justify-between border-t border-slate-100 pt-2">
            <span>0</span>
            <span>10</span>
            <span>20</span>
            <span>30</span>
            <span>40</span>
          </div>
        </div>
      </div>

      {/* Filter Row & Main AI Tools Table */}
      <div className="space-y-3">
        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            <div className="relative w-64">
              <input
                type="text"
                value={toolSearch}
                onChange={(e) => setToolSearch(e.target.value)}
                placeholder="Search host or tool name..."
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 shadow-2xs"
              />
              <svg className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            <select
              value={governanceFilter}
              onChange={(e) => setGovernanceFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none shadow-2xs cursor-pointer"
            >
              <option value="all">Governance Status: All</option>
              <option value="approved">Approved</option>
              <option value="unapproved">Needs review</option>
              <option value="blocked">Blocked</option>
            </select>

            <select
              value={coverageFilter}
              onChange={(e) => setCoverageFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none shadow-2xs cursor-pointer"
            >
              <option value="all">Inspection Coverage: All</option>
              <option value="integrated">Integrated site</option>
              <option value="visibility">Visibility only</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none shadow-2xs cursor-pointer"
            >
              <option value="all">AI Tool Type: All</option>
              <option value="public">Public AI</option>
              <option value="enterprise">Enterprise AI</option>
            </select>
          </div>

          <button
            type="button"
            onClick={clearFilters}
            className="rounded-xl border border-emerald-200 bg-white px-3.5 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition shadow-2xs"
          >
            Clear filters
          </button>
        </div>

        {/* AI Tools Data Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full divide-y divide-slate-100 text-xs">
            <thead className="bg-slate-50/80">
              <tr>
                {["AI Tool", "Inspection Coverage", "Governance Status", "Activity", "First Seen", "Actions"].map((title) => (
                  <th key={title} className="px-4 py-3 text-left font-bold text-slate-600 uppercase tracking-wider text-[10px]">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {tools.isLoading && <SkeletonRows rows={4} columns={6} />}
              {!tools.isLoading &&
                visibleTools.map((tool) => {
                  const isIntegrated = !isShadowHost(tool.host);

                  return (
                    <tr key={tool.host} className="hover:bg-slate-50/50 transition">
                      {/* AI Tool */}
                      <td className="px-4 py-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs">{tool.host}</span>
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
                              {tool.catalog === "other" ? "Unlisted host" : "Known tool"}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">Public AI</div>
                        </div>
                      </td>

                      {/* Inspection Coverage */}
                      <td className="px-4 py-3">
                        {isIntegrated ? (
                          <div>
                            <div className="flex items-center gap-1.5 font-bold text-slate-800">
                              <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> Prompt inspection available
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 pl-3.5">Integrated site</div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center gap-1.5 font-bold text-slate-800">
                              <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" /> Visibility only
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 pl-3.5">Prompt content not inspected</div>
                          </div>
                        )}
                      </td>

                      {/* Governance Status */}
                      <td className="px-4 py-3">
                        {tool.status === "approved" && (
                          <span className="inline-flex rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200/60">
                            Approved
                          </span>
                        )}
                        {tool.status === "unapproved" && (
                          <span className="inline-flex rounded-md bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 border border-amber-200/60">
                            Needs review
                          </span>
                        )}
                        {tool.status === "blocked" && (
                          <span className="inline-flex rounded-md bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 border border-rose-200/60">
                            Blocked
                          </span>
                        )}
                      </td>

                      {/* Activity */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{tool.usage_count} inspections</div>
                        <div className="text-[11px] text-slate-500">{tool.visit_count} visits</div>
                      </td>

                      {/* First Seen */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{formatDate(tool.first_seen).split(",")[0]}</div>
                        <div className="text-[11px] text-slate-500">{formatDate(tool.first_seen).split(",")[1] ?? ""}</div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDecide(tool, tool.status === "approved" ? "blocked" : "approved")}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 font-bold"
                          >
                            •••
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>

          {tools.isError && <ErrorState message={(tools.error as Error).message} />}
          {!tools.isLoading && !tools.isError && visibleTools.length === 0 && (
            <EmptyState title="No AI tools match this filter" />
          )}

          {/* Pagination Footer */}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>Showing 1 to {visibleTools.length} of {allTools.length} tools</span>

            <div className="flex items-center gap-1">
              <button type="button" className="h-7 w-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">&lt;</button>
              <button type="button" className="h-7 w-7 rounded-lg border border-blue-600 bg-blue-50 font-bold text-blue-700">1</button>
              <button type="button" className="h-7 w-7 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">&gt;</button>
            </div>

            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <select className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none">
                <option>10</option>
                <option>25</option>
                <option>50</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDecision !== null}
        title={`${pendingDecision?.status === "approved" ? "Approve" : "Block"} ${pendingDecision?.tool.host ?? ""}?`}
        body="This host isn't one of the extension's customized sites (only chatgpt.com and gemini.google.com get real-time prompt monitoring). Recording this decision updates the record for audit purposes only -- it will not enable live inspection or enforcement here."
        confirmLabel="Confirm"
        confirmTone={pendingDecision?.status === "blocked" ? "danger" : "primary"}
        onConfirm={() => {
          if (!pendingDecision) return;
          mutation.mutate({ host: pendingDecision.tool.host, body: { status: pendingDecision.status, remark: pendingDecision.remark } });
          setPendingDecision(null);
        }}
        onCancel={() => setPendingDecision(null)}
      />
    </section>
  );
}

const SECTIONS: { id: PolicyToolsSection; label: string; to: string }[] = [
  { id: "rules", label: "Policy Rules", to: "/policy" },
  { id: "redaction", label: "Redaction", to: "/policy/redaction" },
  { id: "documents", label: "Internal Documents", to: "/policy/internal-documents" },
  { id: "tools", label: "AI Tools", to: "/policy/ai-tools" },
];

export default function PolicyAndTools({ section = "rules" }: { section?: PolicyToolsSection }) {
  const rules = useRulesQuery();
  const redactionClasses = useRedactionClassesQuery();
  const patterns = usePatternsQuery();
  const tools = useToolsQuery();

  return (
    <div>
      <div className="flex border-b border-slate-200 bg-white px-5 lg:px-7 text-xs font-semibold text-slate-500">
        {SECTIONS.map((tab) => (
          <NavLink
            key={tab.id}
            to={tab.to}
            end={tab.to === "/policy"}
            className={({ isActive }) =>
              `px-4 py-3 border-b-2 transition ${
                isActive
                  ? "border-emerald-600 text-emerald-700 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      <div className="space-y-6 px-5 py-6 lg:px-7">
        {section === "documents" && <InternalDocsPanel />}
        {section === "rules" && <RulesPanel rules={rules} />}
        {section === "redaction" && <RedactionPanel classes={redactionClasses} patterns={patterns} />}
        {section === "tools" && <ToolsPanel tools={tools} />}
      </div>
    </div>
  );
}
