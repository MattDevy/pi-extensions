/**
 * Tests for contradiction detection between instincts.
 *
 * Contradiction = similar triggers + semantically opposing actions.
 * Uses pattern-based detection (negation words, antonym pairs) - no LLM cost.
 */

import { describe, it, expect } from "vitest";
import type { Instinct } from "./types.js";
import {
  OPPOSING_VERB_PAIRS,
  hasOpposingAction,
  findContradictions,
  type ContradictionMatch,
} from "./instinct-contradiction.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  idCounter++;
  return {
    id: `test-contradiction-${idCounter}`,
    title: "Test Instinct",
    trigger: "When designing APIs",
    action: "Prefer interfaces for dependency injection",
    confidence: 0.7,
    domain: "architecture",
    source: "personal",
    scope: "project",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 2,
    contradicted_count: 0,
    inactive_count: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// OPPOSING_VERB_PAIRS
// ---------------------------------------------------------------------------

describe("OPPOSING_VERB_PAIRS", () => {
  it("contains at least 5 pairs", () => {
    expect(OPPOSING_VERB_PAIRS.length).toBeGreaterThanOrEqual(5);
  });

  it("includes the avoid/prefer pair", () => {
    const found = OPPOSING_VERB_PAIRS.some(
      ([a, b]) => (a === "avoid" && b === "prefer") || (a === "prefer" && b === "avoid")
    );
    expect(found).toBe(true);
  });

  it("includes the never/always pair", () => {
    const found = OPPOSING_VERB_PAIRS.some(
      ([a, b]) => (a === "never" && b === "always") || (a === "always" && b === "never")
    );
    expect(found).toBe(true);
  });

  it("all entries are lowercase two-element tuples", () => {
    for (const [a, b] of OPPOSING_VERB_PAIRS) {
      expect(a).toBe(a.toLowerCase());
      expect(b).toBe(b.toLowerCase());
      expect(a.length).toBeGreaterThan(0);
      expect(b.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// hasOpposingAction
// ---------------------------------------------------------------------------

describe("hasOpposingAction", () => {
  it("detects 'prefer' vs 'avoid' as opposing", () => {
    expect(
      hasOpposingAction(
        "Prefer interfaces for dependency injection",
        "Avoid interfaces, use concrete types instead"
      )
    ).not.toBeNull();
  });

  it("detects 'always' vs 'never' as opposing", () => {
    const result = hasOpposingAction(
      "Always use strict mode in TypeScript",
      "Never enable strict mode for legacy code"
    );
    expect(result).not.toBeNull();
  });

  it("detects 'use' vs 'avoid' as opposing", () => {
    const result = hasOpposingAction(
      "Use functional components with hooks",
      "Avoid functional components, prefer class components"
    );
    expect(result).not.toBeNull();
  });

  it("returns the reason string including the detected pair", () => {
    const result = hasOpposingAction(
      "Prefer interfaces for dependency injection",
      "Avoid interfaces, use concrete types"
    );
    expect(result).toContain("prefer");
    expect(result).toContain("avoid");
  });

  it("is case-insensitive", () => {
    expect(
      hasOpposingAction(
        "PREFER interfaces for dependency injection",
        "AVOID interfaces for simplicity"
      )
    ).not.toBeNull();
  });

  it("returns null when actions are not opposing", () => {
    expect(
      hasOpposingAction(
        "Use vitest for testing",
        "Use jest for testing"
      )
    ).toBeNull();
  });

  it("returns null for identical actions", () => {
    expect(
      hasOpposingAction(
        "Prefer interfaces for dependency injection",
        "Prefer interfaces for dependency injection"
      )
    ).toBeNull();
  });

  it("returns null for empty actions", () => {
    expect(hasOpposingAction("", "")).toBeNull();
  });

  it("detects 'skip' vs 'ensure' as opposing", () => {
    expect(
      hasOpposingAction(
        "Skip linting on test files",
        "Ensure linting runs on all files including tests"
      )
    ).not.toBeNull();
  });

  it("detects 'don't' / 'do not' vs affirmative verb as opposing", () => {
    const result = hasOpposingAction(
      "Do not use any as a type in TypeScript",
      "Use any when types are unknown"
    );
    expect(result).not.toBeNull();
  });

  it("requires both verbs to be present - not just one", () => {
    // "prefer" is present but there's no opposing verb
    expect(
      hasOpposingAction(
        "Prefer small functions under 50 lines",
        "Keep functions small and focused"
      )
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findContradictions
// ---------------------------------------------------------------------------

describe("findContradictions", () => {
  it("returns empty array when no instincts", () => {
    expect(findContradictions([])).toEqual([]);
  });

  it("returns empty array for a single instinct", () => {
    expect(findContradictions([makeInstinct()])).toEqual([]);
  });

  it("returns empty array when triggers are dissimilar", () => {
    const a = makeInstinct({
      trigger: "When writing Python code",
      action: "Prefer type hints for all parameters",
    });
    const b = makeInstinct({
      trigger: "When deploying to production",
      action: "Avoid deploying on Fridays",
    });
    expect(findContradictions([a, b])).toEqual([]);
  });

  it("returns empty array when triggers are similar but actions agree", () => {
    const a = makeInstinct({
      trigger: "When designing APIs",
      action: "Use interfaces for abstraction",
    });
    const b = makeInstinct({
      trigger: "When designing API contracts",
      action: "Use TypeScript interfaces for type safety",
    });
    expect(findContradictions([a, b])).toEqual([]);
  });

  it("detects contradiction: similar triggers, opposing actions", () => {
    const a = makeInstinct({
      trigger: "When designing APIs",
      action: "Prefer interfaces for dependency injection",
    });
    const b = makeInstinct({
      trigger: "When designing APIs",
      action: "Avoid interfaces, prefer concrete types for simplicity",
    });
    const result = findContradictions([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.instinctA.id).toBe(a.id);
    expect(result[0]!.instinctB.id).toBe(b.id);
    expect(result[0]!.triggerSimilarity).toBeGreaterThan(0);
    expect(result[0]!.reason).toBeTruthy();
  });

  it("returns match with correct structure", () => {
    const a = makeInstinct({
      trigger: "When handling errors in API handlers",
      action: "Always return structured error responses",
    });
    const b = makeInstinct({
      trigger: "When handling errors in API endpoints",
      action: "Never return structured errors, use plain text",
    });
    const result = findContradictions([a, b]);
    expect(result).toHaveLength(1);
    const match: ContradictionMatch = result[0]!;
    expect(match).toHaveProperty("instinctA");
    expect(match).toHaveProperty("instinctB");
    expect(match).toHaveProperty("triggerSimilarity");
    expect(match).toHaveProperty("reason");
  });

  it("respects custom trigger similarity threshold", () => {
    const a = makeInstinct({
      trigger: "When designing APIs for the backend service",
      action: "Prefer interfaces for dependency injection",
    });
    const b = makeInstinct({
      trigger: "When designing APIs for the frontend service",
      action: "Avoid interfaces, prefer concrete types",
    });

    // With a very high threshold, triggers may not be similar enough
    const strict = findContradictions([a, b], 0.95);
    expect(strict).toEqual([]);

    // With a lower threshold, should detect
    const relaxed = findContradictions([a, b], 0.3);
    expect(relaxed).toHaveLength(1);
  });

  it("does not double-count pairs (A,B same as B,A)", () => {
    const a = makeInstinct({
      trigger: "When writing tests",
      action: "Always mock external dependencies",
    });
    const b = makeInstinct({
      trigger: "When writing tests",
      action: "Never mock external dependencies, use real implementations",
    });
    const result = findContradictions([a, b]);
    expect(result).toHaveLength(1);
  });

  it("detects multiple contradictions in a larger set", () => {
    const a = makeInstinct({
      trigger: "When writing tests",
      action: "Always mock external dependencies",
    });
    const b = makeInstinct({
      trigger: "When writing tests",
      action: "Never mock external dependencies",
    });
    const c = makeInstinct({
      trigger: "When handling errors",
      action: "Prefer throwing exceptions for error handling",
    });
    const d = makeInstinct({
      trigger: "When handling errors",
      action: "Avoid throwing exceptions, use Result types",
    });
    const e = makeInstinct({
      trigger: "When deploying",
      action: "Run smoke tests before deploying",
    });

    const result = findContradictions([a, b, c, d, e]);
    expect(result).toHaveLength(2);
  });

  it("skips flagged_for_removal instincts", () => {
    const a = makeInstinct({
      trigger: "When designing APIs",
      action: "Prefer interfaces for dependency injection",
      flagged_for_removal: true,
    });
    const b = makeInstinct({
      trigger: "When designing APIs",
      action: "Avoid interfaces, prefer concrete types",
    });
    expect(findContradictions([a, b])).toEqual([]);
  });
});
