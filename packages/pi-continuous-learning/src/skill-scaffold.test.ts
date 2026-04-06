/**
 * Tests for skill-scaffold.ts - skill generation from instinct clusters.
 */

import { describe, it, expect } from "vitest";
import type { Instinct } from "./types.js";
import type { DomainCluster } from "./graduation.js";
import {
  generateSkillScaffold,
  generateAllSkillScaffolds,
} from "./skill-scaffold.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-15T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 3,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

function makeCluster(domain: string, count: number): DomainCluster {
  return {
    domain,
    instincts: Array.from({ length: count }, (_, i) =>
      makeInstinct({
        id: `${domain}-${i}`,
        title: `${domain} Practice ${i}`,
        domain,
        confidence: 0.9 - i * 0.05,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// generateSkillScaffold
// ---------------------------------------------------------------------------

describe("generateSkillScaffold", () => {
  it("generates a valid skill scaffold", () => {
    const cluster = makeCluster("git", 3);
    const scaffold = generateSkillScaffold(cluster);
    expect(scaffold.name).toBe("git");
    expect(scaffold.domain).toBe("git");
    expect(scaffold.sourceInstinctIds).toHaveLength(3);
  });

  it("includes all instinct titles in content", () => {
    const cluster = makeCluster("testing", 3);
    const scaffold = generateSkillScaffold(cluster);
    expect(scaffold.content).toContain("testing Practice 0");
    expect(scaffold.content).toContain("testing Practice 1");
    expect(scaffold.content).toContain("testing Practice 2");
  });

  it("sorts instincts by confidence descending", () => {
    const cluster = makeCluster("workflow", 3);
    const scaffold = generateSkillScaffold(cluster);
    const ids = scaffold.sourceInstinctIds;
    expect(ids[0]).toBe("workflow-0"); // highest confidence
  });

  it("generates valid markdown content", () => {
    const cluster = makeCluster("git", 3);
    const scaffold = generateSkillScaffold(cluster);
    expect(scaffold.content).toContain("# git Skill");
    expect(scaffold.content).toContain("## Description");
    expect(scaffold.content).toContain("## Practices");
  });

  it("sanitizes domain name for skill name", () => {
    const cluster = makeCluster("UI Design", 3);
    const scaffold = generateSkillScaffold(cluster);
    expect(scaffold.name).toBe("ui-design");
  });
});

// ---------------------------------------------------------------------------
// generateAllSkillScaffolds
// ---------------------------------------------------------------------------

describe("generateAllSkillScaffolds", () => {
  it("generates scaffolds for all clusters", () => {
    const clusters = [makeCluster("git", 3), makeCluster("testing", 4)];
    const scaffolds = generateAllSkillScaffolds(clusters);
    expect(scaffolds).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(generateAllSkillScaffolds([])).toEqual([]);
  });
});
