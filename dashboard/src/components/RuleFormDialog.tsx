// Create/edit form for a policy rule -- a modal, not an inline row/card, so
// the same 8-field form can open prefilled for any of N existing rows or
// empty for a new one, without duplicating local state per table row.
// Chrome/buttons match ConfirmDialog.tsx exactly.

import { useEffect, useState } from "react";

import { DECISIONS, DEPARTMENTS } from "../constants";
import type { Decision, RuleRequest, RuleRow } from "../api/types";

const AI_TOOL_TIERS = ["*", "PUBLIC_AI", "ENTERPRISE_AI", "INTERNAL_AI"];
const DETECTORS = ["*", "embed", "deberta"];
const CONTENT_DEPARTMENTS = ["*", "@cross", ...DEPARTMENTS];

const EMPTY: RuleRequest = {
  data_class: "",
  ai_tool_tier: "PUBLIC_AI",
  user_role: "*",
  purpose: "*",
  decision: "hold",
  min_confidence: 0,
  content_department: "*",
  require_purpose: false,
  detector: "*",
};

export interface RuleFormDialogProps {
  open: boolean;
  initial: RuleRow | null; // null = create; non-null = edit, prefilled
  onSubmit: (body: RuleRequest) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}

export function RuleFormDialog({ open, initial, onSubmit, onCancel, pending, error }: RuleFormDialogProps) {
  const [form, setForm] = useState<RuleRequest>(EMPTY);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? { ...initial } : EMPTY);
  }, [open, initial]);

  if (!open) return null;

  function set<K extends keyof RuleRequest>(key: K, value: RuleRequest[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h3 className="text-lg font-bold text-slate-900">{initial ? `Edit rule` : "Add rule"}</h3>
        <p className="mt-1 text-xs text-slate-500">
          This changes live allow/redact/hold/deny decisions immediately -- no restart, no redeploy.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(form);
          }}
          className="mt-4 grid grid-cols-2 gap-3"
        >
          <label className="col-span-2 text-xs font-semibold text-slate-700">
            Data class
            <input
              value={form.data_class}
              onChange={(e) => set("data_class", e.target.value)}
              placeholder="e.g. DEPT_CONFIDENTIAL, SALARY, API_KEY..."
              required
              className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-600"
            />
          </label>

          <label className="text-xs font-semibold text-slate-700">
            AI tool tier
            <select value={form.ai_tool_tier} onChange={(e) => set("ai_tool_tier", e.target.value)} className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {AI_TOOL_TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
            </select>
          </label>

          <label className="text-xs font-semibold text-slate-700">
            Detector
            <select value={form.detector} onChange={(e) => set("detector", e.target.value)} className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {DETECTORS.map((detector) => <option key={detector} value={detector}>{detector === "*" ? "* (any)" : detector === "embed" ? "embed (M8)" : "deberta (M9)"}</option>)}
            </select>
          </label>

          <label className="text-xs font-semibold text-slate-700">
            User role
            <input value={form.user_role} onChange={(e) => set("user_role", e.target.value)} className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </label>

          <label className="text-xs font-semibold text-slate-700">
            Purpose
            <input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
          </label>

          <label className="text-xs font-semibold text-slate-700">
            Min. confidence (0-1)
            <input
              type="number" min={0} max={1} step={0.01}
              value={form.min_confidence}
              onChange={(e) => set("min_confidence", Number(e.target.value))}
              className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-xs font-semibold text-slate-700">
            Decision
            <select value={form.decision} onChange={(e) => set("decision", e.target.value as Decision)} className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {DECISIONS.map((decision) => <option key={decision} value={decision}>{decision}</option>)}
            </select>
          </label>

          <label className="col-span-2 text-xs font-semibold text-slate-700">
            Content department
            <select value={form.content_department} onChange={(e) => set("content_department", e.target.value)} className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              {CONTENT_DEPARTMENTS.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
            </select>
            <span className="mt-1 block text-[11px] font-normal text-slate-500">
              "*" matches any department. "@cross" matches only when the detected content department
              differs from the requester's own department -- this is what turns on cross-department escalation.
              A literal department matches only that exact department.
            </span>
          </label>

          <label className="col-span-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={form.require_purpose} onChange={(e) => set("require_purpose", e.target.checked)} />
            Require purpose ("state &amp; allow")
          </label>

          {error && <p className="col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

          <div className="col-span-2 mt-2 flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
              {pending ? "Saving..." : initial ? "Save changes" : "Add rule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
