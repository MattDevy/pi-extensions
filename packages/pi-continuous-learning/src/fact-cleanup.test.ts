import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cleanupFlaggedFacts,
  cleanupZeroConfirmedFacts,
  enforceFactCap,
  runFactCleanupPass,
} from "./fact-cleanup.js";
import { saveFact, listFacts, invalidateFactCache } from "./fact-store.js";
import type { Fact, Config } from "./types.js";
import { DEFAULT_CONFIG } from "./config.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-cl-fact-cleanup-test-"));
}

function makeFact(id: string, overrides: Partial<Fact> = {}): Fact {
  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
  return {
    id,
    title: id,
    content: `Fact: ${id}`,
    confidence: 0.5,
    domain: "workflow",
    source: "personal",
    scope: "project",
    created_at: old,
    updated_at: old,
    observation_count: 1,
    confirmed_count: 0,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

const BASE_CONFIG: Config = {
  ...DEFAULT_CONFIG,
};

describe("cleanupFlaggedFacts", () => {
  let tmpDir: string;
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    invalidateFactCache();
  });

  it("deletes facts flagged_for_removal older than threshold", () => {
    tmpDir = makeTmpDir();
    saveFact(makeFact("flagged-old", { flagged_for_removal: true }), tmpDir);
    const deleted = cleanupFlaggedFacts(tmpDir, 7);
    expect(deleted).toBe(1);
    expect(listFacts(tmpDir)).toHaveLength(0);
  });

  it("does not delete facts flagged recently (below threshold)", () => {
    tmpDir = makeTmpDir();
    const recentlyFlagged = makeFact("flagged-new", {
      flagged_for_removal: true,
      updated_at: new Date().toISOString(),
    });
    saveFact(recentlyFlagged, tmpDir);
    const deleted = cleanupFlaggedFacts(tmpDir, 7);
    expect(deleted).toBe(0);
  });

  it("does not delete unflagged facts", () => {
    tmpDir = makeTmpDir();
    saveFact(makeFact("normal"), tmpDir);
    const deleted = cleanupFlaggedFacts(tmpDir, 7);
    expect(deleted).toBe(0);
    expect(listFacts(tmpDir)).toHaveLength(1);
  });
});

describe("cleanupZeroConfirmedFacts", () => {
  let tmpDir: string;
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    invalidateFactCache();
  });

  it("deletes zero-confirmed facts older than TTL", () => {
    tmpDir = makeTmpDir();
    saveFact(makeFact("old-unconfirmed", { confirmed_count: 0 }), tmpDir);
    const deleted = cleanupZeroConfirmedFacts(tmpDir, 7);
    expect(deleted).toBe(1);
  });

  it("does not delete confirmed facts even if old", () => {
    tmpDir = makeTmpDir();
    saveFact(makeFact("confirmed", { confirmed_count: 3 }), tmpDir);
    const deleted = cleanupZeroConfirmedFacts(tmpDir, 7);
    expect(deleted).toBe(0);
  });

  it("does not delete recently created zero-confirmed facts", () => {
    tmpDir = makeTmpDir();
    const recent = makeFact("new-fact", {
      confirmed_count: 0,
      created_at: new Date().toISOString(),
    });
    saveFact(recent, tmpDir);
    const deleted = cleanupZeroConfirmedFacts(tmpDir, 28);
    expect(deleted).toBe(0);
  });
});

describe("enforceFactCap", () => {
  let tmpDir: string;
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    invalidateFactCache();
  });

  it("deletes lowest-confidence facts when over cap", () => {
    tmpDir = makeTmpDir();
    saveFact(makeFact("low", { confidence: 0.2, confirmed_count: 1 }), tmpDir);
    saveFact(makeFact("mid", { confidence: 0.5, confirmed_count: 1 }), tmpDir);
    saveFact(makeFact("high", { confidence: 0.8, confirmed_count: 1 }), tmpDir);
    const deleted = enforceFactCap(tmpDir, 2);
    expect(deleted).toBe(1);
    const remaining = listFacts(tmpDir);
    expect(remaining).toHaveLength(2);
    expect(remaining.find((f) => f.id === "low")).toBeUndefined();
  });

  it("does nothing when at or below cap", () => {
    tmpDir = makeTmpDir();
    saveFact(makeFact("a", { confirmed_count: 1 }), tmpDir);
    saveFact(makeFact("b", { confirmed_count: 1 }), tmpDir);
    expect(enforceFactCap(tmpDir, 2)).toBe(0);
    expect(enforceFactCap(tmpDir, 5)).toBe(0);
  });
});

describe("runFactCleanupPass", () => {
  let tmpDir: string;
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    invalidateFactCache();
  });

  it("runs all cleanup rules and returns aggregated results", () => {
    tmpDir = makeTmpDir();
    const projectDir = join(tmpDir, "projects", "p1", "facts", "personal");
    mkdirSync(projectDir, { recursive: true });
    saveFact(
      makeFact("flagged", { flagged_for_removal: true }),
      projectDir,
    );
    const result = runFactCleanupPass("p1", BASE_CONFIG, tmpDir);
    expect(result.flaggedDeleted).toBe(1);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it("returns zero result when no facts exist", () => {
    tmpDir = makeTmpDir();
    const result = runFactCleanupPass("no-project", BASE_CONFIG, tmpDir);
    expect(result.total).toBe(0);
  });
});
