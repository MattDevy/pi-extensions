import { describe, it, expect } from "vitest";
import { buildConsolidateUserPrompt } from "./consolidate-user.js";
import type { Instinct } from "../types.js";

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test instinct",
    trigger: "When testing code",
    action: "Run the test suite first",
    confidence: 0.7,
    domain: "testing",
    source: "personal",
    scope: "project",
    project_id: "abc123",
    project_name: "test-project",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 2,
    contradicted_count: 0,
    inactive_count: 1,
    ...overrides,
  };
}

describe("buildConsolidateUserPrompt", () => {
  it("includes instinct data in prompt", () => {
    const instincts = [
      makeInstinct({ id: "inst-a", trigger: "When writing tests" }),
      makeInstinct({ id: "inst-b", trigger: "When debugging errors" }),
    ];
    const prompt = buildConsolidateUserPrompt(instincts);
    expect(prompt).toContain("inst-a");
    expect(prompt).toContain("inst-b");
    expect(prompt).toContain("Total instincts: 2");
  });

  it("shows empty state when no instincts", () => {
    const prompt = buildConsolidateUserPrompt([]);
    expect(prompt).toContain("(no instincts)");
    expect(prompt).toContain("Total instincts: 0");
  });

  it("includes AGENTS.md when provided", () => {
    const prompt = buildConsolidateUserPrompt([makeInstinct()], {
      agentsMdProject: "# Project Rules\nUse strict mode",
      agentsMdGlobal: "# Global Rules\nConventional commits",
    });
    expect(prompt).toContain("Use strict mode");
    expect(prompt).toContain("Conventional commits");
    expect(prompt).toContain("Project AGENTS.md");
    expect(prompt).toContain("Global AGENTS.md");
  });

  it("includes installed skills when provided", () => {
    const prompt = buildConsolidateUserPrompt([makeInstinct()], {
      installedSkills: [{ name: "git-workflow", description: "Git helper" }],
    });
    expect(prompt).toContain("git-workflow");
    expect(prompt).toContain("Git helper");
  });

  it("includes project context when provided", () => {
    const prompt = buildConsolidateUserPrompt([makeInstinct()], {
      projectId: "abc123",
      projectName: "my-project",
    });
    expect(prompt).toContain("abc123");
    expect(prompt).toContain("my-project");
  });
});
