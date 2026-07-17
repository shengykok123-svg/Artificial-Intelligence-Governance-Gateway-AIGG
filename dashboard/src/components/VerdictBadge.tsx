// M6  allow=green redact=amber hold=amber deny=red. ALWAYS pair colour with a text label; never colour alone.
//
// VERDICT_COLORS is exported and imported by Overview.tsx so the stacked
// bar chart uses the exact same hex values as this badge -- one palette,
// one meaning, defined once.

import type { Decision, LogStatus } from "../api/types";

export const VERDICT_LABEL: Record<Decision, string> = {
  allow: "Allow",
  redact: "Redact",
  hold: "Hold",
  deny: "Deny",
};

// redact and hold intentionally share the same amber -- that is exactly why
// every badge below carries a text label and never colour alone.
export const VERDICT_COLORS: Record<Decision, { bg: string; text: string; dot: string }> = {
  allow: { bg: "#dcfce7", text: "#166534", dot: "#16a34a" },
  redact: { bg: "#fef3c7", text: "#92400e", dot: "#d97706" },
  hold: { bg: "#fef3c7", text: "#92400e", dot: "#d97706" },
  deny: { bg: "#fee2e2", text: "#991b1b", dot: "#dc2626" },
};

export function VerdictBadge({ decision }: { decision: Decision }) {
  const c = VERDICT_COLORS[decision];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.dot }} aria-hidden="true" />
      {VERDICT_LABEL[decision]}
    </span>
  );
}

export const STATUS_LABEL: Record<LogStatus, string> = {
  auto: "Auto",
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
};

const STATUS_COLORS: Record<LogStatus, { bg: string; text: string }> = {
  auto: { bg: "#f3f4f6", text: "#374151" },
  pending: { bg: "#fef3c7", text: "#92400e" },
  approved: { bg: "#dcfce7", text: "#166534" },
  denied: { bg: "#fee2e2", text: "#991b1b" },
};

export function StatusBadge({ status }: { status: LogStatus }) {
  const c = STATUS_COLORS[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-sm font-medium"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
