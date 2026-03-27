/**
 * Tests for instinct-cleanup.ts - volume control auto-cleanup rules.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Instinct, Config } from "./types.js";
import {
  cleanupFlaggedInstincts,
  cleanupZeroConfirmedInstincts,
  enforceInstinctCap,
  cleanupContradictions,
  runCleanupPass,
} from "./instinct-cleanup.js";
import { saveInstinct, listInstincts } from "./instinct-store.js";
import { DEFAULT_CONFIG } from "./config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  idCounter++;
  return {
    id: `test-cleanup-${idCounter}`,
    title: "Test Instinct",
    trigger: "when testing",
    action: "run tests",
    confidence: 0.7,
    domain: "testing",
    source: "personal",
    scope: "project",
    project_id: "proj-abc123",
    project_name: "Test Project",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    observation_count: 5,
    confirmed_count: 1,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// cleanupFlaggedInstincts
// ---------------------------------------------------------------------------

describe("cleanupFlaggedInstincts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cleanup-flagged-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 for empty directory", () => {
    expect(cleanupFlaggedInstincts(tmpDir, 7)).toBe(0);
  });

  it("returns 0 for missing directory", () => {
    expect(cleanupFlaggedInstincts(join(tmpDir, "nonexistent"), 7)).toBe(0);
  });

  it("does not delete flagged instinct updated recently (within threshold)", () => {
    const instinct = makeInstinct({
      flagged_for_removal: true,
      updated_at: daysAgo(3), // 3 days, threshold is 7
    });
    saveInstinct(instinct, tmpDir);
    const deleted = cleanupFlaggedInstincts(tmpDir, 7);
    expect(deleted).toBe(0);
    expect(listInstincts(tmpDir)).toHaveLength(1);
  });

  it("deletes flagged instinct that is older than threshold", () => {
    const instinct = makeInstinct({
      flagged_for_removal: true,
      updated_at: daysAgo(8), // 8 days, threshold is 7
    });
    saveInstinct(instinct, tmpDir);
    const deleted = cleanupFlaggedInstincts(tmpDir, 7);
    expect(deleted).toBe(1);
    expect(listInstincts(tmpDir)).toHaveLength(0);
  });

  it("does not delete non-flagged instincts", () => {
    const instinct = makeInstinct({ updated_at: daysAgo(30) });
    saveInstinct(instinct, tmpDir);
    const deleted = cleanupFlaggedInstincts(tmpDir, 7);
    expect(deleted).toBe(0);
    expect(listInstincts(tmpDir)).toHaveLength(1);
  });

  it("deletes only the flagged-and-stale instincts when mixed", () => {
    const staleAndFlagged = makeInstinct({
      flagged_for_removal: true,
      updated_at: daysAgo(10),
    });
    const freshAndFlagged = makeInstinct({
      flagged_for_removal: true,
      updated_at: daysAgo(2),
    });
    const notFlagged = makeInstinct({ updated_at: daysAgo(30) });
    saveInstinct(staleAndFlagged, tmpDir);
    saveInstinct(freshAndFlagged, tmpDir);
    saveInstinct(notFlagged, tmpDir);

    const deleted = cleanupFlaggedInstincts(tmpDir, 7);
    expect(deleted).toBe(1);
    const remaining = listInstincts(tmpDir);
    expect(remaining).toHaveLength(2);
    expect(remaining.find((i) => i.id === staleAndFlagged.id)).toBeUndefined();
  });

  it("deletes exactly at threshold boundary (>= flaggedCleanupDays)", () => {
    const exactlyAtThreshold = makeInstinct({
      flagged_for_removal: true,
      updated_at: daysAgo(7), // exactly 7 days
    });
    saveInstinct(exactlyAtThreshold, tmpDir);
    const deleted = cleanupFlaggedInstincts(tmpDir, 7);
    expect(deleted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// cleanupZeroConfirmedInstincts
// ---------------------------------------------------------------------------

describe("cleanupZeroConfirmedInstincts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cleanup-zero-confirmed-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 for empty directory", () => {
    expect(cleanupZeroConfirmedInstincts(tmpDir, 28)).toBe(0);
  });

  it("does not delete zero-confirmed instinct younger than TTL", () => {
    const instinct = makeInstinct({
      confirmed_count: 0,
      created_at: daysAgo(10), // 10 days, TTL is 28
    });
    saveInstinct(instinct, tmpDir);
    expect(cleanupZeroConfirmedInstincts(tmpDir, 28)).toBe(0);
    expect(listInstincts(tmpDir)).toHaveLength(1);
  });

  it("deletes zero-confirmed instinct older than TTL", () => {
    const instinct = makeInstinct({
      confirmed_count: 0,
      created_at: daysAgo(29), // 29 days, TTL is 28
    });
    saveInstinct(instinct, tmpDir);
    const deleted = cleanupZeroConfirmedInstincts(tmpDir, 28);
    expect(deleted).toBe(1);
    expect(listInstincts(tmpDir)).toHaveLength(0);
  });

  it("does not delete instinct with confirmed_count > 0", () => {
    const instinct = makeInstinct({
      confirmed_count: 1,
      created_at: daysAgo(60),
    });
    saveInstinct(instinct, tmpDir);
    expect(cleanupZeroConfirmedInstincts(tmpDir, 28)).toBe(0);
    expect(listInstincts(tmpDir)).toHaveLength(1);
  });

  it("deletes at exactly the TTL boundary (>= ttlDays)", () => {
    const instinct = makeInstinct({
      confirmed_count: 0,
      created_at: daysAgo(28), // exactly 28 days
    });
    saveInstinct(instinct, tmpDir);
    expect(cleanupZeroConfirmedInstincts(tmpDir, 28)).toBe(1);
  });

  it("only deletes zero-confirmed-and-old when mixed", () => {
    const oldZero = makeInstinct({ confirmed_count: 0, created_at: daysAgo(30) });
    const youngZero = makeInstinct({ confirmed_count: 0, created_at: daysAgo(5) });
    const oldConfirmed = makeInstinct({ confirmed_count: 2, created_at: daysAgo(60) });
    saveInstinct(oldZero, tmpDir);
    saveInstinct(youngZero, tmpDir);
    saveInstinct(oldConfirmed, tmpDir);

    const deleted = cleanupZeroConfirmedInstincts(tmpDir, 28);
    expect(deleted).toBe(1);
    const remaining = listInstincts(tmpDir);
    expect(remaining).toHaveLength(2);
    expect(remaining.find((i) => i.id === oldZero.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// enforceInstinctCap
// ---------------------------------------------------------------------------

describe("enforceInstinctCap", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cleanup-cap-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 when count is at or below cap", () => {
    saveInstinct(makeInstinct({ confidence: 0.7 }), tmpDir);
    saveInstinct(makeInstinct({ confidence: 0.5 }), tmpDir);
    expect(enforceInstinctCap(tmpDir, 5)).toBe(0);
    expect(listInstincts(tmpDir)).toHaveLength(2);
  });

  it("returns 0 for empty directory", () => {
    expect(enforceInstinctCap(tmpDir, 10)).toBe(0);
  });

  it("deletes the lowest-confidence instincts when over cap", () => {
    const high = makeInstinct({ confidence: 0.9 });
    const medium = makeInstinct({ confidence: 0.6 });
    const low = makeInstinct({ confidence: 0.3 });
    saveInstinct(high, tmpDir);
    saveInstinct(medium, tmpDir);
    saveInstinct(low, tmpDir);

    const deleted = enforceInstinctCap(tmpDir, 2);
    expect(deleted).toBe(1);
    const remaining = listInstincts(tmpDir);
    expect(remaining).toHaveLength(2);
    expect(remaining.find((i) => i.id === low.id)).toBeUndefined();
    expect(remaining.find((i) => i.id === high.id)).toBeDefined();
    expect(remaining.find((i) => i.id === medium.id)).toBeDefined();
  });

  it("deletes multiple instincts when multiple over cap", () => {
    for (let i = 0; i < 5; i++) {
      saveInstinct(makeInstinct({ confidence: 0.1 + i * 0.1 }), tmpDir);
    }
    const deleted = enforceInstinctCap(tmpDir, 2);
    expect(deleted).toBe(3);
    expect(listInstincts(tmpDir)).toHaveLength(2);
  });

  it("retains highest-confidence instincts", () => {
    const instincts = [0.3, 0.5, 0.7, 0.9].map((c) =>
      makeInstinct({ confidence: c })
    );
    for (const inst of instincts) saveInstinct(inst, tmpDir);

    enforceInstinctCap(tmpDir, 2);
    const remaining = listInstincts(tmpDir);
    const confidences = remaining.map((i) => i.confidence).sort();
    expect(confidences).toEqual([0.7, 0.9]);
  });

  it("does not mutate the original instincts array", () => {
    const inst1 = makeInstinct({ confidence: 0.8 });
    const inst2 = makeInstinct({ confidence: 0.2 });
    saveInstinct(inst1, tmpDir);
    saveInstinct(inst2, tmpDir);
    const origConfidence = inst1.confidence;
    enforceInstinctCap(tmpDir, 1);
    expect(inst1.confidence).toBe(origConfidence); // not mutated
  });
});

// ---------------------------------------------------------------------------
// cleanupContradictions
// ---------------------------------------------------------------------------

describe("cleanupContradictions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cleanup-contradictions-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 for empty directory", () => {
    expect(cleanupContradictions(tmpDir)).toBe(0);
  });

  it("returns 0 when no contradictions exist", () => {
    saveInstinct(
      makeInstinct({ trigger: "When writing Python code", action: "Use type hints for parameters" }),
      tmpDir
    );
    saveInstinct(
      makeInstinct({ trigger: "When deploying to production", action: "Run smoke tests first" }),
      tmpDir
    );
    expect(cleanupContradictions(tmpDir)).toBe(0);
    expect(listInstincts(tmpDir)).toHaveLength(2);
  });

  it("flags the lower-confidence instinct in a contradictory pair", () => {
    const high = makeInstinct({
      trigger: "When designing APIs",
      action: "Prefer interfaces for dependency injection",
      confidence: 0.8,
    });
    const low = makeInstinct({
      trigger: "When designing APIs",
      action: "Avoid interfaces, prefer concrete types for simplicity",
      confidence: 0.5,
    });
    saveInstinct(high, tmpDir);
    saveInstinct(low, tmpDir);

    const flagged = cleanupContradictions(tmpDir);
    expect(flagged).toBe(1);

    const remaining = listInstincts(tmpDir);
    expect(remaining).toHaveLength(2);
    const lowAfter = remaining.find((i) => i.id === low.id);
    expect(lowAfter?.flagged_for_removal).toBe(true);
    const highAfter = remaining.find((i) => i.id === high.id);
    expect(highAfter?.flagged_for_removal).toBeFalsy();
  });

  it("flags both when confidence is equal", () => {
    const a = makeInstinct({
      trigger: "When writing tests",
      action: "Always mock external dependencies",
      confidence: 0.6,
    });
    const b = makeInstinct({
      trigger: "When writing tests",
      action: "Never mock external dependencies, use real implementations",
      confidence: 0.6,
    });
    saveInstinct(a, tmpDir);
    saveInstinct(b, tmpDir);

    const flagged = cleanupContradictions(tmpDir);
    expect(flagged).toBe(2);

    const remaining = listInstincts(tmpDir);
    expect(remaining.every((i) => i.flagged_for_removal)).toBe(true);
  });

  it("does not flag instincts already flagged_for_removal", () => {
    const a = makeInstinct({
      trigger: "When designing APIs",
      action: "Prefer interfaces for dependency injection",
      confidence: 0.8,
      flagged_for_removal: true,
    });
    const b = makeInstinct({
      trigger: "When designing APIs",
      action: "Avoid interfaces, prefer concrete types",
      confidence: 0.5,
    });
    saveInstinct(a, tmpDir);
    saveInstinct(b, tmpDir);

    // a is already flagged, so the pair should be skipped
    expect(cleanupContradictions(tmpDir)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runCleanupPass
// ---------------------------------------------------------------------------

describe("runCleanupPass", () => {
  let baseDir: string;
  let projectId: string;
  let projectPersonalDir: string;
  let globalPersonalDir: string;
  let config: Config;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "cleanup-pass-"));
    projectId = "proj-test-001";
    projectPersonalDir = join(baseDir, "projects", projectId, "instincts", "personal");
    globalPersonalDir = join(baseDir, "instincts", "personal");
    mkdirSync(projectPersonalDir, { recursive: true });
    mkdirSync(globalPersonalDir, { recursive: true });
    config = makeConfig();
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("returns zero result when both dirs are empty", () => {
    const result = runCleanupPass(projectId, config, baseDir);
    expect(result).toEqual({ flaggedDeleted: 0, zeroConfirmedDeleted: 0, contradictionsFlagged: 0, capDeleted: 0, total: 0 });
  });

  it("cleans up flagged instincts in project dir", () => {
    const stale = makeInstinct({ flagged_for_removal: true, updated_at: daysAgo(10) });
    saveInstinct(stale, projectPersonalDir);

    const result = runCleanupPass(projectId, config, baseDir);
    expect(result.flaggedDeleted).toBe(1);
    expect(result.total).toBe(1);
    expect(listInstincts(projectPersonalDir)).toHaveLength(0);
  });

  it("cleans up flagged instincts in global dir", () => {
    const stale = makeInstinct({ flagged_for_removal: true, updated_at: daysAgo(10) });
    saveInstinct(stale, globalPersonalDir);

    const result = runCleanupPass(null, config, baseDir);
    expect(result.flaggedDeleted).toBe(1);
    expect(result.total).toBe(1);
  });

  it("skips project cleanup when projectId is null", () => {
    const projStale = makeInstinct({
      flagged_for_removal: true,
      updated_at: daysAgo(10),
    });
    saveInstinct(projStale, projectPersonalDir);

    const result = runCleanupPass(null, config, baseDir);
    expect(result.flaggedDeleted).toBe(0);
    expect(listInstincts(projectPersonalDir)).toHaveLength(1); // untouched
  });

  it("cleans up zero-confirmed TTL instincts in both dirs", () => {
    const projOldZero = makeInstinct({ confirmed_count: 0, created_at: daysAgo(30) });
    const globalOldZero = makeInstinct({ confirmed_count: 0, created_at: daysAgo(30) });
    saveInstinct(projOldZero, projectPersonalDir);
    saveInstinct(globalOldZero, globalPersonalDir);

    const result = runCleanupPass(projectId, config, baseDir);
    expect(result.zeroConfirmedDeleted).toBe(2);
    expect(result.total).toBe(2);
  });

  it("enforces project cap by deleting lowest-confidence instincts", () => {
    const maxPer = 2;
    const cfg = makeConfig({ max_total_instincts_per_project: maxPer });
    for (let i = 0; i < 4; i++) {
      saveInstinct(makeInstinct({ confidence: 0.3 + i * 0.1 }), projectPersonalDir);
    }

    const result = runCleanupPass(projectId, cfg, baseDir);
    expect(result.capDeleted).toBe(2);
    expect(listInstincts(projectPersonalDir)).toHaveLength(2);
  });

  it("enforces global cap by deleting lowest-confidence instincts", () => {
    const cfg = makeConfig({ max_total_instincts_global: 1 });
    saveInstinct(makeInstinct({ confidence: 0.3 }), globalPersonalDir);
    saveInstinct(makeInstinct({ confidence: 0.7 }), globalPersonalDir);

    const result = runCleanupPass(null, cfg, baseDir);
    expect(result.capDeleted).toBe(1);
    expect(listInstincts(globalPersonalDir)).toHaveLength(1);
    expect(listInstincts(globalPersonalDir)[0]!.confidence).toBe(0.7);
  });

  it("aggregates total across all rules and both dirs", () => {
    // project: 1 flagged stale
    saveInstinct(
      makeInstinct({ flagged_for_removal: true, updated_at: daysAgo(10) }),
      projectPersonalDir
    );
    // global: 1 zero-confirmed old
    saveInstinct(
      makeInstinct({ confirmed_count: 0, created_at: daysAgo(30) }),
      globalPersonalDir
    );

    const result = runCleanupPass(projectId, config, baseDir);
    expect(result.flaggedDeleted).toBe(1);
    expect(result.zeroConfirmedDeleted).toBe(1);
    expect(result.total).toBe(2);
  });

  it("respects custom config thresholds", () => {
    const cfg = makeConfig({ flagged_cleanup_days: 3, instinct_ttl_days: 10 });

    // Flagged, 5 days old: should be deleted (threshold = 3)
    saveInstinct(
      makeInstinct({ flagged_for_removal: true, updated_at: daysAgo(5) }),
      projectPersonalDir
    );
    // Zero-confirmed, 15 days old: should be deleted (threshold = 10)
    saveInstinct(
      makeInstinct({ confirmed_count: 0, created_at: daysAgo(15) }),
      globalPersonalDir
    );

    const result = runCleanupPass(projectId, cfg, baseDir);
    expect(result.flaggedDeleted).toBe(1);
    expect(result.zeroConfirmedDeleted).toBe(1);
    expect(result.total).toBe(2);
  });

  it("flags contradictory instincts in project dir", () => {
    saveInstinct(
      makeInstinct({
        trigger: "When designing APIs",
        action: "Prefer interfaces for dependency injection",
        confidence: 0.8,
      }),
      projectPersonalDir
    );
    saveInstinct(
      makeInstinct({
        trigger: "When designing APIs",
        action: "Avoid interfaces, prefer concrete types",
        confidence: 0.5,
      }),
      projectPersonalDir
    );

    const result = runCleanupPass(projectId, config, baseDir);
    expect(result.contradictionsFlagged).toBe(1);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });
});
