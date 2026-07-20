// M6  Screen 2. status=pending only. Optimistic update, rollback on error.

import { useState } from "react";

import { useLogDecisionMutation, useLogsQuery } from "../api/queries";
import type { AuditRecord } from "../api/types";
import { DataClassPills } from "../components/DataClassPills";
import { EmptyState, ErrorState, SkeletonRows } from "../components/EmptyState";
import { VerdictBadge } from "../components/VerdictBadge";

const COLUMN_COUNT = 8;

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PendingRow({ row }: { row: AuditRecord }) {
  const [remark, setRemark] = useState("");
  const mutation = useLogDecisionMutation();

  function decide(approve: boolean) {
    mutation.mutate({ logId: row.log_id, body: { approve, remark } });
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3 text-gray-800">
        <div className="font-medium">{row.user_id}</div>
        <div className="text-xs text-gray-500">
          {row.target_host} · {formatTs(row.ts)}
        </div>
      </td>
      <td className="px-4 py-3 text-gray-800">{row.prompt_text}</td>
      <td className="px-4 py-3">
        <DataClassPills dataClasses={row.data_classes} />
      </td>
      <td className="px-4 py-3">
        <VerdictBadge decision={row.decision} />
        <p className="mt-1 text-xs text-gray-500">{row.reason}</p>
      </td>
      <td className="px-4 py-3 text-gray-600">{row.purpose}</td>
      <td className="max-w-xs px-4 py-3 text-gray-600">
        {row.justification ?? <span className="text-gray-400">—</span>}
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          placeholder="Remark (optional)"
          className="w-48 rounded border border-gray-300 px-2 py-1 text-sm"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          disabled={mutation.isPending}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button
            className="rounded bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            disabled={mutation.isPending}
            onClick={() => decide(true)}
          >
            Approve
          </button>
          <button
            className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            disabled={mutation.isPending}
            onClick={() => decide(false)}
          >
            Deny
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function ApprovalQueue() {
  const { data, isLoading, isError, error } = useLogsQuery({
    limit: 200,
    offset: 0,
    status: "pending",
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Approval queue</h1>
        <p className="text-sm text-gray-500">
          Prompts held for compliance review. The employee's browser is polling for your
          decision and unblocks their composer within ~3 seconds of it.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">User / host / time</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Prompt</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Data classes</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Verdict &amp; reason</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Purpose</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Justification</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Remark</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <SkeletonRows rows={4} columns={COLUMN_COUNT} />}
            {!isLoading && items.map((row) => <PendingRow key={row.log_id} row={row} />)}
          </tbody>
        </table>

        {!isLoading && isError && <ErrorState message={(error as Error).message} />}
        {!isLoading && !isError && items.length === 0 && (
          <EmptyState title="Nothing waiting for review" hint="Held prompts will show up here in real time." />
        )}
      </div>
    </div>
  );
}
