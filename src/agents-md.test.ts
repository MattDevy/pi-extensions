/**
 * Tests for agents-md.ts - reading and writing AGENTS.md files.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Instinct } from "./types.js";
import {
  readAgentsMd,
  formatInstinctAsAgentsMdEntry,
  generateAgentsMdDiff,
  appendToAgentsMd,
} from "./agents-md.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agents-md-test-"));
});

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test Instinct",
    trigger: "when testing",
    action: "Do the test thing properly.",
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

// ---------------------------------------------------------------------------
// readAgentsMd
// ---------------------------------------------------------------------------

describe("readAgentsMd", () => {
  it("returns null for non-existent file", () => {
    expect(readAgentsMd(join(tmpDir, "nope.md"))).toBeNull();
  });

  it("reads existing file content", () => {
    const filePath = join(tmpDir, "AGENTS.md");
    writeFileSync(filePath, "# Guidelines\n\nBe nice.", "utf-8");
    expect(readAgentsMd(filePath)).toBe("# Guidelines\n\nBe nice.");
  });
});

// ---------------------------------------------------------------------------
// formatInstinctAsAgentsMdEntry
// ---------------------------------------------------------------------------

describe("formatInstinctAsAgentsMdEntry", () => {
  it("formats instinct as a markdown section", () => {
    const inst = makeInstinct({ title: "Use TDD", trigger: "before writing code", action: "Write tests first." });
    const result = formatInstinctAsAgentsMdEntry(inst);
    expect(result).toContain("### Use TDD");
    expect(result).toContain("**When:** before writing code");
    expect(result).toContain("Write tests first.");
  });
});

// ---------------------------------------------------------------------------
// generateAgentsMdDiff
// ---------------------------------------------------------------------------

describe("generateAgentsMdDiff", () => {
  it("creates new file content when no existing content", () => {
    const inst = makeInstinct();
    const result = generateAgentsMdDiff(null, [inst]);
    expect(result).toContain("# Project Guidelines");
    expect(result).toContain("## Graduated Instincts");
    expect(result).toContain("### Test Instinct");
  });

  it("appends Graduated Instincts section to existing content", () => {
    const existing = "# My Project\n\nSome guidelines.";
    const inst = makeInstinct();
    const result = generateAgentsMdDiff(existing, [inst]);
    expect(result).toContain("# My Project");
    expect(result).toContain("## Graduated Instincts");
    expect(result).toContain("### Test Instinct");
  });

  it("appends to existing Graduated Instincts section", () => {
    const existing = "# My Project\n\n## Graduated Instincts\n\n### Old Entry\n\nOld content.";
    const inst = makeInstinct({ title: "New Entry" });
    const result = generateAgentsMdDiff(existing, [inst]);
    expect(result).toContain("### Old Entry");
    expect(result).toContain("### New Entry");
    // Should not duplicate the section header
    const matches = result.match(/## Graduated Instincts/g);
    expect(matches).toHaveLength(1);
  });

  it("handles multiple instincts", () => {
    const instincts = [
      makeInstinct({ title: "First" }),
      makeInstinct({ title: "Second" }),
    ];
    const result = generateAgentsMdDiff(null, instincts);
    expect(result).toContain("### First");
    expect(result).toContain("### Second");
  });
});

// ---------------------------------------------------------------------------
// appendToAgentsMd
// ---------------------------------------------------------------------------

describe("appendToAgentsMd", () => {
  it("creates file if it does not exist", () => {
    const filePath = join(tmpDir, "new-agents.md");
    const inst = makeInstinct();
    appendToAgentsMd(filePath, [inst]);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("### Test Instinct");
  });

  it("appends to existing file", () => {
    const filePath = join(tmpDir, "AGENTS.md");
    writeFileSync(filePath, "# Existing\n\nContent here.", "utf-8");
    const inst = makeInstinct({ title: "Appended" });
    appendToAgentsMd(filePath, [inst]);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Existing");
    expect(content).toContain("### Appended");
  });

  it("returns empty string for empty instincts array", () => {
    const filePath = join(tmpDir, "AGENTS.md");
    writeFileSync(filePath, "# Content", "utf-8");
    const result = appendToAgentsMd(filePath, []);
    expect(result).toBe("# Content");
  });

  it("returns the new content that was written", () => {
    const filePath = join(tmpDir, "AGENTS.md");
    const inst = makeInstinct();
    const result = appendToAgentsMd(filePath, [inst]);
    expect(result).toContain("### Test Instinct");
    expect(result).toBe(readFileSync(filePath, "utf-8"));
  });
});
