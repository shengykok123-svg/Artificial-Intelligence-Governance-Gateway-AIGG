// M6  Unit test for the AI Tools pie-chart aggregation.

import { describe, expect, it } from "vitest";

import type { AiTool, DetectionPattern } from "../api/types";
import { groupPatternsByDataClass, usageShareByHost } from "./PolicyAndTools";

function tool(host: string, usage: number, visits: number): AiTool {
  return {
    host, tier: "PUBLIC_AI", status: "unapproved", approved_by: null, approved_at: null,
    first_seen: "2026-07-01T00:00:00Z", usage_count: usage, visit_count: visits, catalog: "known",
  };
}

describe("usageShareByHost", () => {
  it("ranks by usage_count + visit_count, most active host first", () => {
    const result = usageShareByHost([tool("a.com", 1, 0), tool("b.com", 5, 2), tool("c.com", 0, 3)]);
    expect(result.map((row) => row.name)).toEqual(["b.com", "c.com", "a.com"]);
    expect(result.find((row) => row.name === "b.com")?.value).toBe(7);
  });

  it("excludes hosts with zero combined activity entirely", () => {
    const result = usageShareByHost([tool("a.com", 0, 0), tool("b.com", 4, 0)]);
    expect(result).toEqual([{ name: "b.com", value: 4 }]);
  });

  it("returns an empty array when nothing has any usage", () => {
    expect(usageShareByHost([tool("a.com", 0, 0), tool("b.com", 0, 0)])).toEqual([]);
  });

  it("groups everything past topN into a single Other bucket", () => {
    const tools = [
      tool("a.com", 10, 0), tool("b.com", 9, 0), tool("c.com", 8, 0),
      tool("d.com", 3, 0), tool("e.com", 2, 0),
    ];
    const result = usageShareByHost(tools, 3);
    expect(result).toEqual([
      { name: "a.com", value: 10 },
      { name: "b.com", value: 9 },
      { name: "c.com", value: 8 },
      { name: "Other", value: 5 },
    ]);
  });

  it("omits the Other bucket when there is no long tail", () => {
    const result = usageShareByHost([tool("a.com", 10, 0), tool("b.com", 5, 0)], 5);
    expect(result.some((row) => row.name === "Other")).toBe(false);
  });
});

function pattern(id: number, dataClass: string, value: string, sequence = 1): DetectionPattern {
  return { id, data_class: dataClass, pattern: value, remark: "", sequence, display_id: `${dataClass}-${String(sequence).padStart(5, "0")}` };
}

describe("groupPatternsByDataClass", () => {
  it("groups multiple patterns for the same class together", () => {
    const result = groupPatternsByDataClass([
      pattern(1, "API_KEY", "sk-.+"),
      pattern(2, "SALARY", "RM ?\\d+"),
      pattern(3, "API_KEY", "API_KEY=.+"),
    ]);
    expect(result.map((g) => g.dataClass)).toEqual(["API_KEY", "SALARY"]);
    expect(result.find((g) => g.dataClass === "API_KEY")?.patterns.map((p) => p.id)).toEqual([1, 3]);
  });

  it("sorts groups alphabetically by data class", () => {
    const result = groupPatternsByDataClass([
      pattern(1, "PHONE", "x"), pattern(2, "BANK_ACCT", "y"), pattern(3, "EMAIL", "z"),
    ]);
    expect(result.map((g) => g.dataClass)).toEqual(["BANK_ACCT", "EMAIL", "PHONE"]);
  });

  it("returns an empty array for no patterns", () => {
    expect(groupPatternsByDataClass([])).toEqual([]);
  });

  it("a class with one pattern is still its own group", () => {
    const result = groupPatternsByDataClass([pattern(1, "MYKAD", "\\d{6}-\\d{2}-\\d{4}")]);
    expect(result).toEqual([{ dataClass: "MYKAD", patterns: [pattern(1, "MYKAD", "\\d{6}-\\d{2}-\\d{4}")] }]);
  });
});
