// M6  MSW mocks of /v1/logs, /v1/stats, /v1/rules, /v1/tools. This is what ships M6 before the backend does.
//
// Opt-in only (VITE_USE_MSW=true) -- this is the offline path, not the
// default. Kept honest: real filtering, real pagination, real optimistic
// writes against an in-memory list, the same shapes IF-7/IF-10 promise. A
// mock that lies about the contract is worse than no mock.

import { http, HttpResponse } from "msw";

import type { AiTool, AuditRecord, RuleRow, StatsSummary } from "../api/types";

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
    approved_by: "admin@acme.my", approved_at: iso(-30), first_seen: iso(-60), usage_count: 10,
  },
  {
    host: "gemini.google.com", tier: "PUBLIC_AI", status: "approved",
    approved_by: "admin@acme.my", approved_at: iso(-30), first_seen: iso(-60), usage_count: 8,
  },
  {
    host: "copilot.microsoft.com", tier: "PUBLIC_AI", status: "unapproved",
    approved_by: null, approved_at: null, first_seen: iso(-10), usage_count: 4,
  },
];

const rules: RuleRow[] = [
  { data_class: "MYKAD", ai_tool_tier: "PUBLIC_AI", user_role: "*", purpose: "*", decision: "redact" },
  { data_class: "MYKAD", ai_tool_tier: "INTERNAL_AI", user_role: "*", purpose: "*", decision: "allow" },
  { data_class: "SECRET", ai_tool_tier: "PUBLIC_AI", user_role: "*", purpose: "*", decision: "deny" },
  { data_class: "SALARY", ai_tool_tier: "PUBLIC_AI", user_role: "*", purpose: "*", decision: "hold" },
  { data_class: "SALARY", ai_tool_tier: "ENTERPRISE_AI", user_role: "hr", purpose: "*", decision: "allow" },
  { data_class: "BANK_ACCT", ai_tool_tier: "PUBLIC_AI", user_role: "*", purpose: "*", decision: "redact" },
  { data_class: "DEPT_CONFIDENTIAL", ai_tool_tier: "PUBLIC_AI", user_role: "*", purpose: "*", decision: "hold" },
];

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
    data_classes: ["SECRET"], prompt_text: "Debug this: OPENAI_API_KEY=sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d",
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

  http.get(`${BASE}/v1/health`, () => HttpResponse.json({ status: "ok", mocked: [] })),
];
