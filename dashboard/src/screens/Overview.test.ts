// M6  Unit test for the by_day pivot -- the one place this screen fails silently.

import { describe, expect, it } from "vitest";

import { pivotByDay } from "./Overview";

describe("pivotByDay", () => {
  it("fills every decision key, including days with no rows for a given decision", () => {
    // A day with no rows for a decision is ABSENT from by_day, not zero.
    // 2026-07-01 has allow and hold but no redact/deny entries at all.
    const byDay: [string, string, number][] = [
      ["2026-07-01", "allow", 3],
      ["2026-07-01", "hold", 1],
      ["2026-07-02", "allow", 2],
      ["2026-07-02", "redact", 1],
      ["2026-07-02", "hold", 0], // zero explicitly present, must still work
      ["2026-07-02", "deny", 1],
    ];

    const result = pivotByDay(byDay);

    expect(result).toEqual([
      { date: "2026-07-01", allow: 3, redact: 0, hold: 1, deny: 0 },
      { date: "2026-07-02", allow: 2, redact: 1, hold: 0, deny: 1 },
    ]);
  });

  it("sorts by date ascending regardless of input order", () => {
    const byDay: [string, string, number][] = [
      ["2026-07-03", "allow", 1],
      ["2026-07-01", "allow", 1],
      ["2026-07-02", "allow", 1],
    ];
    expect(pivotByDay(byDay).map((p) => p.date)).toEqual([
      "2026-07-01", "2026-07-02", "2026-07-03",
    ]);
  });

  it("returns an empty array for empty input, not a hole", () => {
    expect(pivotByDay([])).toEqual([]);
  });

  it("sums multiple entries for the same date and decision rather than overwriting", () => {
    // Defensive: the server should not emit duplicates, but a pivot that
    // overwrites instead of accumulates would silently under-report if it did.
    const byDay: [string, string, number][] = [
      ["2026-07-01", "allow", 2],
      ["2026-07-01", "allow", 3],
    ];
    expect(pivotByDay(byDay)).toEqual([
      { date: "2026-07-01", allow: 5, redact: 0, hold: 0, deny: 0 },
    ]);
  });
});
