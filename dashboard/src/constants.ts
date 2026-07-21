// Shared constants used across screens and components. Kept out of any
// single screen file so components (e.g. RuleFormDialog) that need them
// don't have to import from a screen module -- that created a circular
// import (PolicyAndTools -> RuleFormDialog -> PolicyAndTools) that broke at
// runtime (DEPARTMENTS undefined mid-evaluation) even though it type-checked
// and production-built fine.

export const DEPARTMENTS = ["engineering", "finance", "hr", "legal"];
export const DECISIONS = ["allow", "redact", "hold", "deny"];
