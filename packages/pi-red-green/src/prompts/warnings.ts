import type { EnforcementLevel } from "../types.js";

export function getStaleTestWarning(): string {
  return `**Stale test results.** The last test run was in a previous turn. Run tests again before claiming they pass. Fresh evidence required.`;
}

export function getOrderingWarning(level: EnforcementLevel): string {
  if (level === "strict") {
    return `**TDD Violation (strict mode).** Implementation code was written before tests. Delete the implementation and start over with tests first. This is not negotiable.`;
  }
  return `**TDD Warning.** Implementation files were edited before any test files in this cycle. Consider writing tests first.`;
}
