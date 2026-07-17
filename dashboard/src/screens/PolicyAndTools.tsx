// M6  Screen 4. Rules table (IF-10) + tools table with Approve/Block. Showing the rules IS the point.

import { useState } from "react";

import { useRulesQuery, useToolDecisionMutation, useToolsQuery } from "../api/queries";
import type { AiTool, Decision, ToolStatus } from "../api/types";
import { EmptyState, ErrorState, SkeletonRows } from "../components/EmptyState";
import { VerdictBadge } from "../components/VerdictBadge";

const RULES_COLUMNS = 5;
const TOOLS_COLUMNS = 6;

const DECISIONS: readonly string[] = ["allow", "redact", "hold", "deny"];

function isDecision(value: string): value is Decision {
  return DECISIONS.includes(value);
}

const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  approved: "Approved",
  unapproved: "Unapproved",
  blocked: "Blocked",
};

const TOOL_STATUS_COLORS: Record<ToolStatus, { bg: string; text: string }> = {
  approved: { bg: "#dcfce7", text: "#166534" },
  unapproved: { bg: "#fef3c7", text: "#92400e" },
  blocked: { bg: "#fee2e2", text: "#991b1b" },
};

function ToolStatusBadge({ status }: { status: ToolStatus }) {
  const c = TOOL_STATUS_COLORS[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-sm font-medium"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {TOOL_STATUS_LABEL[status]}
    </span>
  );
}

function formatDate(iso: string): string {
  // Evidence, not vibes -- a real date, never "2 days ago".
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ToolRow({ tool }: { tool: AiTool }) {
  const [remark, setRemark] = useState("");
  const mutation = useToolDecisionMutation();

  function decide(status: "approved" | "blocked") {
    mutation.mutate({ host: tool.host, body: { status, remark } });
  }

  return (
    <tr>
      <td className="px-4 py-3 font-medium text-gray-800">{tool.host}</td>
      <td className="px-4 py-3 text-gray-600">{tool.tier}</td>
      <td className="px-4 py-3">
        <ToolStatusBadge status={tool.status} />
      </td>
      <td className="px-4 py-3 text-gray-600">{formatDate(tool.first_seen)}</td>
      <td className="px-4 py-3 text-gray-600">{tool.usage_count}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Remark (optional)"
            className="w-36 rounded border border-gray-300 px-2 py-1 text-sm"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            disabled={mutation.isPending}
          />
          <button
            className="rounded bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            disabled={mutation.isPending || tool.status === "approved"}
            onClick={() => decide("approved")}
          >
            Approve
          </button>
          <button
            className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            disabled={mutation.isPending || tool.status === "blocked"}
            onClick={() => decide("blocked")}
          >
            Block
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function PolicyAndTools() {
  const rules = useRulesQuery();
  const tools = useToolsQuery();

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Policy rules</h1>
          <p className="text-sm text-gray-500">
            These rows are configuration an organisation owns, not code the engineering team
            shipped. Changing what happens when MyKad hits a public AI tool is a row edit here,
            not a release.
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Data class</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">AI tool tier</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">User role</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Purpose</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Verdict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.isLoading && <SkeletonRows rows={5} columns={RULES_COLUMNS} />}
              {!rules.isLoading &&
                rules.data?.map((rule, i) => (
                  <tr key={`${rule.data_class}-${rule.ai_tool_tier}-${rule.user_role}-${rule.purpose}-${i}`}>
                    <td className="px-4 py-3 font-medium text-gray-800">{rule.data_class}</td>
                    <td className="px-4 py-3 text-gray-600">{rule.ai_tool_tier}</td>
                    <td className="px-4 py-3 text-gray-600">{rule.user_role}</td>
                    <td className="px-4 py-3 text-gray-600">{rule.purpose}</td>
                    <td className="px-4 py-3">
                      {isDecision(rule.decision) ? (
                        <VerdictBadge decision={rule.decision} />
                      ) : (
                        rule.decision
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!rules.isLoading && rules.isError && (
            <ErrorState message={(rules.error as Error).message} />
          )}
          {!rules.isLoading && !rules.isError && (rules.data?.length ?? 0) === 0 && (
            <EmptyState title="No rules configured" />
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">AI tools</h1>
          <p className="text-sm text-gray-500">
            Every host the gateway has ever seen a prompt sent to, including ones nobody
            configured in advance -- shadow AI, discovered on first use. Unapproved and blocked
            tools sort to the top automatically; this table does not re-sort them.
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Host</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Tier</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">First seen</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Usage</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tools.isLoading && <SkeletonRows rows={3} columns={TOOLS_COLUMNS} />}
              {!tools.isLoading && tools.data?.map((tool) => <ToolRow key={tool.host} tool={tool} />)}
            </tbody>
          </table>
          {!tools.isLoading && tools.isError && (
            <ErrorState message={(tools.error as Error).message} />
          )}
          {!tools.isLoading && !tools.isError && (tools.data?.length ?? 0) === 0 && (
            <EmptyState title="No tools seen yet" />
          )}
        </div>
      </section>
    </div>
  );
}
