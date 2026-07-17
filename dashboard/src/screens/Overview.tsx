// M6  Screen 3. Recharts: verdicts/day stacked bar, top data classes, top users by risk events. Feeds from GET /v1/stats.

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useStatsQuery } from "../api/queries";
import type { Decision } from "../api/types";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { VERDICT_COLORS, VERDICT_LABEL } from "../components/VerdictBadge";

const DECISIONS: Decision[] = ["allow", "redact", "hold", "deny"];

export interface DayPoint {
  date: string;
  allow: number;
  redact: number;
  hold: number;
  deny: number;
}

/**
 * by_day arrives as a flat list of [date, decision, count] arrays -- Python
 * tuples over JSON, so arrays, not objects -- and a day with no rows for a
 * given decision is ABSENT from the list, not zero. Every point below is
 * seeded with all four keys at 0 before anything is added, so a sparse day
 * still stacks correctly instead of rendering a hole that looks like data.
 */
export function pivotByDay(byDay: [string, string, number][]): DayPoint[] {
  const byDate = new Map<string, DayPoint>();
  for (const [date, decision, count] of byDay) {
    let point = byDate.get(date);
    if (!point) {
      point = { date, allow: 0, redact: 0, hold: 0, deny: 0 };
      byDate.set(date, point);
    }
    if ((DECISIONS as string[]).includes(decision)) {
      point[decision as Decision] += count;
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function tuplesToRows(tuples: [string, number][]): { name: string; count: number }[] {
  return tuples.map(([name, count]) => ({ name, count }));
}

function ChartPanel({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      <div className="mt-3 h-64">
        {empty ? <EmptyState title="No data yet" /> : children}
      </div>
    </div>
  );
}

export default function Overview() {
  const { data, isLoading, isError, error } = useStatsQuery();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Overview</h1>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-72 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Overview</h1>
        <ErrorState message={(error as Error)?.message ?? "unknown error"} />
      </div>
    );
  }

  const byDay = pivotByDay(data.by_day);
  const topDataClasses = tuplesToRows(data.top_data_classes);
  const topUsers = tuplesToRows(data.top_users);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Overview</h1>
        <p className="text-sm text-gray-500">Polls GET /v1/stats every 3 seconds.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {DECISIONS.map((d) => (
          <div key={d} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: VERDICT_COLORS[d].dot }}
                aria-hidden="true"
              />
              <span className="text-xs font-medium text-gray-500">{VERDICT_LABEL[d]}</span>
            </div>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{data.by_decision[d] ?? 0}</p>
          </div>
        ))}
      </div>

      <ChartPanel title="Verdicts per day" empty={byDay.length === 0}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byDay}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend formatter={(value) => VERDICT_LABEL[value as Decision] ?? value} />
            {DECISIONS.map((d) => (
              <Bar key={d} dataKey={d} name={d} stackId="verdicts" fill={VERDICT_COLORS[d].dot} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartPanel title="Top data classes" empty={topDataClasses.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topDataClasses} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#475569" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          title="Top users by risk events"
          subtitle="Counts prompts that were NOT allowed -- fifty clean prompts do not make someone risky."
          empty={topUsers.length === 0}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topUsers} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#7c3aed" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </div>
  );
}
