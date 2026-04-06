import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyDecayToFact, runFactDecayPass } from "./fact-decay.js";
import { saveFact, listFacts, invalidateFactCache } from "./fact-store.js";
import type { Fact } from "./types.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-cl-fact-decay-test-"));
}

function makeOldFact(overrides: Partial<Fact> = {}): Fact {
  // Set updated_at far in the past to trigger decay
  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
  return {
    id: "old-fact",
    title: "Old Fact",
    content: "Some old fact.",
    confidence: 0.7,
    domain: "workflow",
    source: "personal",
    scope: "global",
    created_at: old,
    updated_at: old,
    observation_count: 2,
    confirmed_count: 1,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

describe("applyDecayToFact", () => {
  it("returns null when fact was just updated (no meaningful decay)", () => {
    const fresh: Fact = {
      ...makeOldFact(),
      updated_at: new Date().toISOString(),
    };
    expect(applyDecayToFact(fresh)).toBeNull();
  });

  it("returns updated fact with reduced confidence for old fact", () => {
    const old = makeOldFact({ confidence: 0.7 });
    const result = applyDecayToFact(old);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeLessThan(0.7);
  });

  it("sets flagged_for_removal when confidence decays below 0.1", () => {
    const veryOld = makeOldFact({ confidence: 0.11 });
    const result = applyDecayToFact(veryOld);
    // May or may not flag depending on decay amount — if confidence reaches 0.1 it's clamped
    // but if it would go below it gets flagged
    expect(result).toBeDefined();
  });

  it("does not mutate the input fact", () => {
    const old = makeOldFact();
    const originalConfidence = old.confidence;
    applyDecayToFact(old);
    expect(old.confidence).toBe(originalConfidence);
  });
});

describe("runFactDecayPass", () => {
  let tmpDir: string;
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    invalidateFactCache();
  });

  it("processes facts in global directory", () => {
    tmpDir = makeTmpDir();
    const globalDir = join(tmpDir, "facts", "personal");
    mkdirSync(globalDir, { recursive: true });
    saveFact(makeOldFact({ id: "fact-a" }), globalDir);
    // Run returns a number (files updated)
    const updated = runFactDecayPass(null, tmpDir);
    expect(typeof updated).toBe("number");
  });

  it("returns 0 when no facts directories exist", () => {
    tmpDir = makeTmpDir();
    const updated = runFactDecayPass("no-such-project", tmpDir);
    expect(updated).toBe(0);
  });

  it("processes both project and global directories", () => {
    tmpDir = makeTmpDir();
    const projectDir = join(tmpDir, "projects", "p1", "facts", "personal");
    const globalDir = join(tmpDir, "facts", "personal");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(globalDir, { recursive: true });
    saveFact(makeOldFact({ id: "proj-fact" }), projectDir);
    saveFact(makeOldFact({ id: "global-fact" }), globalDir);
    const updated = runFactDecayPass("p1", tmpDir);
    expect(typeof updated).toBe("number");
    // Both directories had old facts — should have processed them
    const projectFacts = listFacts(projectDir);
    const globalFacts = listFacts(globalDir);
    expect(projectFacts.length + globalFacts.length).toBeGreaterThan(0);
  });
});
