import { useMemo, useRef, useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";

import { useInternalDocsQuery, useInternalDocUploadMutation, useRulesQuery, useToolDecisionMutation, useToolsQuery } from "../api/queries";
import type { AiTool, Decision, InternalDocChunk, ToolStatus } from "../api/types";
import { EmptyState, ErrorState, SkeletonRows } from "../components/EmptyState";
import { VerdictBadge } from "../components/VerdictBadge";

const DEPARTMENTS = ["engineering", "finance", "hr", "legal"];
const DECISIONS = ["allow", "redact", "hold", "deny"];
export type PolicyToolsSection = "rules" | "documents" | "tools";

interface DocGroup { sourceFile: string; department: string; chunks: InternalDocChunk[]; latestCreatedAt: string; }

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const groups = useMemo(() => sourceGroups(docs.data?.items ?? []), [docs.data?.items]);
  const visible = groups.filter((group) => group.sourceFile.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || group.department === filter));
  const selected = groups.find((group) => group.sourceFile === selectedId) ?? visible[0] ?? null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const content_b64 = await readFileAsBase64(file);
    upload.mutate({ department, replace_source: true, attachment: { filename: file.name, mime: file.type || "application/octet-stream", content_b64 } }, { onSuccess: (result) => { setSelectedId(result.source_file); setFile(null); if (input.current) input.current.value = ""; } });
  }

  return <section className="space-y-4">
    <div><h2 className="text-xl font-bold text-slate-900">Internal Document Corpus</h2><p className="mt-1 text-sm text-slate-500">Upload internal documents by department. The system extracts text, splits it into chunks and generates embeddings for M8 similarity detection.</p></div>
    <div className="internal-doc-layout gap-3">
      <main className="min-w-0 space-y-4">
        <form onSubmit={submit} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-[250px_170px_1fr] md:divide-x md:divide-y-0">
            <div className="p-4"><h3 className="text-sm font-bold text-slate-800">Upload New Document</h3><p className="mt-2 text-xs leading-5 text-slate-500">Add a source to the M8 corpus.</p></div>
            <label className="p-4 text-xs font-semibold text-slate-700">Department<select value={department} onChange={(e) => setDepartment(e.target.value)} className="mt-2 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600">{DEPARTMENTS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <div className="p-4"><input ref={input} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><button type="button" onClick={() => input.current?.click()} onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); setFile(e.dataTransfer.files?.[0] ?? null); }} className={`flex w-full items-center justify-center gap-3 rounded-lg border border-dashed p-4 text-left transition ${dragging ? "border-emerald-600 bg-emerald-50" : "border-slate-300 bg-slate-50 hover:border-emerald-500 hover:bg-emerald-50/40"}`}><span className="text-slate-500"><UploadCloudIcon /></span><span><span className="block text-sm font-medium text-slate-700">{file?.name ?? "Drag and drop a file here, or choose a file"}</span><span className="mt-1 block text-xs text-slate-500">Supported: PDF, DOCX, XLSX, PPTX, TXT</span></span></button><div className="mt-2 flex justify-end"><button type="submit" disabled={!file || upload.isPending} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{upload.isPending ? "Indexing..." : "Upload & index"}</button></div></div>
          </div>
        </form>
        {upload.data && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">Indexed {upload.data.chunk_count} chunks from {upload.data.source_file}</p>}
        {upload.isError && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{upload.error.message}</p>}
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">Info: Original files are not retained after indexing. Only extracted chunks and embeddings are stored.</p>
        <section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">Indexed Sources <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700">{groups.length}</span></h3><div className="flex gap-2"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search source file..." className="w-48 rounded-md border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-500" /><select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"><option value="all">All departments</option>{DEPARTMENTS.map((item) => <option key={item}>{item}</option>)}</select></div></div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="min-w-[680px] w-full divide-y divide-slate-100 text-sm"><thead className="bg-slate-50 text-left text-xs text-slate-600"><tr>{["Source File", "Department", "Chunks", "Latest Indexed", "Action"].map((title) => <th key={title} className="px-3 py-3 font-bold">{title}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{docs.isLoading && <SkeletonRows rows={5} columns={5} />}{!docs.isLoading && visible.map((group) => { const data = fileKind(group.sourceFile); const active = selected?.sourceFile === group.sourceFile; return <tr key={group.sourceFile} onClick={() => setSelectedId(group.sourceFile)} className={`cursor-pointer ${active ? "bg-emerald-50/70" : "hover:bg-emerald-50/40"}`}><td className="px-3 py-3 font-semibold text-slate-700"><span className={`mr-2 inline-flex h-6 w-7 items-center justify-center rounded text-[9px] font-bold ${data.tone}`}>{data.kind.slice(0, 3)}</span>{group.sourceFile}</td><td className="px-3 py-3"><DepartmentBadge value={group.department} /></td><td className="px-3 py-3">{group.chunks.length}</td><td className="px-3 py-3 text-xs text-slate-600">{formatDate(group.latestCreatedAt)}</td><td className="px-3 py-3"><button type="button" onClick={(e) => { e.stopPropagation(); setSelectedId(group.sourceFile); }} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">{active ? "Viewing Chunks" : "View Chunks"}</button></td></tr>; })}</tbody></table></div>{!docs.isLoading && docs.isError && <ErrorState message={(docs.error as Error).message} />}{!docs.isLoading && !docs.isError && visible.length === 0 && <EmptyState title="No indexed sources match this filter" />}</div><p className="mt-3 text-xs text-slate-500">Showing {visible.length} of {groups.length} sources</p></section>
      </main>
      <aside className="internal-doc-detail-pane min-w-0 rounded-xl border border-slate-200 bg-slate-50 shadow-sm">{!selected ? <div className="flex min-h-[500px] items-center justify-center p-8 text-center text-sm text-slate-500">Select an indexed source to view its extracted chunks.</div> : <SourceDetails key={selected.sourceFile} group={selected} close={() => setSelectedId(null)} />}</aside>
    </div>
  </section>;
}

function SourceDetails({ group, close }: { group: DocGroup; close: () => void }) {
  const file = fileKind(group.sourceFile);
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);
  return <div className="flex min-h-0 flex-col"><div className="border-b border-slate-200 bg-white p-5"><div className="flex justify-between"><h3 className="text-lg font-bold">Source Details</h3><button onClick={close} className="text-xl text-slate-500">x</button></div><div className="mt-5 flex items-center gap-3"><span className={`inline-flex h-8 w-8 items-center justify-center rounded text-xs font-bold ${file.tone}`}>{file.kind.slice(0, 3)}</span><span className="min-w-0 flex-1 break-all text-sm font-bold text-slate-700">{group.sourceFile}</span><DepartmentBadge value={group.department} /></div><dl className="mt-5 divide-y divide-slate-100 border-t border-slate-100 text-sm"><div className="flex justify-between py-2"><dt className="text-slate-500">Indexed at</dt><dd>{formatDate(group.latestCreatedAt)}</dd></div><div className="flex justify-between py-2"><dt className="text-slate-500">Chunks created</dt><dd>{group.chunks.length}</dd></div><div className="flex justify-between py-2"><dt className="text-slate-500">File size</dt><dd className="text-slate-500">Not retained</dd></div></dl></div><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"><div><h4 className="font-bold">Chunks ({group.chunks.length})</h4><p className="mt-1 text-xs leading-5 text-slate-500">Text chunks extracted from this source and used for M8 similarity detection. Select a chunk to expand it.</p></div>{group.chunks.map((chunk, index) => { const expanded = expandedChunk === chunk.id; return <article key={chunk.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white"><button type="button" onClick={() => setExpandedChunk(expanded ? null : chunk.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-slate-50"><span className="text-sm font-bold">Chunk {index + 1}</span><span className="flex items-center gap-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">{chunk.chunk_text.length} chars</span><span className="text-slate-500">{expanded ? "^" : "v"}</span></span></button>{expanded && <div className="border-t border-slate-100 px-3 pb-3"><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-700">{chunk.chunk_text}</p><p className="mt-3 text-[11px] text-slate-500">Created at {formatDate(chunk.created_at)}</p></div>}</article>; })}</div><div className="border-t border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-800">Info: Original files are not retained. Only text chunks and embeddings are stored.</div></div>;
}

function ToolRow({ tool }: { tool: AiTool }) {
  const [remark, setRemark] = useState("");
  const mutation = useToolDecisionMutation();
  return <tr><td className="px-4 py-3 font-medium text-slate-800">{tool.host}</td><td className="px-4 py-3 text-slate-600">{tool.tier}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 text-xs font-semibold ${tool.status === "approved" ? "bg-emerald-100 text-emerald-700" : tool.status === "blocked" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{tool.status}</span></td><td className="px-4 py-3 text-slate-600">{formatDate(tool.first_seen)}</td><td className="px-4 py-3">{tool.usage_count}</td><td className="px-4 py-3"><div className="flex gap-2"><input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Remark" className="w-28 rounded border border-slate-300 px-2 py-1 text-xs" /><button disabled={mutation.isPending || tool.status === "approved"} onClick={() => mutation.mutate({ host: tool.host, body: { status: "approved", remark } })} className="rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-40">Approve</button><button disabled={mutation.isPending || tool.status === "blocked"} onClick={() => mutation.mutate({ host: tool.host, body: { status: "blocked", remark } })} className="rounded bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-40">Block</button></div></td></tr>;
}

export default function PolicyAndTools({ section = "rules" }: { section?: PolicyToolsSection }) {
  const rules = useRulesQuery();
  const tools = useToolsQuery();
  return <div className="space-y-6 px-5 py-6 lg:px-7"><header><h1 className="text-3xl font-bold tracking-tight text-slate-950">Policy &amp; Tools</h1><p className="mt-1 text-sm text-slate-500">Review policy configuration, manage internal documents used by M8 similarity detection, and govern AI tools.</p></header><nav className="flex flex-wrap gap-1 border-b border-slate-200"><NavLink to="/policy" end className={({ isActive }) => `border-b-2 px-4 py-3 text-sm font-semibold ${isActive ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500"}`}>Policy Rules</NavLink><NavLink to="/policy/internal-documents" className={({ isActive }) => `border-b-2 px-4 py-3 text-sm font-semibold ${isActive ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500"}`}>Internal Documents</NavLink><NavLink to="/policy/ai-tools" className={({ isActive }) => `border-b-2 px-4 py-3 text-sm font-semibold ${isActive ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500"}`}>AI Tools</NavLink></nav>
    {section === "documents" && <InternalDocsPanel />}
    {section === "rules" && <section><h2 className="mb-1 text-xl font-bold">Policy Rules</h2><p className="mb-4 text-sm text-slate-500">Policy is visible configuration owned by the organisation.</p><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="min-w-full divide-y divide-slate-100 text-sm"><thead className="bg-slate-50"><tr>{["Data class", "AI tool tier", "User role", "Purpose", "Detector", "Verdict"].map((title) => <th key={title} className="px-4 py-3 text-left text-xs font-bold text-slate-600">{title}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rules.isLoading && <SkeletonRows rows={5} columns={6} />}{!rules.isLoading && rules.data?.map((rule, index) => <tr key={`${rule.data_class}-${index}`}><td className="px-4 py-3 font-medium">{rule.data_class}</td><td className="px-4 py-3">{rule.ai_tool_tier}</td><td className="px-4 py-3">{rule.user_role}</td><td className="px-4 py-3">{rule.purpose}</td><td className="px-4 py-3">{rule.detector}</td><td className="px-4 py-3">{DECISIONS.includes(rule.decision) ? <VerdictBadge decision={rule.decision as Decision} /> : rule.decision}</td></tr>)}</tbody></table>{rules.isError && <ErrorState message={(rules.error as Error).message} />}</div></section>}
    {section === "tools" && <section><h2 className="mb-1 text-xl font-bold">AI Tools</h2><p className="mb-4 text-sm text-slate-500">Every host the gateway has seen, including unapproved shadow AI.</p><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="min-w-[760px] w-full divide-y divide-slate-100 text-sm"><thead className="bg-slate-50"><tr>{["Host", "Tier", "Status", "First seen", "Usage", "Decision"].map((title) => <th key={title} className="px-4 py-3 text-left text-xs font-bold text-slate-600">{title}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{tools.isLoading && <SkeletonRows rows={4} columns={6} />}{!tools.isLoading && tools.data?.map((tool) => <ToolRow key={tool.host} tool={tool} />)}</tbody></table>{tools.isError && <ErrorState message={(tools.error as Error).message} />}</div></section>}
  </div>;
}
