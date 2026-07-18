// M4  MOCK_MODE: cycles all four verdicts with no backend. This is what lets M4 finish before M1 exists.
//
// Default OFF (see popup.ts / background.ts). Not the dev path and not the
// integration proof -- the real API is live and that is what M4 is built
// and demoed against. This exists purely for UI work with the backend
// stopped.

import type { Decision, InspectResponse } from "./types";

const CYCLE_KEY = "mockCycleIndex";

const CYCLE: Array<Pick<InspectResponse, "decision" | "data_classes" | "reason">> = [
  { decision: "allow", data_classes: [], reason: "No sensitive data class detected. (MOCK_MODE)" },
  { decision: "redact", data_classes: ["MYKAD"], reason: "MYKAD detected. (MOCK_MODE)" },
  { decision: "hold", data_classes: ["SALARY"], reason: "SALARY detected. (MOCK_MODE)" },
  { decision: "deny", data_classes: ["SECRET"], reason: "SECRET detected. (MOCK_MODE)" },
];

export async function nextMockOutcome(prompt: string): Promise<InspectResponse> {
  const stored = await chrome.storage.local.get(CYCLE_KEY);
  const index = (stored[CYCLE_KEY] ?? 0) % CYCLE.length;
  await chrome.storage.local.set({ [CYCLE_KEY]: index + 1 });

  const step = CYCLE[index];
  return {
    decision: step.decision as Decision,
    log_id: `mock-${Date.now()}`,
    data_classes: step.data_classes,
    redacted_prompt: step.decision === "redact" ? `[MOCK_REDACTED] ${prompt}` : null,
    redacted_attachments: [],
    reason: step.reason,
  };
}

// There is no backend to poll in MOCK_MODE. Auto-resolve to "approved" after
// a short delay so the offline demo still shows the full hold -> approve ->
// unblock loop instead of hanging for 5 minutes.
export function mockPollUntilResolved(): Promise<"approved"> {
  return new Promise((resolve) => setTimeout(() => resolve("approved"), 3000));
}
