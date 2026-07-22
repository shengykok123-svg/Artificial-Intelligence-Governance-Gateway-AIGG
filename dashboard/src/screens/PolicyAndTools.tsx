import { useMemo, useRef, useState, type FormEvent } from "react";
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
  const colors: Record<string, string> = { finance: "bg-emerald-100 text-emerald-700", hr: "bg-blue-100 text-blue-700", engineering: "bg-violet-100 text-violet-700", legal: "bg-orange-100 text-orange-700" };
  return <span className={`rounded px-2 py-1 text-xs font-semibold ${colors[value] ?? "bg-slate-100 text-slate-700"}`}>{value[0].toUpperCase() + value.slice(1)}</span>;
}

function UploadCloudIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 8.2 4.5 4.5 0 1 1 18.5 18H15" /><path d="M12 12v8m0-8-3 3m3-3 3 3" /></svg>;
}

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
  const groups = useMemo(() => sourceGroups(docs.data?.items ?? []), [docs.data?.items]);
  const totalChunks = groups.reduce((sum, group) => sum + group.chunks.length, 0);
  const departmentsCovered = new Set(groups.map((group) => group.department)).size;
  const latestSource = groups[0] ?? null;
  const visible = groups.filter((group) => {
    const kind = fileKind(group.sourceFile).kind.toLowerCase();
    return group.sourceFile.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || group.department === filter) &&
      (typeFilter === "all" || kind === typeFilter);
  });
  const selected = groups.find((group) => group.sourceFile === selectedId) ?? visible[0] ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const content_b64 = await readFileAsBase64(file);
    upload.mutate({ department, replace_source: true, attachment: { filename: file.name, mime: file.type || "application/octet-stream", content_b64 } }, { onSuccess: (result) => { setSelectedId(result.source_file); setFile(null); if (input.current) input.current.value = ""; } });
  }

  return <section className="internal-doc-page space-y-5">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-2xl font-bold text-slate-950">{groups.length}</p><p className="mt-1 text-xs font-bold text-slate-700">Indexed Sources</p><p className="mt-1 text-xs text-slate-500">Successfully processed</p></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-2xl font-bold text-slate-950">{totalChunks}</p><p className="mt-1 text-xs font-bold text-slate-700">Text Chunks</p><p className="mt-1 text-xs text-slate-500">Available for similarity search</p></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-2xl font-bold text-slate-950">{departmentsCovered}</p><p className="mt-1 text-xs font-bold text-slate-700">Departments Covered</p><p className="mt-1 text-xs text-slate-500">{[...new Set(groups.map((group) => group.department))].join(", ") || "No departments yet"}</p></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm font-bold text-slate-900">{latestSource ? formatDate(latestSource.latestCreatedAt) : "—"}</p><p className="mt-1 text-xs font-bold text-slate-700">Last Indexed</p><p className="mt-1 truncate text-xs text-slate-500">{latestSource?.sourceFile ?? "No source indexed yet"}</p></div>
    </div>

    <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900"><span className="mr-2 font-bold">ⓘ Original files are not retained after indexing.</span>Only the source filename, department, extracted text chunks, embeddings and indexing timestamps are stored.</p>

    <form onSubmit={submit} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-4 py-3"><div><h3 className="text-sm font-bold text-slate-800">Index a new document</h3><p className="mt-1 text-xs text-slate-500">Add a source to the M8 similarity corpus.</p></div><label className="text-xs font-semibold text-slate-700">Department<select value={department} onChange={(e) => setDepartment(e.target.value)} className="ml-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600">{DEPARTMENTS.map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="flex flex-wrap items-center gap-3 p-4"><input ref={input} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><button type="button" onClick={() => input.current?.click()} onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); setFile(e.dataTransfer.files?.[0] ?? null); }} className={`flex min-h-16 flex-1 items-center justify-center gap-3 rounded-lg border border-dashed p-3 text-left transition ${dragging ? "border-emerald-600 bg-emerald-50" : "border-slate-300 bg-slate-50 hover:border-emerald-500 hover:bg-emerald-50/40"}`}><span className="text-slate-500"><UploadCloudIcon /></span><span><span className="block text-sm font-medium text-slate-700">{file?.name ?? "Drag and drop a file here, or choose a file"}</span><span className="mt-1 block text-xs text-slate-500">Supported: PDF, DOCX, XLSX, PPTX, TXT</span></span></button><button type="submit" disabled={!file || upload.isPending} className="rounded-md bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{upload.isPending ? "Indexing..." : "Upload & index"}</button></div></form>
    {upload.data && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">Indexed {upload.data.chunk_count} chunks from {upload.data.source_file}</p>}
    {upload.isError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{upload.error.message}</p>}

    <div className="internal-doc-layout gap-4"><main className="min-w-0 space-y-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-900">Indexed Sources <span className="ml-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">{groups.length}</span></h3><p className="mt-1 text-xs text-slate-500">Select a source to inspect its extracted chunks.</p></div><div className="flex flex-wrap gap-2"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search source filename..." className="w-52 rounded-md border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-500" /><select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"><option value="all">All departments</option>{DEPARTMENTS.map((item) => <option key={item}>{item}</option>)}</select><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"><option value="all">All types</option>{["pdf", "docx", "xlsx", "pptx", "txt"].map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></div></div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">{docs.isLoading && <table className="w-full"><tbody><SkeletonRows rows={5} columns={4} /></tbody></table>}{!docs.isLoading && visible.map((group) => { const data = fileKind(group.sourceFile); const active = selected?.sourceFile === group.sourceFile; return <button type="button" key={group.sourceFile} onClick={() => setSelectedId(group.sourceFile)} className={`flex w-full items-center gap-3 border-b border-slate-100 p-4 text-left transition last:border-0 ${active ? "bg-emerald-50/70 ring-1 ring-inset ring-emerald-500" : "hover:bg-slate-50"}`}><span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${data.tone}`}>{data.kind.slice(0, 4)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-800">{group.sourceFile}</span><span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><DepartmentBadge value={group.department} /><span>• {data.kind}</span><span>• {group.chunks.length} text chunks</span></span></span><span className="hidden text-right text-xs text-slate-500 md:block">{formatDate(group.latestCreatedAt)}<br /><span className="text-[11px]">Indexed</span></span><span className="text-lg text-slate-500">›</span></button>; })}{!docs.isLoading && docs.isError && <ErrorState message={(docs.error as Error).message} />}{!docs.isLoading && !docs.isError && visible.length === 0 && <EmptyState title="No indexed sources match this filter" />}</div><p className="text-xs text-slate-500">Showing {visible.length} of {groups.length} sources</p></main><aside className="internal-doc-detail-pane min-w-0 rounded-xl border border-slate-200 bg-slate-50 shadow-sm">{!selected ? <div className="flex min-h-[500px] items-center justify-center p-8 text-center text-sm text-slate-500">Select an indexed source to view its extracted chunks.</div> : <SourceDetails key={selected.sourceFile} group={selected} close={() => setSelectedId(null)} />}</aside></div>
  </section>;
}

function SourceDetails({ group, close }: { group: DocGroup; close: () => void }) {
  const file = fileKind(group.sourceFile);
  const [chunkSearch, setChunkSearch] = useState("");
  // Chunks can contain large spreadsheet/PDF extracts, so keep the detail view
  // compact until the reviewer explicitly opens the chunk they need.
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(() => new Set());
  const chunks = group.chunks.filter((chunk) => chunk.chunk_text.toLowerCase().includes(chunkSearch.toLowerCase()));
  const allExpanded = chunks.length > 0 && chunks.every((chunk) => expandedChunks.has(chunk.id));
  function toggleChunk(id: string) { setExpandedChunks((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleAll() { setExpandedChunks(allExpanded ? new Set() : new Set(chunks.map((chunk) => chunk.id))); }
  return <div className="flex min-h-0 flex-col"><div className="border-b border-slate-200 bg-white p-5"><div className="flex justify-between"><h3 className="text-lg font-bold">Source Details</h3><button onClick={close} className="rounded p-1 text-xl text-slate-500 hover:bg-slate-100" aria-label="Close source details">×</button></div><div className="mt-5 flex items-center gap-3"><span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold ${file.tone}`}>{file.kind.slice(0, 4)}</span><span className="min-w-0 flex-1 break-all text-sm font-bold text-slate-800">{group.sourceFile}</span><DepartmentBadge value={group.department} /><span className="text-xs text-slate-500">• {file.kind}</span></div><dl className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs"><div><dt className="text-slate-500">Indexed</dt><dd className="mt-1 font-semibold text-slate-800">{formatDate(group.latestCreatedAt)}</dd></div><div><dt className="text-slate-500">Text chunks</dt><dd className="mt-1 font-semibold text-slate-800">{group.chunks.length}</dd></div><div><dt className="text-slate-500">Original file</dt><dd className="mt-1 font-semibold text-slate-800">Not retained</dd></div><div><dt className="text-slate-500">File size</dt><dd className="mt-1 font-semibold text-slate-500">—</dd></div></dl></div><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-bold">Extracted Text Chunks</h4><p className="mt-1 text-xs leading-5 text-slate-500">Chunks are used for M8 similarity comparison.</p></div><button type="button" onClick={toggleAll} className="text-xs font-semibold text-emerald-700">{allExpanded ? "Collapse all" : "Expand all"}</button></div><div className="relative"><input value={chunkSearch} onChange={(e) => setChunkSearch(e.target.value)} placeholder="Search within chunks..." className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-600" /></div>{chunks.map((chunk, index) => { const expanded = expandedChunks.has(chunk.id); return <article key={chunk.id} className={`overflow-hidden rounded-lg border ${expanded ? "border-emerald-300" : "border-slate-200"} bg-white`}><button type="button" onClick={() => toggleChunk(chunk.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-slate-50"><span className="text-sm font-bold">Chunk {String(index + 1).padStart(2, "0")} <span className="ml-2 text-xs font-normal text-slate-500">{chunk.chunk_text.length.toLocaleString()} characters</span></span><span className="flex items-center gap-3 text-xs text-slate-500"><span>Created {formatDate(chunk.created_at)}</span><span className="text-base">{expanded ? "⌃" : "⌄"}</span></span></button>{expanded && <div className="border-t border-slate-100 px-3 pb-3"><p className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words pr-1 text-xs leading-5 text-slate-700">{chunk.chunk_text}</p><div className="mt-3 flex justify-end"><button type="button" onClick={() => void navigator.clipboard?.writeText(chunk.chunk_text)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Copy text</button></div></div>}</article>; })}{chunks.length === 0 && <EmptyState title="No chunks match this search" />}</div><div className="border-t border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-800">ⓘ Chunks are created automatically during indexing and used for similarity comparison. Original files are not retained.</div></div>;
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

function ToolsSummarySection({ tools }: { tools: AiTool[] }) {
  const unapproved = tools.filter((tool) => tool.status === "unapproved").length;
  const blocked = tools.filter((tool) => tool.status === "blocked").length;
  const shadowVisits = tools.filter((tool) => isShadowHost(tool.host)).reduce((sum, tool) => sum + tool.visit_count, 0);
  const pieData = useMemo(() => usageShareByHost(tools), [tools]);
  const totalUsage = pieData.reduce((sum, row) => sum + row.value, 0);

  return <section className="mb-5 space-y-3">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Total AI Tools" value={tools.length} soft="#e5f7ec" solid="#169b5b" />
      <StatTile label="Unapproved" value={unapproved} soft="#fff1dc" solid="#f59a20" />
      <StatTile label="Blocked" value={blocked} soft="#ffe8e7" solid="#ef3f3c" />
      <StatTile label="Shadow Visits" value={shadowVisits} soft="#efe9ff" solid="#7441dc" />
    </div>
    <Card title="Usage Share by Host" subtitle="Real prompt inspections plus detected shadow-AI visits, last known state.">
      {pieData.length === 0 ? <EmptyState title="No usage recorded yet" /> : <div className="h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>{pieData.map((_entry, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}<Label value={`${totalUsage} total`} position="center" fill="#0f172a" style={{ fontSize: 14, fontWeight: 700 }} /></Pie><Tooltip /><Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div>}
    </Card>
  </section>;
}

function ToolRow({ tool, pending, onDecide }: { tool: AiTool; pending: boolean; onDecide: (tool: AiTool, status: "approved" | "blocked", remark: string) => void }) {
  const [remark, setRemark] = useState("");
  return <tr><td className="px-4 py-3 font-medium text-slate-800">{tool.host}{tool.catalog === "other" && <span className="ml-2 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Unlisted</span>}</td><td className="px-4 py-3 text-slate-600">{tool.tier}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 text-xs font-semibold ${tool.status === "approved" ? "bg-emerald-100 text-emerald-700" : tool.status === "blocked" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{tool.status}</span></td><td className="px-4 py-3 text-slate-600">{formatDate(tool.first_seen)}</td><td className="px-4 py-3">{tool.usage_count + tool.visit_count}</td><td className="px-4 py-3"><div className="flex gap-2"><input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remark" className="w-28 rounded border border-slate-300 px-2 py-1 text-xs" /><button disabled={pending || tool.status === "approved"} onClick={() => onDecide(tool, "approved", remark)} className="rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-40">Approve</button><button disabled={pending || tool.status === "blocked"} onClick={() => onDecide(tool, "blocked", remark)} className="rounded bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-40">Block</button></div></td></tr>;
}

function ToolsPanel({ tools }: { tools: ReturnType<typeof useToolsQuery> }) {
  const [toolSearch, setToolSearch] = useState("");
  const [toolStatusFilter, setToolStatusFilter] = useState<"all" | ToolStatus>("all");
  const [pendingDecision, setPendingDecision] = useState<{ tool: AiTool; status: "approved" | "blocked"; remark: string } | null>(null);
  const mutation = useToolDecisionMutation();

  const allTools = tools.data ?? [];
  const visibleTools = allTools.filter((tool) =>
    tool.host.toLowerCase().includes(toolSearch.toLowerCase()) &&
    (toolStatusFilter === "all" || tool.status === toolStatusFilter),
  );

  function handleDecide(tool: AiTool, status: "approved" | "blocked", remark: string) {
    if (isShadowHost(tool.host)) {
      setPendingDecision({ tool, status, remark });
    } else {
      mutation.mutate({ host: tool.host, body: { status, remark } });
    }
  }

  return <section>
    <h2 className="mb-1 text-xl font-bold">AI Tools</h2>
    <p className="mb-4 text-sm text-slate-500">Every host the gateway has seen, including unapproved shadow AI.</p>
    <ToolsSummarySection tools={visibleTools} />
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-bold text-slate-700">Hosts <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">{visibleTools.length}</span></h3>
      <div className="flex gap-2">
        <input value={toolSearch} onChange={(e) => setToolSearch(e.target.value)} placeholder="Search host..." className="w-48 rounded-md border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-500" />
        <select value={toolStatusFilter} onChange={(e) => setToolStatusFilter(e.target.value as "all" | ToolStatus)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
          {TOOL_STATUS_FILTERS.map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : status}</option>)}
        </select>
      </div>
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-[760px] w-full divide-y divide-slate-100 text-sm">
        <thead className="bg-slate-50"><tr>{["Host", "Tier", "Status", "First seen", "Usage", "Decision"].map((title) => <th key={title} className="px-4 py-3 text-left text-xs font-bold text-slate-600">{title}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {tools.isLoading && <SkeletonRows rows={4} columns={6} />}
          {!tools.isLoading && visibleTools.map((tool) => <ToolRow key={tool.host} tool={tool} pending={mutation.isPending} onDecide={handleDecide} />)}
        </tbody>
      </table>
      {tools.isError && <ErrorState message={(tools.error as Error).message} />}
      {!tools.isLoading && !tools.isError && visibleTools.length === 0 && <EmptyState title="No AI tools match this filter" />}
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
  </section>;
}

export default function PolicyAndTools({ section = "rules" }: { section?: PolicyToolsSection }) {
  const rules = useRulesQuery();
  const redactionClasses = useRedactionClassesQuery();
  const patterns = usePatternsQuery();
  const tools = useToolsQuery();
  return <div className="space-y-6 px-5 py-6 lg:px-7">
    {section === "documents" && <InternalDocsPanel />}
    {section === "rules" && <RulesPanel rules={rules} />}
    {section === "redaction" && <RedactionPanel classes={redactionClasses} patterns={patterns} />}
    {section === "tools" && <ToolsPanel tools={tools} />}
  </div>;
}
