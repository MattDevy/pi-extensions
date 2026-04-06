/**
 * Tests for command-scaffold.ts - command generation from instinct clusters.
 */

import { describe, it, expect } from "vitest";
import type { Instinct } from "./types.js";
import type { DomainCluster } from "./graduation.js";
import {
  generateCommandScaffold,
  generateAllCommandScaffolds,
} from "./command-scaffold.js";

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
        title: `${domain} Step ${i}`,
        domain,
        confidence: 0.9 - i * 0.05,
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// generateCommandScaffold
// ---------------------------------------------------------------------------

describe("generateCommandScaffold", () => {
  it("generates a valid command scaffold", () => {
    const cluster = makeCluster("deploy", 3);
    const scaffold = generateCommandScaffold(cluster);
    expect(scaffold.name).toBe("deploy");
    expect(scaffold.domain).toBe("deploy");
    expect(scaffold.sourceInstinctIds).toHaveLength(3);
  });

  it("includes command registration example", () => {
    const cluster = makeCluster("review", 3);
    const scaffold = generateCommandScaffold(cluster);
    expect(scaffold.content).toContain('pi.registerCommand("review"');
    expect(scaffold.content).toContain("## Implementation Notes");
  });

  it("includes all instinct steps in content", () => {
    const cluster = makeCluster("deploy", 3);
    const scaffold = generateCommandScaffold(cluster);
    expect(scaffold.content).toContain("deploy Step 0");
    expect(scaffold.content).toContain("deploy Step 1");
    expect(scaffold.content).toContain("deploy Step 2");
  });

  it("sorts instincts by confidence descending", () => {
    const cluster = makeCluster("workflow", 3);
    const scaffold = generateCommandScaffold(cluster);
    const ids = scaffold.sourceInstinctIds;
    expect(ids[0]).toBe("workflow-0");
  });

  it("generates valid markdown with command syntax", () => {
    const cluster = makeCluster("lint", 3);
    const scaffold = generateCommandScaffold(cluster);
    expect(scaffold.content).toContain("# /lint Command");
    expect(scaffold.content).toContain("## Command: `/lint`");
  });
});

// ---------------------------------------------------------------------------
// generateAllCommandScaffolds
// ---------------------------------------------------------------------------

describe("generateAllCommandScaffolds", () => {
  it("generates scaffolds for all clusters", () => {
    const clusters = [makeCluster("deploy", 3), makeCluster("review", 4)];
    const scaffolds = generateAllCommandScaffolds(clusters);
    expect(scaffolds).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(generateAllCommandScaffolds([])).toEqual([]);
  });
});
