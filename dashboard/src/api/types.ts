// M6  Wire types mirroring backend/app/schemas.py.

export type Decision = "allow" | "redact" | "hold" | "deny";
export type LogStatus = "auto" | "pending" | "approved" | "denied";

// The row shape everywhere the log is returned.
export interface AuditRecord {
  log_id: string;
  user_id: string;
  ts: string; // ISO 8601, UTC
  target_host: string;
  prompt_text: string; // already redacted when decision === "redact"
  filename: string | null;
  data_classes: string[];
  decision: Decision;
  reason: string;
  status: LogStatus;
  reviewer: string | null;
  reviewed_at: string | null;
  remark: string | null;
  map_id: string | null;
  user_department: string | null; // who the person IS
  content_department: string | null; // what the prompt is ABOUT (M8)
  department_confidence: number; // 0.0 - 1.0
}

export interface LogsPage {
  items: AuditRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface LogsQuery {
  limit?: number;
  offset?: number;
  status?: LogStatus;
  decision?: Decision;
  cross_department_only?: boolean;
}

export interface LogDecisionRequest {
  approve: boolean;
  remark: string; // required by the API -- send "" when blank
}

// Tuples arrive as JSON arrays (Python tuples over JSON), not objects.
export interface StatsSummary {
  by_decision: Record<string, number>;
  by_day: [string, string, number][]; // [iso_date, decision, count]
  top_data_classes: [string, number][]; // [data_class, count]
  top_users: [string, number][]; // [user_id, count] -- risk events only
}

export interface RuleRow {
  data_class: string;
  ai_tool_tier: string;
  user_role: string;
  purpose: string;
  decision: string;
}

export type ToolTier = "PUBLIC_AI" | "ENTERPRISE_AI" | "INTERNAL_AI";
export type ToolStatus = "approved" | "unapproved" | "blocked";

export interface AiTool {
  host: string;
  tier: ToolTier;
  status: ToolStatus;
  approved_by: string | null;
  approved_at: string | null;
  first_seen: string; // ISO 8601. Never moves once set.
  usage_count: number;
}

export interface ToolDecisionRequest {
  status: "approved" | "blocked";
  remark: string;
}

export interface InternalDocChunk {
  id: string;
  source_file: string;
  department: string;
  chunk_text: string;
  created_at: string;
}

export interface InternalDocsPage {
  items: InternalDocChunk[];
  total: number;
  limit: number;
  offset: number;
}

export interface InternalDocUploadRequest {
  department: string;
  attachment: {
    filename: string;
    mime: string;
    content_b64: string;
  };
  replace_source?: boolean;
}

export interface InternalDocUploadResponse {
  source_file: string;
  department: string;
  chunk_count: number;
  total: number;
}

export interface HealthResponse {
  status: "ok";
  mocked: string[]; // e.g. ["M2","M3","M5","M7","M8"]
}
