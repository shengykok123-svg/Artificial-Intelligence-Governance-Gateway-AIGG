// M6  MSW mocks of /v1/logs, /v1/stats, /v1/rules, /v1/tools. This is what ships M6 before the backend does.
//
// Opt-in only (VITE_USE_MSW=true) -- this is the offline path, not the
// default. Kept honest: real filtering, real pagination, real optimistic
// writes against an in-memory list, the same shapes IF-7/IF-10 promise. A
// mock that lies about the contract is worse than no mock.

import { http, HttpResponse } from "msw";

import type { AiTool, AuditRecord, DetectionPattern, InternalDocChunk, RedactionClass, RuleRequest, RuleRow, StatsSummary } from "../api/types";

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

function iso(daysOffset: number, hoursOffset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(d.getHours() + hoursOffset);
  return d.toISOString();
}

const tools: AiTool[] = [
  {
    host: "chatgpt.com", tier: "PUBLIC_AI", status: "approved",
    approved_by: "admin@acme.my", approved_at: iso(-30), first_seen: iso(-60),
    usage_count: 10, visit_count: 0, catalog: "known",
  },
  {
    host: "gemini.google.com", tier: "PUBLIC_AI", status: "approved",
    approved_by: "admin@acme.my", approved_at: iso(-30), first_seen: iso(-60),
    usage_count: 8, visit_count: 0, catalog: "known",
  },
  {
    host: "copilot.microsoft.com", tier: "PUBLIC_AI", status: "unapproved",
    approved_by: null, approved_at: null, first_seen: iso(-10),
    usage_count: 4, visit_count: 0, catalog: "known",
  },
  {
    host: "perplexity.ai", tier: "PUBLIC_AI", status: "unapproved",
    approved_by: null, approved_at: null, first_seen: iso(-5),
    usage_count: 0, visit_count: 14, catalog: "known",
  },
  {
    host: "poe.com", tier: "PUBLIC_AI", status: "unapproved",
    approved_by: null, approved_at: null, first_seen: iso(-2),
    usage_count: 0, visit_count: 3, catalog: "known",
  },
  {
    host: "internal-llm.acme.my", tier: "PUBLIC_AI", status: "unapproved",
    approved_by: null, approved_at: null, first_seen: iso(-1),
    usage_count: 0, visit_count: 0, catalog: "other",
  },
];

const rules: RuleRow[] = [
  { id: 1, data_class: "MYKAD", ai_tool_tier: "*", user_role: "*", purpose: "*", decision: "redact", min_confidence: 0, content_department: "*", require_purpose: false, detector: "*" },
  { id: 2, data_class: "API_KEY", ai_tool_tier: "PUBLIC_AI", user_role: "*", purpose: "*", decision: "deny", min_confidence: 0, content_department: "*", require_purpose: false, detector: "*" },
  { id: 3, data_class: "SALARY", ai_tool_tier: "*", user_role: "*", purpose: "*", decision: "redact", min_confidence: 0, content_department: "*", require_purpose: false, detector: "*" },
  { id: 4, data_class: "BANK_ACCT", ai_tool_tier: "*", user_role: "*", purpose: "*", decision: "redact", min_confidence: 0, content_department: "*", require_purpose: false, detector: "*" },
  { id: 5, data_class: "DEPT_CONFIDENTIAL", ai_tool_tier: "PUBLIC_AI", user_role: "*", purpose: "*", decision: "hold", min_confidence: 0.85, content_department: "*", require_purpose: true, detector: "embed" },
  { id: 6, data_class: "DEPT_CONFIDENTIAL", ai_tool_tier: "PUBLIC_AI", user_role: "*", purpose: "*", decision: "deny", min_confidence: 0.92, content_department: "*", require_purpose: false, detector: "embed" },
  { id: 7, data_class: "DEPT_CONFIDENTIAL", ai_tool_tier: "PUBLIC_AI", user_role: "*", purpose: "*", decision: "hold", min_confidence: 0.90, content_department: "*", require_purpose: true, detector: "deberta" },
];
let nextRuleId = 8;

const redactionClasses: RedactionClass[] = [
  { id: 1, data_class: "MYKAD" },
  { id: 2, data_class: "EMAIL" },
  { id: 3, data_class: "PHONE" },
  { id: 4, data_class: "BANK_ACCT" },
  { id: 5, data_class: "SALARY" },
  { id: 6, data_class: "API_KEY" },
  { id: 7, data_class: "PERSON" },
];
let nextRedactionId = 8;

function displayId(dataClass: string, sequence: number): string {
  return `${dataClass}-${String(sequence).padStart(5, "0")}`;
}

const patterns: DetectionPattern[] = [
  { id: 1, data_class: "MYKAD", pattern: "\\b\\d{6}-\\d{2}-\\d{4}\\b", remark: "Malaysian IC number, format YYMMDD-PB-XXXX.", sequence: 1, display_id: displayId("MYKAD", 1) },
  { id: 2, data_class: "EMAIL", pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b", remark: "Standard email address shape.", sequence: 1, display_id: displayId("EMAIL", 1) },
  { id: 3, data_class: "PHONE", pattern: "\\b01\\d[-\\s]?\\d{7,8}\\b", remark: "Malaysian mobile number, format 01X-XXXXXXX(X).", sequence: 1, display_id: displayId("PHONE", 1) },
  { id: 4, data_class: "BANK_ACCT", pattern: "(?i)\\b(?:account|acct|a/c)\\s*(?:no\\.?|number)?\\s*(?:is\\s+)?[:#-]?\\s*\\d(?:[\\d -]{6,22})\\d\\b", remark: "'Account/acct/a-c' followed by a 7-24 digit account number.", sequence: 1, display_id: displayId("BANK_ACCT", 1) },
  { id: 5, data_class: "SALARY", pattern: "(?i)\\bRM\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?\\b", remark: "RM currency amount, e.g. RM 8,500 or RM8500.00.", sequence: 1, display_id: displayId("SALARY", 1) },
  { id: 6, data_class: "API_KEY", pattern: "\\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\\b", remark: "OpenAI/Anthropic-style API key shape (sk-... or sk-proj-...).", sequence: 1, display_id: displayId("API_KEY", 1) },
  { id: 7, data_class: "API_KEY", pattern: "\\b(?:OPENAI|ANTHROPIC|AWS)_API_KEY\\s*=\\s*[A-Za-z0-9_./+=-]{16,}\\b", remark: "Cloud provider API key set via an env-style assignment, e.g. OPENAI_API_KEY=....", sequence: 2, display_id: displayId("API_KEY", 2) },
  { id: 8, data_class: "PERSON", pattern: "\\b(?:Encik|Puan|Mr|Mrs|Ms|Dr)\\.?\\s+[A-Z][A-Za-z'-]*(?:\\s+[A-Z][A-Za-z'-]*){0,2}\\b", remark: "Honorific (Encik/Puan/Mr/Mrs/Ms/Dr) followed by a 1-3 word name.", sequence: 1, display_id: displayId("PERSON", 1) },
];
let nextPatternId = 9;

function nextSequenceFor(dataClass: string): number {
  const existing = patterns.filter((p) => p.data_class === dataClass).map((p) => p.sequence);
  return Math.max(0, ...existing) + 1;
}

const internalDocs: InternalDocChunk[] = [];

let seq = 0;
function row(partial: Partial<AuditRecord> & Pick<AuditRecord, "decision">): AuditRecord {
  seq += 1;
  return {
    log_id: `mock-${seq}`,
    user_id: "wei.eng@acme.my",
    ts: iso(0),
    target_host: "chatgpt.com",
    prompt_text: "example prompt",
    filename: null,
    data_classes: [],
    reason: "No sensitive data class detected.",
    status: partial.decision === "hold" ? "pending" : "auto",
    reviewer: null,
    reviewed_at: null,
    remark: null,
    map_id: null,
    user_department: null,
    content_department: null,
    department_confidence: 0,
    purpose: "GENERAL",
    justification: null,
    m8_department: null,
    m8_confidence: 0,
    m9_department: null,
    m9_confidence: 0,
    m9_sensitivity_confidence: 0,
    cross_department_confidence: null,
    ...partial,
  };
}

const logs: AuditRecord[] = [
  row({
    decision: "allow", user_id: "wei.eng@acme.my", user_department: "engineering",
    prompt_text: "Turn this into bullet points for the standup.", ts: iso(0, -1),
  }),
  row({
    decision: "deny", user_id: "wei.eng@acme.my", user_department: "engineering",
    data_classes: ["API_KEY"], prompt_text: "Debug this: OPENAI_API_KEY=sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d",
    reason: "Credential detected. Prompt blocked at the browser.", ts: iso(0, -2),
  }),
  row({
    decision: "redact", user_id: "aiman.hr@acme.my", user_department: "hr",
    data_classes: ["MYKAD", "PERSON"], map_id: "mock-map-1",
    prompt_text: "Summarise this employee grievance from Encik Rahman, IC [MYKAD_1].",
    reason: "MYKAD to a public AI tool: values tokenised before send.",
    content_department: "hr", department_confidence: 0.81, ts: iso(-1),
  }),
  row({
    decision: "hold", user_id: "aiman.hr@acme.my", user_department: "hr",
    data_classes: ["SALARY"],
    prompt_text: "Draft a reply to the payroll query. Gaji bulanan RM 8,500 for grade M3.",
    reason: "SALARY to a public AI tool: awaiting compliance review.",
    content_department: "hr", department_confidence: 0.7, ts: iso(-1, -3),
  }),
  // Cross-department: engineer pasting finance content.
  row({
    decision: "hold", user_id: "wei.eng@acme.my", user_department: "engineering",
    data_classes: ["DEPT_CONFIDENTIAL"],
    prompt_text: "Our Q3 revenue dipped 40% against forecast, help me explain it.",
    reason: "Department-confidential content: awaiting compliance review.",
    content_department: "finance", department_confidence: 0.89, ts: iso(-2),
  }),
  // Cross-department: finance staff pasting an HR letter.
  row({
    decision: "redact", user_id: "siti.finance@acme.my", user_department: "finance",
    data_classes: ["PERSON", "PHONE"], filename: "draft_letter.docx", map_id: "mock-map-2",
    prompt_text: "Draft the termination letter for Puan Nurul, contact [PHONE_1].",
    reason: "Personal data to a public AI tool: values tokenised before send.",
    content_department: "hr", department_confidence: 0.91, ts: iso(-3),
  }),
  row({
    decision: "redact", user_id: "siti.finance@acme.my", user_department: "finance",
    data_classes: ["BANK_ACCT"], filename: "vendor_payments_q2.xlsx", map_id: "mock-map-3",
    prompt_text: "Reconcile these vendor payments, Maybank account [BANK_ACCT_1].",
    reason: "BANK_ACCT to a public AI tool: values tokenised before send.",
    content_department: "finance", department_confidence: 0.74, ts: iso(-4),
  }),
  // At the 0.6 boundary -- deliberately not badged, per the contract.
  row({
    decision: "allow", user_id: "wei.eng@acme.my", user_department: "engineering",
    prompt_text: "Check my grammar on this internal announcement.",
    content_department: "finance", department_confidence: 0.6, ts: iso(-4, -1),
  }),
  row({
    decision: "allow", user_id: "wei.eng@acme.my", user_department: "engineering",
    prompt_text: "Turn this into bullet points for the standup.", ts: iso(-5),
  }),
];

function isCrossDepartment(r: AuditRecord): boolean {
  return (
    r.content_department !== null &&
    r.user_department !== null &&
    r.content_department !== r.user_department &&
    r.department_confidence > 0.6
  );
}

export const handlers = [
  http.get(`${BASE}/v1/logs`, ({ request }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const decision = url.searchParams.get("decision");
    const crossOnly = url.searchParams.get("cross_department_only") === "true";
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const offset = Number(url.searchParams.get("offset") ?? 0);

    let filtered = [...logs].sort((a, b) => b.ts.localeCompare(a.ts));
    if (status) filtered = filtered.filter((r) => r.status === status);
    if (decision) filtered = filtered.filter((r) => r.decision === decision);
    if (crossOnly) filtered = filtered.filter(isCrossDepartment);

    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);
    return HttpResponse.json({ items, total, limit, offset });
  }),

  http.post(`${BASE}/v1/logs/:logId/decision`, async ({ params, request }) => {
    const body = (await request.json()) as { approve: boolean; remark: string };
    const rec = logs.find((r) => r.log_id === params.logId);
    if (!rec) return new HttpResponse(null, { status: 404 });
    rec.status = body.approve ? "approved" : "denied";
    rec.reviewer = "admin@acme.my";
    rec.reviewed_at = new Date().toISOString();
    rec.remark = body.remark;
    return HttpResponse.json(rec);
  }),

  http.get(`${BASE}/v1/stats`, () => {
    const by_decision: Record<string, number> = {};
    for (const r of logs) by_decision[r.decision] = (by_decision[r.decision] ?? 0) + 1;

    const dayDecisionCounts = new Map<string, number>();
    for (const r of logs) {
      const key = `${r.ts.slice(0, 10)}|${r.decision}`;
      dayDecisionCounts.set(key, (dayDecisionCounts.get(key) ?? 0) + 1);
    }
    const by_day = Array.from(dayDecisionCounts.entries())
      .map(([key, count]): [string, string, number] => {
        const [date, decision] = key.split("|");
        return [date, decision, count];
      })
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

    const classCounts = new Map<string, number>();
    for (const r of logs) {
      for (const dc of new Set(r.data_classes)) classCounts.set(dc, (classCounts.get(dc) ?? 0) + 1);
    }
    const top_data_classes = Array.from(classCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10) as [string, number][];

    const userCounts = new Map<string, number>();
    for (const r of logs) {
      if (r.decision !== "allow") userCounts.set(r.user_id, (userCounts.get(r.user_id) ?? 0) + 1);
    }
    const top_users = Array.from(userCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10) as [string, number][];

    const summary: StatsSummary = { by_decision, by_day, top_data_classes, top_users };
    return HttpResponse.json(summary);
  }),

  http.get(`${BASE}/v1/rules`, () => HttpResponse.json(rules)),

  http.post(`${BASE}/v1/rules`, async ({ request }) => {
    const body = (await request.json()) as RuleRequest;
    const created: RuleRow = { id: nextRuleId++, ...body };
    rules.push(created);
    return HttpResponse.json(created);
  }),

  http.put(`${BASE}/v1/rules/:ruleId`, async ({ params, request }) => {
    const body = (await request.json()) as RuleRequest;
    const idx = rules.findIndex((r) => r.id === Number(params.ruleId));
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    rules[idx] = { id: rules[idx].id, ...body };
    return HttpResponse.json(rules[idx]);
  }),

  http.delete(`${BASE}/v1/rules/:ruleId`, ({ params }) => {
    const idx = rules.findIndex((r) => r.id === Number(params.ruleId));
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    rules.splice(idx, 1);
    return HttpResponse.json({ deleted: true });
  }),

  http.get(`${BASE}/v1/redaction`, () => HttpResponse.json(redactionClasses)),

  http.post(`${BASE}/v1/redaction`, async ({ request }) => {
    const body = (await request.json()) as { data_class: string };
    const existing = redactionClasses.find((r) => r.data_class === body.data_class);
    if (existing) return HttpResponse.json(existing);
    const created: RedactionClass = { id: nextRedactionId++, data_class: body.data_class };
    redactionClasses.push(created);
    return HttpResponse.json(created);
  }),

  http.delete(`${BASE}/v1/redaction/:rowId`, ({ params }) => {
    const idx = redactionClasses.findIndex((r) => r.id === Number(params.rowId));
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    redactionClasses.splice(idx, 1);
    return HttpResponse.json({ deleted: true });
  }),

  http.get(`${BASE}/v1/patterns`, () => HttpResponse.json(patterns)),

  http.post(`${BASE}/v1/patterns`, async ({ request }) => {
    const body = (await request.json()) as { data_class: string; pattern: string; remark?: string };
    // Client-side compile check standing in for backend validation -- mock
    // realism only, not a security boundary (the real ReDoS protection is
    // server-side, see backend/app/detect/rules.py).
    try {
      new RegExp(body.pattern);
    } catch {
      return HttpResponse.json({ detail: "invalid regex" }, { status: 422 });
    }
    const sequence = nextSequenceFor(body.data_class);
    const created: DetectionPattern = { id: nextPatternId++, data_class: body.data_class, pattern: body.pattern, remark: body.remark ?? "", sequence, display_id: displayId(body.data_class, sequence) };
    patterns.push(created);
    if (!redactionClasses.some((r) => r.data_class === body.data_class)) {
      redactionClasses.push({ id: nextRedactionId++, data_class: body.data_class });
    }
    return HttpResponse.json(created);
  }),

  http.put(`${BASE}/v1/patterns/:patternId`, async ({ params, request }) => {
    const body = (await request.json()) as { data_class: string; pattern: string; remark?: string };
    try {
      new RegExp(body.pattern);
    } catch {
      return HttpResponse.json({ detail: "invalid regex" }, { status: 422 });
    }
    const idx = patterns.findIndex((p) => p.id === Number(params.patternId));
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const current = patterns[idx];
    const sequence = body.data_class === current.data_class ? current.sequence : nextSequenceFor(body.data_class);
    patterns[idx] = { id: current.id, data_class: body.data_class, pattern: body.pattern, remark: body.remark ?? "", sequence, display_id: displayId(body.data_class, sequence) };
    return HttpResponse.json(patterns[idx]);
  }),

  http.delete(`${BASE}/v1/patterns/:patternId`, ({ params }) => {
    const idx = patterns.findIndex((p) => p.id === Number(params.patternId));
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    patterns.splice(idx, 1);
    return HttpResponse.json({ deleted: true });
  }),

  http.get(`${BASE}/v1/tools`, () => {
    const sorted = [...tools].sort((a, b) => {
      const rank = (t: AiTool) => (t.status === "approved" ? 1 : 0);
      return rank(a) - rank(b) || a.host.localeCompare(b.host);
    });
    return HttpResponse.json(sorted);
  }),

  http.post(`${BASE}/v1/tools/:host/decision`, async ({ params, request }) => {
    const body = (await request.json()) as { status: "approved" | "blocked"; remark: string };
    const tool = tools.find((t) => t.host === params.host);
    if (!tool) return new HttpResponse(null, { status: 404 });
    tool.status = body.status;
    tool.approved_by = "admin@acme.my";
    tool.approved_at = new Date().toISOString();
    return HttpResponse.json(tool);
  }),

  http.get(`${BASE}/v1/internal-docs`, ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const items = internalDocs.slice(offset, offset + limit);
    return HttpResponse.json({ items, total: internalDocs.length, limit, offset });
  }),

  http.post(`${BASE}/v1/internal-docs`, async ({ request }) => {
    const body = (await request.json()) as {
      department: string;
      attachment: { filename: string; content_b64: string };
      replace_source?: boolean;
    };
    if (body.replace_source !== false) {
      for (let i = internalDocs.length - 1; i >= 0; i -= 1) {
        if (internalDocs[i].source_file === body.attachment.filename) internalDocs.splice(i, 1);
      }
    }
    const chunk: InternalDocChunk = {
      id: `mock-internal-${internalDocs.length + 1}`,
      source_file: body.attachment.filename,
      department: body.department,
      chunk_text: atob(body.attachment.content_b64).slice(0, 900),
      created_at: new Date().toISOString(),
    };
    internalDocs.unshift(chunk);
    return HttpResponse.json({
      source_file: body.attachment.filename,
      department: body.department,
      chunk_count: 1,
      total: internalDocs.length,
    });
  }),

  http.get(`${BASE}/v1/health`, () => HttpResponse.json({ status: "ok", mocked: [] })),
];
