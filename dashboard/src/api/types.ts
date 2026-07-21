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
  content_department: string | null; // what the prompt is ABOUT (fused M8 > M9 > null)
  department_confidence: number; // 0.0 - 1.0
  purpose: string; // what the employee attested; "GENERAL" by default
  justification: string | null; // free-text explanation from the justification
                                 // picker -- distinct from purpose (the category
                                 // dropdown); null until the employee has stated one
  m8_department: string | null; // raw EmbedDetector.classify() output
  m8_confidence: number;
  m9_department: string | null; // raw DebertaDetector.classify() output
  m9_confidence: number; // department-attribution axis only
  m9_sensitivity_confidence: number; // confidentiality-severity axis; no M8 equivalent
  cross_department_confidence: number | null; // set only when content_department != user_department
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
  id: number;
  data_class: string;
  ai_tool_tier: string;
  user_role: string;
  purpose: string;
  decision: Decision;
  min_confidence: number; // 0.0 - 1.0
  content_department: string; // "*" | "@cross" | a literal department
  require_purpose: boolean;
  detector: string; // "*" | "embed" | "deberta"
}

// Create/update body -- everything RuleRow has except id, which the server
// assigns (create) or takes from the URL (update).
export interface RuleRequest {
  data_class: string;
  ai_tool_tier: string;
  user_role: string;
  purpose: string;
  decision: Decision;
  min_confidence: number;
  content_department: string;
  require_purpose: boolean;
  detector: string;
}

// M2's redact list -- deliberately simpler than RuleRow: every entry here
// only ever does one thing (get redacted), so there's no tier/role/purpose/
// decision to carry, just the data class itself.
export interface RedactionClass {
  id: number;
  data_class: string;
}

export interface RedactionClassRequest {
  data_class: string;
}

// A single regex M2 evaluates. Many rows can share a data_class -- API_KEY
// already needs two (an "sk-..." key shape and an "..._API_KEY=..." env
// line); an admin adding another way an existing class is written (or a
// brand-new class) is just another row here.
export interface DetectionPattern {
  id: number;
  data_class: string;
  pattern: string;
  remark: string; // free-text note -- why this pattern exists, what it's for
  sequence: number; // 1-based ordinal within this data_class
  display_id: string; // "[data_class]-00001", server-computed, e.g. "MYKAD-00001"
}

export interface DetectionPatternRequest {
  data_class: string;
  pattern: string;
  remark: string;
}

export type ToolTier = "PUBLIC_AI" | "ENTERPRISE_AI" | "INTERNAL_AI";
export type ToolStatus = "approved" | "unapproved" | "blocked";
export type ToolCatalog = "known" | "other";

export interface AiTool {
  host: string;
  tier: ToolTier;
  status: ToolStatus;
  approved_by: string | null;
  approved_at: string | null;
  first_seen: string; // ISO 8601. Never moves once set.
  usage_count: number; // real /v1/inspect calls (audit-log derived)
  visit_count: number; // extension-detected network activity (shadow AI)
  catalog: ToolCatalog; // "known": on the curated AI-host list. "other":
                        // reached the backend some other way (e.g. a direct
                        // /v1/inspect call to an uncatalogued host).
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
