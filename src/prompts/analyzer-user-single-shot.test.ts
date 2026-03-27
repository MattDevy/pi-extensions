import { describe, it, expect } from "vitest";
import { buildSingleShotUserPrompt } from "./analyzer-user-single-shot.js";
import type { Instinct, ProjectEntry } from "../types.js";

const project: ProjectEntry = {
  id: "abc123",
  name: "test-project",
  root: "/test",
  remote: "https://github.com/test/test.git",
  created_at: "2026-01-01T00:00:00.000Z",
  last_seen: "2026-01-01T00:00:00.000Z",
};

const instinct: Instinct = {
  id: "read-before-edit",
  title: "Read before editing",
  trigger: "Before editing a file",
  action: "Read the file first",
  confidence: 0.8,
  domain: "workflow",
  scope: "global",
  source: "personal",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  observation_count: 5,
  confirmed_count: 2,
  contradicted_count: 0,
  inactive_count: 1,
};

describe("buildSingleShotUserPrompt", () => {
  it("includes project_id and project_name", () => {
    const prompt = buildSingleShotUserPrompt(project, [], []);
    expect(prompt).toContain("project_id: abc123");
    expect(prompt).toContain("project_name: test-project");
  });

  it("includes existing instincts section header", () => {
    const prompt = buildSingleShotUserPrompt(project, [instinct], []);
    expect(prompt).toContain("## Existing Instincts");
  });

  it("includes the instinct id in the prompt", () => {
    const prompt = buildSingleShotUserPrompt(project, [instinct], []);
    expect(prompt).toContain("read-before-edit");
  });

  it("shows placeholder when no instincts provided", () => {
    const prompt = buildSingleShotUserPrompt(project, [], []);
    expect(prompt).toContain("no existing instincts");
  });

  it("uses compact JSON format for instincts, not full YAML", () => {
    const prompt = buildSingleShotUserPrompt(project, [instinct], []);
    // Compact format: JSON array, no YAML frontmatter separators
    expect(prompt).not.toContain("observation_count:");
    // Should contain JSON array bracket
    expect(prompt).toContain("[{");
  });

  it("includes the observations block", () => {
    const obs = JSON.stringify({ event: "user_bash", command: "git status" });
    const prompt = buildSingleShotUserPrompt(project, [], [obs]);
    expect(prompt).toContain("user_bash");
    expect(prompt).toContain("git status");
  });

  it("shows placeholder when no observations provided", () => {
    const prompt = buildSingleShotUserPrompt(project, [], []);
    expect(prompt).toContain("no observations recorded yet");
  });

  it("includes project AGENTS.md when provided", () => {
    const prompt = buildSingleShotUserPrompt(project, [], [], {
      agentsMdProject: "## Code Style\n- Use const",
    });
    expect(prompt).toContain("## Code Style");
    expect(prompt).toContain("Project AGENTS.md");
  });

  it("includes global AGENTS.md when provided", () => {
    const prompt = buildSingleShotUserPrompt(project, [], [], {
      agentsMdGlobal: "## Global Guidelines",
    });
    expect(prompt).toContain("Global Guidelines");
    expect(prompt).toContain("Global AGENTS.md");
  });

  it("omits guidelines section when neither AGENTS.md is provided", () => {
    const prompt = buildSingleShotUserPrompt(project, [], []);
    expect(prompt).not.toContain("## Existing Guidelines");
  });

  it("includes installed skills when provided", () => {
    const prompt = buildSingleShotUserPrompt(project, [], [], {
      installedSkills: [{ name: "git-workflow", description: "Git helper" }],
    });
    expect(prompt).toContain("git-workflow");
    expect(prompt).toContain("Git helper");
    expect(prompt).toContain("## Installed Skills");
  });

  it("omits installed skills section when list is empty", () => {
    const prompt = buildSingleShotUserPrompt(project, [], [], { installedSkills: [] });
    expect(prompt).not.toContain("## Installed Skills");
  });

  it("includes instructions section", () => {
    const prompt = buildSingleShotUserPrompt(project, [], []);
    expect(prompt).toContain("## Instructions");
    expect(prompt).toContain("Return ONLY the JSON object");
  });
});
