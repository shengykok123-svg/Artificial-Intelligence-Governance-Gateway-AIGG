// M6  IF-7 + IF-10 calls. refetchInterval 3s. No WebSockets.
//
// Every network call in this app goes through the functions below. Nothing
// else calls fetch. That is what lets queries.ts poll, mock, and retry
// without any screen knowing the difference.

import type {
  AiTool,
  AuditRecord,
  HealthResponse,
  InternalDocsPage,
  InternalDocUploadRequest,
  InternalDocUploadResponse,
  LogDecisionRequest,
  LogsPage,
  LogsQuery,
  RuleRow,
  StatsSummary,
  ToolDecisionRequest,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const API_KEY = import.meta.env.VITE_API_KEY ?? "dev-key-change-me";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": API_KEY,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { detail?: string }) => b.detail)
      .catch(() => undefined);
    throw new ApiError(res.status, detail ?? `${init?.method ?? "GET"} ${path} -> HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function queryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// -- IF-7 --------------------------------------------------------------

export function getLogs(query: LogsQuery): Promise<LogsPage> {
  return request<LogsPage>(`/v1/logs${queryString(query)}`);
}

export function postLogDecision(logId: string, body: LogDecisionRequest): Promise<AuditRecord> {
  return request<AuditRecord>(`/v1/logs/${encodeURIComponent(logId)}/decision`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getStats(): Promise<StatsSummary> {
  return request<StatsSummary>("/v1/stats");
}

// Not JSON, so it bypasses request<T>() -- fetches the blob directly and
// triggers a browser download. The API key can't ride a plain <a href>
// download link (no way to attach a header to it), so this goes through
// fetch like everything else in this file, then synthesizes a click on a
// throwaway object-URL anchor.
export async function downloadAttachment(logId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/logs/${encodeURIComponent(logId)}/attachment`, {
    headers: { "X-Api-Key": API_KEY },
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { detail?: string }) => b.detail)
      .catch(() => undefined);
    throw new ApiError(res.status, detail ?? `GET attachment -> HTTP ${res.status}`);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "attachment";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// -- IF-10 -------------------------------------------------------------

export function getRules(): Promise<RuleRow[]> {
  return request<RuleRow[]>("/v1/rules");
}

export function getTools(): Promise<AiTool[]> {
  return request<AiTool[]>("/v1/tools");
}

export function postToolDecision(host: string, body: ToolDecisionRequest): Promise<AiTool> {
  return request<AiTool>(`/v1/tools/${encodeURIComponent(host)}/decision`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getInternalDocs(): Promise<InternalDocsPage> {
  return request<InternalDocsPage>("/v1/internal-docs?limit=50&offset=0");
}

export function postInternalDoc(body: InternalDocUploadRequest): Promise<InternalDocUploadResponse> {
  return request<InternalDocUploadResponse>("/v1/internal-docs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/v1/health");
}

export { ApiError };
