// M6  Screen 1. Verdict/status filters, 'cross-department only' toggle (user dept != content dept AND confidence > 0.6). Row expands to M3's reason verbatim.

import { Fragment, useState } from "react";

import { useLogsQuery } from "../api/queries";
import type { AuditRecord, Decision, LogStatus } from "../api/types";
import { DataClassPills } from "../components/DataClassPills";
import { EmptyState, ErrorState, SkeletonRows } from "../components/EmptyState";
import { StatusBadge, VerdictBadge } from "../components/VerdictBadge";

const PAGE_SIZE = 20;
const COLUMN_COUNT = 13; // User, Time, Host, Prompt, Filename, Data classes, User dept, Content dept, M8, M9, Purpose, Verdict, Status

/**
 * Mirrors backend/app/repo/base.py's cross_department_only predicate
 * EXACTLY. Written once, used for both the row badge here and nowhere else
 * -- the toggle itself filters server-side (GET /v1/logs?cross_department_only=true),
 * never this array. If this function drifts from the server's, the badge
 * and the toggle disagree and the screen quietly stops making sense.
 */
export function isCrossDepartment(row: AuditRecord): boolean {
  return (
    row.content_department !== null &&
    row.user_department !== null &&
    row.content_department !== row.user_department &&
    row.department_confidence > 0.6
  );
}

function excerpt(text: string, max = 72): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function detectorLabel(department: string | null, confidence: number): string {
  return department === null ? "—" : `${department} (${confidence.toFixed(2)})`;
}

function ContentDepartmentCell({ row }: { row: AuditRecord }) {
  if (row.content_department === null) {
    return <span className="text-gray-400">—</span>;
  }
  if (isCrossDepartment(row)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-1 text-sm font-medium text-indigo-800">
        <span className="h-2 w-2 rounded-full bg-indigo-600" aria-hidden="true" />
        Cross-dept: {row.content_department} ({row.department_confidence.toFixed(2)})
      </span>
    );
  }
  return (
    <span className="text-gray-500">
      {row.content_department}{" "}
      <span className="text-xs text-gray-400">({row.department_confidence.toFixed(2)})</span>
    </span>
  );
}

export default function AuditLog() {
  const [decision, setDecision] = useState<Decision | "">("");
  const [status, setStatus] = useState<LogStatus | "">("");
  const [crossDepartmentOnly, setCrossDepartmentOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useLogsQuery({
    limit: PAGE_SIZE,
    offset,
    decision: decision || undefined,
    status: status || undefined,
    cross_department_only: crossDepartmentOnly || undefined,
  });

  function resetPageAnd<T>(setter: (v: T) => void) {
    return (v: T) => {
      setOffset(0);
      setter(v);
    };
  }

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Audit log</h1>
        <p className="text-sm text-gray-500">
          Every prompt inspected by the gateway. Redacted prompts show the redacted text here --
          the original lives only in the encrypted vault.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Verdict
          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={decision}
            onChange={(e) => resetPageAnd(setDecision)(e.target.value as Decision | "")}
          >
            <option value="">All</option>
            <option value="allow">Allow</option>
            <option value="redact">Redact</option>
            <option value="hold">Hold</option>
            <option value="deny">Deny</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          Status
          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={status}
            onChange={(e) => resetPageAnd(setStatus)(e.target.value as LogStatus | "")}
          >
            <option value="">All</option>
            <option value="auto">Auto</option>
            <option value="pending">Pending review</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
          </select>
        </label>

        <label className="ml-auto flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={crossDepartmentOnly}
            onChange={(e) => resetPageAnd(setCrossDepartmentOnly)(e.target.checked)}
          />
          Cross-department only
          <span className="text-xs text-gray-400">
            (content department differs from the sender's, confidence &gt; 0.6)
          </span>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">User</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Time</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Target host</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Prompt</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Filename</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Data classes</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">User dept</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Content dept</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">M8</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">M9</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Purpose</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Verdict</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <SkeletonRows rows={8} columns={COLUMN_COUNT} />}

            {!isLoading &&
              items.map((row) => {
                const expanded = expandedId === row.log_id;
                return (
                  <Fragment key={row.log_id}>
                    <tr
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => setExpandedId(expanded ? null : row.log_id)}
                    >
                      <td className="px-4 py-3 text-gray-800">{row.user_id}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatTs(row.ts)}</td>
                      <td className="px-4 py-3 text-gray-600">{row.target_host}</td>
                      <td className="px-4 py-3 text-gray-800" title={row.prompt_text}>
                        {excerpt(row.prompt_text)}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{row.filename ?? "—"}</td>
                      <td className="px-4 py-3">
                        <DataClassPills dataClasses={row.data_classes} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">{row.user_department ?? "—"}</td>
                      <td className="px-4 py-3">
                        <ContentDepartmentCell row={row} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {detectorLabel(row.m8_department, row.m8_confidence)}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {detectorLabel(row.m9_department, row.m9_confidence)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{row.purpose}</td>
                      <td className="px-4 py-3">
                        <VerdictBadge decision={row.decision} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-slate-50">
                        <td colSpan={COLUMN_COUNT} className="px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Reason (verbatim) · Purpose: {row.purpose}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{row.reason}</p>
                          {row.cross_department_confidence !== null && (
                            <div className="mt-2">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                                Cross-department confidence: {row.cross_department_confidence.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {row.reviewer && (
                            <p className="mt-2 text-xs text-gray-500">
                              Reviewed by {row.reviewer}
                              {row.reviewed_at && ` on ${formatTs(row.reviewed_at)}`}
                              {row.remark && ` — "${row.remark}"`}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>

        {!isLoading && isError && <ErrorState message={(error as Error).message} />}
        {!isLoading && !isError && items.length === 0 && (
          <EmptyState
            title="No matching prompts"
            hint="Try clearing a filter, or come back once traffic arrives."
          />
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          {total === 0 ? "0 results" : `Showing ${from}–${to} of ${total}`}
        </span>
        <div className="flex gap-2">
          <button
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
