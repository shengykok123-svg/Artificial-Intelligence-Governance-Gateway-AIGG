// M4  IF-1/IF-2/IF-3 message + wire types. Mirror of backend/app/schemas.py.

export type Decision = "allow" | "redact" | "hold" | "deny";
export type LogStatus = "auto" | "pending" | "approved" | "denied";

export interface AttachmentPayload {
  filename: string;
  mime: string;
  content_b64: string;
}

export type RedactedAttachmentPayload = AttachmentPayload;

// -- IF-1  Content script -> Service worker --------------------------------

export interface InspectMessage {
  type: "INSPECT";
  prompt: string;
  files: AttachmentPayload[];
  targetHost: string;
}

export interface CheckHoldStatusMessage {
  type: "CHECK_HOLD_STATUS";
  log_id: string;
}

// Service worker -> content script, sent once a hold resolves (approved,
// denied, or the 5-minute poll window ran out). Not part of IF-1/IF-2/IF-3
// on the wire; a background-owned message so the long poll never has to hold
// the original sendMessage response channel open.
export interface HoldResolvedMessage {
  type: "HOLD_RESOLVED";
  log_id: string;
  status: LogStatus; // "pending" here means the poll window timed out
}

export type ExtensionMessage = InspectMessage | CheckHoldStatusMessage;
export type BackgroundMessage = HoldResolvedMessage;

// -- IF-2  Service worker -> API   POST /v1/inspect -------------------------

export interface InspectRequest {
  user_id: string;
  target_host: string;
  prompt: string;
  purpose: string;
  attachments: AttachmentPayload[];
}

export interface InspectResponse {
  decision: Decision;
  log_id: string;
  data_classes: string[];
  redacted_prompt: string | null; // populated only when decision == "redact"
  redacted_attachments: RedactedAttachmentPayload[];
  reason: string;
  // Additive M9 explainability metadata; it does not alter the policy verdict.
  content_department: string | null;
  department_confidence: number;
  debug: {
    policy_layer: string;
    semantic_detector: string;
    detections: Array<{
      data_class: string;
      detector: string;
      confidence: number;
      source: "prompt" | "attachment";
    }>;
  };
}

// -- IF-3  Service worker -> API   GET /v1/inspect/{log_id} -----------------

export interface InspectStatusResponse {
  decision: Decision;
  status: LogStatus;
}

// -- Response the background sends back for IF-1 ----------------------------

export type InspectOutcome =
  | { ok: true; result: InspectResponse }
  | {
      ok: false;
      reason: "unreachable" | "unconfigured" | "unsupported_file";
      message: string;
    };
