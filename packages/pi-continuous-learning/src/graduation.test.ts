/**
 * Tests for graduation pipeline - maturity checks, candidate scanning, TTL enforcement.
 */

import { describe, it, expect } from "vitest";
import type { Instinct } from "./types.js";
import {
  getAgeDays,
  checkMaturity,
  findAgentsMdCandidates,
  findDomainClusters,
  findSkillCandidates,
  findCommandCandidates,
  enforceTtl,
  markGraduated,
} from "./graduation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-03-27T12:00:00.000Z").getTime();

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test Instinct",
    trigger: "when testing",
    action: "do something",
    confidence: 0.8,
    domain: "testing",
    source: "personal",
    scope: "project",
    project_id: "proj123",
    project_name: "my-project",
    created_at: "2026-03-10T00:00:00.000Z", // 17 days old at NOW
    updated_at: "2026-03-20T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 4,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

function matureInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return makeInstinct({
    confidence: 0.85,
    confirmed_count: 5,
    contradicted_count: 0,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// getAgeDays
// ---------------------------------------------------------------------------

describe("getAgeDays", () => {
  it("returns correct age in days", () => {
    const inst = makeInstinct({ created_at: "2026-03-20T12:00:00.000Z" });
    expect(getAgeDays(inst, NOW)).toBeCloseTo(7, 0);
  });

  it("returns 0 for future created_at", () => {
    const inst = makeInstinct({ created_at: "2026-04-01T00:00:00.000Z" });
    expect(getAgeDays(inst, NOW)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkMaturity
// ---------------------------------------------------------------------------

describe("checkMaturity", () => {
  it("returns eligible for a fully mature instinct", () => {
    const inst = matureInstinct();
    const result = checkMaturity(inst, null, NOW);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects already graduated instincts", () => {
    const inst = matureInstinct({ graduated_to: "agents-md" });
    const result = checkMaturity(inst, null, NOW);
    expect(result.eligible).toBe(false);
    expect(result.reasons[0]).toContain("Already graduated");
  });

  it("rejects flagged-for-removal instincts", () => {
    const inst = matureInstinct({ flagged_for_removal: true });
    const result = checkMaturity(inst, null, NOW);
    expect(result.eligible).toBe(false);
  });

  it("rejects instincts younger than 7 days", () => {
    const inst = matureInstinct({
      created_at: new Date(NOW - 3 * MS_PER_DAY).toISOString(),
    });
    const result = checkMaturity(inst, null, NOW);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("Age"))).toBe(true);
  });

  it("rejects instincts with low confidence", () => {
    const inst = matureInstinct({ confidence: 0.5 });
    const result = checkMaturity(inst, null, NOW);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("Confidence"))).toBe(true);
  });

  it("rejects instincts with insufficient confirmations", () => {
    const inst = matureInstinct({ confirmed_count: 1 });
    const result = checkMaturity(inst, null, NOW);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("Confirmed"))).toBe(true);
  });

  it("rejects instincts with too many contradictions", () => {
    const inst = matureInstinct({ contradicted_count: 3 });
    const result = checkMaturity(inst, null, NOW);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("Contradicted"))).toBe(true);
  });

  it("rejects instincts duplicating AGENTS.md content", () => {
    const inst = matureInstinct({
      title: "Use Strict Mode",
      trigger: "when configuring TypeScript",
    });
    const agentsMd =
      "# Guidelines\n\n## Use Strict Mode\n\nWhen configuring TypeScript, always use strict.";
    const result = checkMaturity(inst, agentsMd, NOW);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes("duplicate"))).toBe(true);
  });

  it("collects multiple failure reasons", () => {
    const inst = makeInstinct({
      confidence: 0.3,
      confirmed_count: 0,
      contradicted_count: 5,
      created_at: new Date(NOW - 2 * MS_PER_DAY).toISOString(),
    });
    const result = checkMaturity(inst, null, NOW);
    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// findAgentsMdCandidates
// ---------------------------------------------------------------------------

describe("findAgentsMdCandidates", () => {
  it("returns empty array when no instincts qualify", () => {
    const inst = makeInstinct({ confidence: 0.3 });
    const result = findAgentsMdCandidates([inst], null, NOW);
    expect(result).toEqual([]);
  });

  it("returns qualifying instincts", () => {
    const inst = matureInstinct();
    const result = findAgentsMdCandidates([inst], null, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.target).toBe("agents-md");
    expect(result[0]?.instinct.id).toBe("test-instinct");
  });

  it("filters out non-qualifying instincts", () => {
    const good = matureInstinct({ id: "good-one" });
    const bad = makeInstinct({ id: "bad-one", confidence: 0.2 });
    const result = findAgentsMdCandidates([good, bad], null, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.instinct.id).toBe("good-one");
  });
});

// ---------------------------------------------------------------------------
// findDomainClusters
// ---------------------------------------------------------------------------

describe("findDomainClusters", () => {
  it("returns empty when no clusters meet threshold", () => {
    const inst = makeInstinct({ domain: "testing" });
    const result = findDomainClusters([inst], 3);
    expect(result).toEqual([]);
  });

  it("groups instincts by domain and filters by size", () => {
    const instincts = [
      makeInstinct({ id: "a", domain: "git" }),
      makeInstinct({ id: "b", domain: "git" }),
      makeInstinct({ id: "c", domain: "git" }),
      makeInstinct({ id: "d", domain: "testing" }),
    ];
    const result = findDomainClusters(instincts, 3);
    expect(result).toHaveLength(1);
    expect(result[0]?.domain).toBe("git");
    expect(result[0]?.instincts).toHaveLength(3);
  });

  it("excludes graduated and flagged instincts", () => {
    const instincts = [
      makeInstinct({ id: "a", domain: "git" }),
      makeInstinct({ id: "b", domain: "git", graduated_to: "agents-md" }),
      makeInstinct({ id: "c", domain: "git", flagged_for_removal: true }),
    ];
    const result = findDomainClusters(instincts, 3);
    expect(result).toEqual([]);
  });

  it("sorts clusters by size descending", () => {
    const instincts = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeInstinct({ id: `ts-${i}`, domain: "typescript" }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeInstinct({ id: `git-${i}`, domain: "git" }),
      ),
    ];
    const result = findDomainClusters(instincts, 3);
    expect(result[0]?.domain).toBe("git");
    expect(result[1]?.domain).toBe("typescript");
  });
});

describe("findSkillCandidates", () => {
  it("delegates to findDomainClusters with skill threshold", () => {
    const instincts = Array.from({ length: 3 }, (_, i) =>
      makeInstinct({ id: `inst-${i}`, domain: "git" }),
    );
    const result = findSkillCandidates(instincts);
    expect(result).toHaveLength(1);
  });
});

describe("findCommandCandidates", () => {
  it("delegates to findDomainClusters with command threshold", () => {
    const instincts = Array.from({ length: 3 }, (_, i) =>
      makeInstinct({ id: `inst-${i}`, domain: "workflow" }),
    );
    const result = findCommandCandidates(instincts);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// enforceTtl
// ---------------------------------------------------------------------------

describe("enforceTtl", () => {
  it("returns empty when no instincts exceed TTL", () => {
    const inst = makeInstinct({
      created_at: new Date(NOW - 10 * MS_PER_DAY).toISOString(),
    });
    const result = enforceTtl([inst], NOW);
    expect(result.toCull).toEqual([]);
    expect(result.toDecay).toEqual([]);
  });

  it("marks low-confidence expired instincts for culling", () => {
    const inst = makeInstinct({
      created_at: new Date(NOW - 35 * MS_PER_DAY).toISOString(),
      confidence: 0.2,
    });
    const result = enforceTtl([inst], NOW);
    expect(result.toCull).toHaveLength(1);
    expect(result.toDecay).toEqual([]);
  });

  it("marks moderate-confidence expired instincts for decay", () => {
    const inst = makeInstinct({
      created_at: new Date(NOW - 35 * MS_PER_DAY).toISOString(),
      confidence: 0.6,
    });
    const result = enforceTtl([inst], NOW);
    expect(result.toCull).toEqual([]);
    expect(result.toDecay).toHaveLength(1);
  });

  it("skips already-graduated instincts", () => {
    const inst = makeInstinct({
      created_at: new Date(NOW - 35 * MS_PER_DAY).toISOString(),
      confidence: 0.2,
      graduated_to: "agents-md",
    });
    const result = enforceTtl([inst], NOW);
    expect(result.toCull).toEqual([]);
    expect(result.toDecay).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// markGraduated
// ---------------------------------------------------------------------------

describe("markGraduated", () => {
  it("sets graduated_to and graduated_at", () => {
    const inst = makeInstinct();
    const now = new Date("2026-03-27T12:00:00.000Z");
    const result = markGraduated(inst, "agents-md", now);
    expect(result.graduated_to).toBe("agents-md");
    expect(result.graduated_at).toBe("2026-03-27T12:00:00.000Z");
  });

  it("updates updated_at", () => {
    const inst = makeInstinct({ updated_at: "2026-01-01T00:00:00.000Z" });
    const now = new Date("2026-03-27T12:00:00.000Z");
    const result = markGraduated(inst, "skill", now);
    expect(result.updated_at).toBe("2026-03-27T12:00:00.000Z");
  });

  it("does not mutate the original", () => {
    const inst = makeInstinct();
    markGraduated(inst, "command");
    expect(inst.graduated_to).toBeUndefined();
    expect(inst.graduated_at).toBeUndefined();
  });

  it("supports all graduation targets", () => {
    const targets = ["agents-md", "skill", "command"] as const;
    for (const target of targets) {
      const result = markGraduated(makeInstinct(), target);
      expect(result.graduated_to).toBe(target);
    }
  });
});
