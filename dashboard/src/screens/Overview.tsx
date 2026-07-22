import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { Decision } from "../api/types";
import { useLogsQuery, useStatsQuery } from "../api/queries";

export interface DayPoint {
  date: string;
  allow: number;
  redact: number;
  hold: number;
  deny: number;
}

const DECISIONS: Decision[] = ["allow", "redact", "hold", "deny"];

export function pivotByDay(byDay: [string, string, number][]): DayPoint[] {
  const map = new Map<string, DayPoint>();
  for (const [date, decision, count] of byDay) {
    const existing = map.get(date) ?? { date, allow: 0, redact: 0, hold: 0, deny: 0 };
    if (DECISIONS.includes(decision as Decision)) existing[decision as Decision] += count;
    map.set(date, existing);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const TREND_DATA = [
  { date: "6 May", allowed: 300, redacted: 120, held: 40, denied: 10 },
  { date: "7 May", allowed: 330, redacted: 140, held: 50, denied: 12 },
  { date: "8 May", allowed: 400, redacted: 185, held: 50, denied: 10 },
  { date: "9 May", allowed: 330, redacted: 130, held: 45, denied: 8 },
  { date: "10 May", allowed: 385, redacted: 170, held: 50, denied: 10 },
  { date: "11 May", allowed: 345, redacted: 150, held: 55, denied: 12 },
  { date: "12 May", allowed: 400, redacted: 160, held: 50, denied: 8 },
];

const DATA_CLASSES = [
  { name: "PERSON (Name)", count: 612, pct: "31.4%" },
  { name: "EMAIL", count: 487, pct: "25.0%" },
  { name: "SALARY", count: 312, pct: "16.0%" },
  { name: "PHONE", count: 221, pct: "11.3%" },
  { name: "BANK_ACCT", count: 148, pct: "7.6%" },
  { name: "API_KEY", count: 68, pct: "3.5%" },
];

const AI_TOOLS = [
  { name: "ChatGPT", domain: "chatgpt.com", count: "1,102", pct: "56.6%" },
  { name: "Gemini", domain: "gemini.google.com", count: "564", pct: "29.0%" },
  { name: "Microsoft Copilot", domain: "copilot.microsoft.com", count: "184", pct: "9.4%" },
  { name: "Claude", domain: "claude.ai", count: "68", pct: "3.5%" },
  { name: "Other / Unlisted", domain: "", count: "30", pct: "1.5%" },
];

const TOP_RISK_USERS = [
  { name: "Wong Li Na", dept: "Finance", events: 28, trend: "↑ 27%", isUp: true },
  { name: "Siti Nur Aisyah", dept: "HR", events: 24, trend: "↑ 41%", isUp: true },
  { name: "Arjun Raj", dept: "Sales", events: 19, trend: "↑ 11%", isUp: true },
  { name: "Jason Tan", dept: "IT", events: 16, trend: "↓ 6%", isUp: false },
  { name: "Kevin Yip", dept: "Finance", events: 15, trend: "↑ 15%", isUp: true },
];

const RECENT_HIGH_RISK = [
  {
    ts: "12 May 2025, 10:18 AM",
    user: "Wong Li Na",
    tool: "ChatGPT",
    userDept: "Finance",
    predDept: "HR (92%)",
    similarity: "87% (High)",
    simTone: "text-rose-600 font-semibold",
    sensitivity: "0.91 (High)",
    sensTone: "text-rose-600 font-semibold",
    cross: "Yes (88%)",
    crossTone: "text-rose-600 font-semibold",
    verdict: "HOLD",
    verdictBadge: "bg-amber-100 text-amber-800 border border-amber-200",
    status: "Pending",
    statusBadge: "bg-blue-100 text-blue-700",
    risk: "High",
    riskBadge: "bg-rose-100 text-rose-700",
  },
  {
    ts: "12 May 2025, 09:58 AM",
    user: "Siti Nur Aisyah",
    tool: "ChatGPT",
    userDept: "HR",
    predDept: "Finance (89%)",
    similarity: "75% (High)",
    simTone: "text-rose-600 font-semibold",
    sensitivity: "0.93 (High)",
    sensTone: "text-rose-600 font-semibold",
    cross: "Yes (81%)",
    crossTone: "text-rose-600 font-semibold",
    verdict: "DENY",
    verdictBadge: "bg-rose-100 text-rose-800 border border-rose-200",
    status: "Reviewed",
    statusBadge: "bg-emerald-100 text-emerald-700",
    risk: "High",
    riskBadge: "bg-rose-100 text-rose-700",
  },
  {
    ts: "12 May 2025, 09:33 AM",
    user: "Arjun Raj",
    tool: "Microsoft Copilot",
    userDept: "Sales",
    predDept: "Sales (78%)",
    similarity: "62% (Medium)",
    simTone: "text-amber-600 font-semibold",
    sensitivity: "0.63 (Medium)",
    sensTone: "text-amber-600 font-semibold",
    cross: "No (22%)",
    crossTone: "text-emerald-600 font-semibold",
    verdict: "REDACT",
    verdictBadge: "bg-orange-100 text-orange-800 border border-orange-200",
    status: "Reviewed",
    statusBadge: "bg-emerald-100 text-emerald-700",
    risk: "Medium",
    riskBadge: "bg-amber-100 text-amber-700",
  },
  {
    ts: "12 May 2025, 09:10 AM",
    user: "Kevin Yip",
    tool: "ChatGPT",
    userDept: "Finance",
    predDept: "Legal (90%)",
    similarity: "81% (High)",
    simTone: "text-rose-600 font-semibold",
    sensitivity: "0.86 (High)",
    sensTone: "text-rose-600 font-semibold",
    cross: "Yes (76%)",
    crossTone: "text-rose-600 font-semibold",
    verdict: "HOLD",
    verdictBadge: "bg-amber-100 text-amber-800 border border-amber-200",
    status: "Pending",
    statusBadge: "bg-blue-100 text-blue-700",
    risk: "High",
    riskBadge: "bg-rose-100 text-rose-700",
  },
  {
    ts: "12 May 2025, 08:55 AM",
    user: "Marcus Lee",
    tool: "Microsoft Copilot",
    userDept: "Operations",
    predDept: "Operations (93%)",
    similarity: "8% (Low)",
    simTone: "text-emerald-600 font-semibold",
    sensitivity: "0.12 (Low)",
    sensTone: "text-emerald-600 font-semibold",
    cross: "No (9%)",
    crossTone: "text-emerald-600 font-semibold",
    verdict: "ALLOW",
    verdictBadge: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    status: "Reviewed",
    statusBadge: "bg-emerald-100 text-emerald-700",
    risk: "Low",
    riskBadge: "bg-emerald-100 text-emerald-700",
  },
];

export default function Overview() {
  const stats = useStatsQuery();
  const logs = useLogsQuery({ limit: 5, offset: 0 });

  return (
    <main className="p-6 space-y-6 bg-slate-50 min-h-screen">
      {/* 1. Top KPI Cards Row */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold text-slate-900 tracking-tight">
          AI Prompt Inspection (Last 7 Days)
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Allowed */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100/80 text-emerald-700">
                <svg className="h-7 w-7 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold tracking-tight text-slate-900">1,248</span>
                  <span className="text-xs font-bold text-emerald-600">64.2%</span>
                </div>
                <div className="text-xs font-bold text-slate-800">Allowed</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] font-medium text-slate-500">
              <span className="text-emerald-600 font-semibold">↑ 12.6%</span> vs previous 7 days
            </div>
          </div>

          {/* Redacted */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100/80 text-amber-700">
                <svg className="h-6 w-6 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold tracking-tight text-slate-900">412</span>
                  <span className="text-xs font-bold text-amber-600">21.2%</span>
                </div>
                <div className="text-xs font-bold text-slate-800">Redacted</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] font-medium text-slate-500">
              <span className="text-rose-500 font-semibold">↓ 4.3%</span> vs previous 7 days
            </div>
          </div>

          {/* Held for Review */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-100/80 text-rose-700">
                <svg className="h-7 w-7 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold tracking-tight text-slate-900">156</span>
                  <span className="text-xs font-bold text-rose-600">8.0%</span>
                </div>
                <div className="text-xs font-bold text-slate-800">Held for Review</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] font-medium text-slate-500">
              <span className="text-rose-600 font-semibold">↑ 18.7%</span> vs previous 7 days
            </div>
          </div>

          {/* Denied */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100/80 text-purple-700">
                <svg className="h-7 w-7 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold tracking-tight text-slate-900">132</span>
                  <span className="text-xs font-bold text-purple-600">6.6%</span>
                </div>
                <div className="text-xs font-bold text-slate-800">Denied</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] font-medium text-slate-500">
              <span className="text-purple-600 font-semibold">↓ 8.1%</span> vs previous 7 days
            </div>
          </div>

          {/* Total Inspections */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <svg className="h-6 w-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold tracking-tight text-slate-900">1,948</span>
                </div>
                <div className="text-xs font-bold text-slate-800">Total Inspections</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] font-medium text-slate-500">
              <span className="text-emerald-600 font-semibold">↑ 6.5%</span> vs previous 7 days
            </div>
          </div>
        </div>
      </section>

      {/* 2. Middle Section (3 Columns) */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Inspection Trend (Last 7 Days) */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-6 space-y-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900">
              Inspection Trend <span className="font-normal text-slate-400">(Last 7 Days)</span>
            </h3>
            <select className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 outline-none shadow-sm cursor-pointer hover:border-slate-300">
              <option>Last 7 days</option>
              <option>Last 30 days</option>
            </select>
          </div>

          {/* Legends with horizontal line dash symbol */}
          <div className="flex items-center gap-4 text-xs font-semibold">
            <div className="flex items-center gap-1.5 text-emerald-600">
              <span className="h-0.5 w-4 rounded-full bg-emerald-500 inline-block" />
              Allowed
            </div>
            <div className="flex items-center gap-1.5 text-amber-500">
              <span className="h-0.5 w-4 rounded-full bg-amber-500 inline-block" />
              Redacted
            </div>
            <div className="flex items-center gap-1.5 text-rose-500">
              <span className="h-0.5 w-4 rounded-full bg-rose-500 inline-block" />
              Held
            </div>
            <div className="flex items-center gap-1.5 text-purple-600">
              <span className="h-0.5 w-4 rounded-full bg-purple-500 inline-block" />
              Denied
            </div>
          </div>

          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={TREND_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} domain={[0, 500]} />
                <Tooltip />
                <Line type="monotone" dataKey="allowed" stroke="#16a34a" strokeWidth={2} dot={{ r: 3.5, fill: "#16a34a", strokeWidth: 0 }} />
                <Line type="monotone" dataKey="redacted" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3.5, fill: "#f59e0b", strokeWidth: 0 }} />
                <Line type="monotone" dataKey="held" stroke="#ef4444" strokeWidth={2} dot={{ r: 3.5, fill: "#ef4444", strokeWidth: 0 }} />
                <Line type="monotone" dataKey="denied" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3.5, fill: "#8b5cf6", strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pending Approval Donut */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3 space-y-4 flex flex-col justify-between">
          <h3 className="text-xs font-bold text-slate-900">Pending Approval</h3>

          <div className="flex items-center justify-between gap-2">
            {/* SVG Multi-color Ring Gauge */}
            <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                {/* Light Rose Background Track */}
                <circle cx="50" cy="50" r="38" stroke="#ffe4e6" strokeWidth="12" fill="transparent" />
                {/* Red Segment (High risk 50%) */}
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  stroke="#ef4444"
                  strokeWidth="12"
                  fill="transparent"
                  strokeDasharray="119.38 238.76"
                  strokeDashoffset="0"
                />
                {/* Yellow Segment (Medium risk 34%) */}
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  stroke="#f59e0b"
                  strokeWidth="12"
                  fill="transparent"
                  strokeDasharray="81.18 238.76"
                  strokeDashoffset="-119.38"
                />
                {/* Green Segment (Low risk 16%) */}
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  stroke="#10b981"
                  strokeWidth="12"
                  fill="transparent"
                  strokeDasharray="38.20 238.76"
                  strokeDashoffset="-200.56"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-bold text-slate-900">156</span>
                <span className="text-[10px] font-medium text-slate-500">Held requests</span>
              </div>
            </div>

            {/* Legend Right */}
            <div className="space-y-2 text-xs font-medium text-slate-700">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-rose-600 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-rose-500" /> High risk
                </span>
                <span className="font-bold text-slate-900">78 (50.0%)</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-amber-600 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> Medium risk
                </span>
                <span className="font-bold text-slate-900">53 (34.0%)</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Low risk
                </span>
                <span className="font-bold text-slate-900">25 (16.0%)</span>
              </div>
            </div>
          </div>

          {/* Bottom Alert Banner */}
          <div className="flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50/70 p-3 text-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100/90 text-rose-600 font-bold text-sm">
              ⏰
            </div>
            <div>
              <div className="text-slate-700 font-semibold">Oldest request waiting</div>
              <div className="text-rose-600 font-bold">
                18 minutes <span className="text-slate-400 font-normal">Since 12 May 2025, 10:18 AM</span>
              </div>
            </div>
          </div>
        </div>

        {/* Cross-department Activity Donut */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3 space-y-4 flex flex-col justify-between">
          <h3 className="text-xs font-bold text-slate-900">
            Cross-department Activity <span className="font-normal text-slate-400">(Last 7 Days)</span>
          </h3>

          <div className="flex items-center gap-4">
            {/* SVG Ring Gauge */}
            <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
              <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="38" stroke="#e2e8f0" strokeWidth="12" fill="transparent" />
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  stroke="#059669"
                  strokeWidth="12"
                  fill="transparent"
                  strokeDasharray="55.87 238.76"
                  strokeDashoffset="0"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xl font-bold text-slate-900">23.4%</span>
                <span className="text-[10px] font-medium text-slate-500">Cross-department</span>
              </div>
            </div>

            {/* Right side stats */}
            <div className="space-y-3">
              <div>
                <div className="text-2xl font-bold text-slate-900">456</div>
                <div className="text-[11px] font-medium text-slate-500">Cross-department events</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-900">1,948</div>
                <div className="text-[11px] font-medium text-slate-500">Total inspections</div>
              </div>
            </div>
          </div>

          <div className="text-[11px] font-medium text-slate-400">
            Confidence threshold: 80% <span className="cursor-pointer text-slate-400">ⓘ</span>
          </div>
        </div>
      </section>

      {/* 3. Lower Middle Grid Row (3 Columns) */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Top Data Classes Detected */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <h3 className="text-xs font-bold text-slate-800">Top Data Classes Detected (Last 7 Days)</h3>
          <div className="space-y-3">
            {DATA_CLASSES.map((item) => (
              <div key={item.name} className="flex items-center gap-3 text-xs">
                <span className="w-28 shrink-0 font-medium text-slate-700 truncate">{item.name}</span>
                <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-2">
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: item.pct }} />
                </div>
                <span className="w-20 text-right font-medium text-slate-600">
                  {item.count} <span className="text-slate-400 font-normal">({item.pct})</span>
                </span>
              </div>
            ))}
          </div>
          <div className="pt-2">
            <Link to="/policy/rules" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
              View all data classes ›
            </Link>
          </div>
        </div>

        {/* Top AI Tools by Usage */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <h3 className="text-xs font-bold text-slate-800">Top AI Tools by Usage (Last 7 Days)</h3>
          <div className="space-y-3">
            {AI_TOOLS.map((tool) => (
              <div key={tool.name} className="flex items-center gap-3 text-xs">
                <span className="w-36 shrink-0 font-medium text-slate-700 truncate">
                  {tool.name} {tool.domain && <span className="text-slate-400 font-normal text-[11px]">({tool.domain})</span>}
                </span>
                <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-2">
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: tool.pct }} />
                </div>
                <span className="w-20 text-right font-medium text-slate-600">
                  {tool.count} <span className="text-slate-400 font-normal">({tool.pct})</span>
                </span>
              </div>
            ))}
          </div>
          <div className="pt-2">
            <Link to="/policy/ai-tools" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
              View all AI tools ›
            </Link>
          </div>
        </div>

        {/* Top Risk Users */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <h3 className="text-xs font-bold text-slate-800">Top Risk Users <span className="font-normal text-slate-400">(By risk events)</span></h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 text-slate-400 font-medium">
                <tr>
                  <th className="pb-2">User</th>
                  <th className="pb-2">Department</th>
                  <th className="pb-2 text-center">Risk Events</th>
                  <th className="pb-2 text-right">Trend (7D)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {TOP_RISK_USERS.map((user) => (
                  <tr key={user.name}>
                    <td className="py-2.5 font-medium text-slate-800">{user.name}</td>
                    <td className="py-2.5 text-slate-500">{user.dept}</td>
                    <td className="py-2.5 text-center font-bold text-slate-800">{user.events}</td>
                    <td className={`py-2.5 text-right font-semibold ${user.isUp ? "text-rose-500" : "text-emerald-600"}`}>
                      {user.trend}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pt-2">
            <Link to="/policy/users" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
              View all users ›
            </Link>
          </div>
        </div>
      </section>

      {/* 4. Bottom Table: Recent High-risk Activity */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800">Recent High-risk Activity</h3>
          <Link to="/" className="text-xs font-semibold text-blue-600 hover:text-blue-800">
            View all in Audit Log ›
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/80 font-bold text-slate-700 align-middle text-center">
              <tr>
                <th className="px-3 py-2.5 whitespace-nowrap text-left">Date &amp; Time ↓</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-left">User</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-left">AI Tool</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-center">User Dept.</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-center">Predicted Content Dept.</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-center">Doc Similarity Detect</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-center">Confidential Sensitivity Score</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-center">Cross Dept. (Confidence)</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-center">Verdict</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-center">Review Status</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-center">Risk Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-middle">
              {RECENT_HIGH_RISK.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/60">
                  <td className="px-3 py-3 whitespace-nowrap text-slate-600 text-left">{row.ts}</td>
                  <td className="px-3 py-3 whitespace-nowrap font-medium text-slate-800 text-left">{row.user}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-700 text-left">{row.tool}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-600 text-center">{row.userDept}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-slate-700 font-medium text-center">{row.predDept}</td>
                  <td className={`px-3 py-3 whitespace-nowrap text-center ${row.simTone}`}>{row.similarity}</td>
                  <td className={`px-3 py-3 whitespace-nowrap text-center ${row.sensTone}`}>{row.sensitivity}</td>
                  <td className={`px-3 py-3 whitespace-nowrap text-center ${row.crossTone}`}>{row.cross}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-center">
                    <span className={`inline-block rounded-md px-2.5 py-1 text-[11px] font-bold ${row.verdictBadge}`}>
                      {row.verdict}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-center">
                    <span className={`inline-block rounded-md px-2.5 py-1 text-[11px] font-semibold ${row.statusBadge}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-center">
                    <span className={`inline-block rounded-md px-2.5 py-1 text-[11px] font-bold ${row.riskBadge}`}>
                      {row.risk}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
