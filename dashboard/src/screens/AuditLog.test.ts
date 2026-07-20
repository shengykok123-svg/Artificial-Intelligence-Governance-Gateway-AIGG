// M6  Unit test for the cross-department predicate -- must match
// backend/app/repo/base.py's cross_department_only EXACTLY, including the
// exactly-0.6 boundary, or the badge and the server filter disagree.

import { describe, expect, it } from "vitest";

import type { AuditRecord } from "../api/types";
import { isCrossDepartment } from "./AuditLog";

function rec(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    log_id: "1",
    user_id: "wei.eng@acme.my",
    ts: "2026-07-17T09:00:00Z",
    target_host: "chatgpt.com",
    prompt_text: "hello",
    filename: null,
    data_classes: [],
    decision: "allow",
    reason: "No sensitive data class detected.",
    status: "auto",
    reviewer: null,
    reviewed_at: null,
    remark: null,
    map_id: null,
    user_department: "engineering",
    content_department: "finance",
    department_confidence: 0.75,
    purpose: "GENERAL",
    justification: null,
    m8_department: null,
    m8_confidence: 0,
    m9_department: null,
    m9_confidence: 0,
    m9_sensitivity_confidence: 0,
    cross_department_confidence: null,
    ...overrides,
  };
}

describe("isCrossDepartment", () => {
  it("is true when departments differ and confidence is strictly above 0.6", () => {
    expect(isCrossDepartment(rec({ department_confidence: 0.61 }))).toBe(true);
  });

  it("is false at EXACTLY 0.6 -- the pinned boundary", () => {
    expect(isCrossDepartment(rec({ department_confidence: 0.6 }))).toBe(false);
  });

  it("is false just below 0.6", () => {
    expect(isCrossDepartment(rec({ department_confidence: 0.59 }))).toBe(false);
  });

  it("is false when the departments match, regardless of confidence", () => {
    expect(
      isCrossDepartment(rec({ user_department: "finance", content_department: "finance", department_confidence: 0.99 })),
    ).toBe(false);
  });

  it("is false when content_department is null", () => {
    expect(isCrossDepartment(rec({ content_department: null, department_confidence: 0.99 }))).toBe(false);
  });

  it("is false when user_department is null", () => {
    expect(isCrossDepartment(rec({ user_department: null, department_confidence: 0.99 }))).toBe(false);
  });
});
