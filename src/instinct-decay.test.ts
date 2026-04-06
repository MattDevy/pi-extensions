/**
 * Tests for US-031: Passive Confidence Decay
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Instinct } from "./types.js";
import {
  applyDecayToInstinct,
  applyDecayInDir,
  runDecayPass,
} from "./instinct-decay.js";
import { saveInstinct, listInstincts } from "./instinct-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  idCounter++;
  return {
    id: `test-decay-${idCounter}`,
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
    confirmed_count: 2,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

/** Returns an ISO 8601 date string for N days ago. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// applyDecayToInstinct (pure function)
// ---------------------------------------------------------------------------

describe("applyDecayToInstinct", () => {
  it("returns null when updated_at is current (no meaningful decay)", () => {
    const instinct = makeInstinct({ updated_at: new Date().toISOString() });
    expect(applyDecayToInstinct(instinct)).toBeNull();
  });

  it("returns updated instinct when updated_at is 2 weeks ago", () => {
    const instinct = makeInstinct({
      confidence: 0.7,
      updated_at: daysAgo(14),
    });
    const result = applyDecayToInstinct(instinct);
    expect(result).not.toBeNull();
    // 2 weeks * 0.05/week = 0.10 decay; 0.7 - 0.10 = 0.60
    expect(result!.confidence).toBeCloseTo(0.6, 2);
  });

  it("sets updated_at to current time when a change is made", () => {
    const before = Date.now();
    const instinct = makeInstinct({ updated_at: daysAgo(14) });
    const result = applyDecayToInstinct(instinct);
    expect(result).not.toBeNull();
    const updatedMs = new Date(result!.updated_at).getTime();
    expect(updatedMs).toBeGreaterThanOrEqual(before);
  });

  it("flags instinct for removal when confidence decays to or below 0.1", () => {
    // 0.15 confidence, 4 weeks ago: decay = 4 * 0.05 = 0.20; 0.15 - 0.20 = -0.05 < 0.1
    const instinct = makeInstinct({
      confidence: 0.15,
      updated_at: daysAgo(28),
    });
    const result = applyDecayToInstinct(instinct);
    expect(result).not.toBeNull();
    expect(result!.flagged_for_removal).toBe(true);
    expect(result!.confidence).toBe(0.1); // clamped to CLAMP_MIN
  });

  it("does not mutate the original instinct (immutability)", () => {
    const instinct = makeInstinct({
      confidence: 0.7,
      updated_at: daysAgo(14),
    });
    const originalConfidence = instinct.confidence;
    const originalUpdatedAt = instinct.updated_at;
    applyDecayToInstinct(instinct);
    expect(instinct.confidence).toBe(originalConfidence);
    expect(instinct.updated_at).toBe(originalUpdatedAt);
  });

  it("omits flagged_for_removal when confidence stays above threshold", () => {
    const instinct = makeInstinct({
      confidence: 0.7,
      updated_at: daysAgo(14),
    });
    const result = applyDecayToInstinct(instinct);
    expect(result).not.toBeNull();
    expect(result!.flagged_for_removal).toBeUndefined();
  });

  it("detects flag change even when confidence is clamped (already at minimum)", () => {
    // An instinct at minimum confidence that hasn't been flagged yet
    const instinct = makeInstinct({
      confidence: 0.1,
      updated_at: daysAgo(28),
    });
    const result = applyDecayToInstinct(instinct);
    // Confidence can't go below 0.1 (clamped), but raw < 0.1 so it gets flagged
    expect(result).not.toBeNull();
    expect(result!.flagged_for_removal).toBe(true);
    expect(result!.confidence).toBe(0.1);
  });

  it("returns null for recently updated instinct (well below decay threshold)", () => {
    // 5 minutes ago: decay ≈ 0.02 * (5 / (7*24*60)) ≈ 0.0000019 - below 0.001 threshold
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const instinct = makeInstinct({
      confidence: 0.7,
      updated_at: fiveMinutesAgo,
    });
    expect(applyDecayToInstinct(instinct)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyDecayInDir (I/O function)
// ---------------------------------------------------------------------------

describe("applyDecayInDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "decay-dir-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 for a missing directory", () => {
    const count = applyDecayInDir(join(tmpDir, "nonexistent"));
    expect(count).toBe(0);
  });

  it("returns 0 when all instincts are recently updated", () => {
    const instinct = makeInstinct({ updated_at: new Date().toISOString() });
    saveInstinct(instinct, tmpDir);
    const count = applyDecayInDir(tmpDir);
    expect(count).toBe(0);
  });

  it("returns count of updated instincts for stale ones", () => {
    const stale = makeInstinct({ confidence: 0.7, updated_at: daysAgo(14) });
    saveInstinct(stale, tmpDir);
    const count = applyDecayInDir(tmpDir);
    expect(count).toBe(1);
  });

  it("saves the decayed confidence back to disk", () => {
    const stale = makeInstinct({ confidence: 0.7, updated_at: daysAgo(14) });
    saveInstinct(stale, tmpDir);
    applyDecayInDir(tmpDir);
    const reloaded = listInstincts(tmpDir);
    expect(reloaded).toHaveLength(1);
    // 2 weeks * 0.05/week = 0.10; 0.7 - 0.10 = 0.60
    expect(reloaded[0]!.confidence).toBeCloseTo(0.6, 2);
  });

  it("handles mixed fresh and stale instincts correctly", () => {
    const fresh = makeInstinct({ updated_at: new Date().toISOString() });
    const stale = makeInstinct({ confidence: 0.7, updated_at: daysAgo(14) });
    saveInstinct(fresh, tmpDir);
    saveInstinct(stale, tmpDir);
    const count = applyDecayInDir(tmpDir);
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runDecayPass (orchestrator)
// ---------------------------------------------------------------------------

describe("runDecayPass", () => {
  let baseDir: string;
  let projectId: string;
  let projectPersonalDir: string;
  let globalPersonalDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "decay-pass-test-"));
    projectId = "proj-test-001";
    projectPersonalDir = join(
      baseDir,
      "projects",
      projectId,
      "instincts",
      "personal",
    );
    globalPersonalDir = join(baseDir, "instincts", "personal");
    mkdirSync(projectPersonalDir, { recursive: true });
    mkdirSync(globalPersonalDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("applies decay to project personal instincts", () => {
    const stale = makeInstinct({ confidence: 0.7, updated_at: daysAgo(14) });
    saveInstinct(stale, projectPersonalDir);
    runDecayPass(projectId, baseDir);
    const reloaded = listInstincts(projectPersonalDir);
    // 2 weeks * 0.05/week = 0.10; 0.7 - 0.10 = 0.60
    expect(reloaded[0]!.confidence).toBeCloseTo(0.6, 2);
  });

  it("applies decay to global personal instincts", () => {
    const stale = makeInstinct({ confidence: 0.8, updated_at: daysAgo(21) });
    saveInstinct(stale, globalPersonalDir);
    runDecayPass(undefined, baseDir);
    const reloaded = listInstincts(globalPersonalDir);
    // 3 weeks * 0.05 = 0.15 decay; 0.8 - 0.15 = 0.65
    expect(reloaded[0]!.confidence).toBeCloseTo(0.65, 2);
  });

  it("applies decay to both project and global when projectId is provided", () => {
    const projStale = makeInstinct({
      confidence: 0.7,
      updated_at: daysAgo(14),
    });
    const globalStale = makeInstinct({
      confidence: 0.8,
      updated_at: daysAgo(14),
    });
    saveInstinct(projStale, projectPersonalDir);
    saveInstinct(globalStale, globalPersonalDir);
    const total = runDecayPass(projectId, baseDir);
    expect(total).toBe(2);
  });

  it("skips project decay when projectId is null", () => {
    const projStale = makeInstinct({
      confidence: 0.7,
      updated_at: daysAgo(14),
    });
    const globalStale = makeInstinct({
      confidence: 0.8,
      updated_at: daysAgo(14),
    });
    saveInstinct(projStale, projectPersonalDir);
    saveInstinct(globalStale, globalPersonalDir);
    const total = runDecayPass(null, baseDir);
    // Only global instinct decayed
    expect(total).toBe(1);
    // Project instinct unchanged
    const projReloaded = listInstincts(projectPersonalDir);
    expect(projReloaded[0]!.confidence).toBe(0.7);
  });

  it("returns total count of updated instincts across both scopes", () => {
    const stale1 = makeInstinct({ confidence: 0.7, updated_at: daysAgo(14) });
    const stale2 = makeInstinct({ confidence: 0.6, updated_at: daysAgo(14) });
    saveInstinct(stale1, projectPersonalDir);
    saveInstinct(stale2, globalPersonalDir);
    const total = runDecayPass(projectId, baseDir);
    expect(total).toBe(2);
  });

  it("returns 0 when all instincts are fresh", () => {
    const fresh1 = makeInstinct({ updated_at: new Date().toISOString() });
    const fresh2 = makeInstinct({ updated_at: new Date().toISOString() });
    saveInstinct(fresh1, projectPersonalDir);
    saveInstinct(fresh2, globalPersonalDir);
    const total = runDecayPass(projectId, baseDir);
    expect(total).toBe(0);
  });
});
