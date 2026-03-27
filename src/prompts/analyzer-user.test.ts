import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAnalyzerUserPrompt, tailObservations, tailObservationsSince } from "./analyzer-user.js";
import type { InstalledSkill, ProjectEntry } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT: ProjectEntry = {
  id: "abc123def456",
  name: "my-project",
  root: "/home/user/my-project",
  remote: "https://github.com/user/my-project",
  created_at: "2026-01-01T00:00:00.000Z",
  last_seen: "2026-01-02T00:00:00.000Z",
};

const OBSERVATION_LINE = JSON.stringify({
  timestamp: "2026-01-01T00:00:00.000Z",
  event: "tool_start",
  session: "sess-001",
  project_id: "abc123def456",
  project_name: "my-project",
  tool: "Read",
  input: "some input",
});

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let obsPath: string;
let instinctsDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "us016-"));
  obsPath = join(tmpDir, "observations.jsonl");
  instinctsDir = join(tmpDir, "instincts", "personal");
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// tailObservations
// ---------------------------------------------------------------------------

describe("tailObservations", () => {
  it("returns empty array when file does not exist", () => {
    const result = tailObservations(join(tmpDir, "nonexistent.jsonl"));
    expect(result).toEqual([]);
  });

  it("returns all lines when count is below the limit", () => {
    const lines = [OBSERVATION_LINE, OBSERVATION_LINE, OBSERVATION_LINE];
    writeFileSync(obsPath, lines.join("\n") + "\n", "utf-8");
    const result = tailObservations(obsPath);
    expect(result).toHaveLength(3);
  });

  it("tails to the requested maxEntries when file has more lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ ...JSON.parse(OBSERVATION_LINE), session: `sess-${i}` })
    );
    writeFileSync(obsPath, lines.join("\n") + "\n", "utf-8");
    const result = tailObservations(obsPath, 3);
    expect(result).toHaveLength(3);
    // Should return the last 3 lines
    expect(result[2]).toContain("sess-9");
  });

  it("ignores blank lines in the file", () => {
    writeFileSync(obsPath, `${OBSERVATION_LINE}\n\n${OBSERVATION_LINE}\n`, "utf-8");
    const result = tailObservations(obsPath);
    expect(result).toHaveLength(2);
  });

  it("defaults to 500 max entries", () => {
    const lines = Array.from({ length: 600 }, (_, i) =>
      JSON.stringify({ ...JSON.parse(OBSERVATION_LINE), session: `s-${i}` })
    );
    writeFileSync(obsPath, lines.join("\n") + "\n", "utf-8");
    const result = tailObservations(obsPath);
    expect(result).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
// buildAnalyzerUserPrompt
// ---------------------------------------------------------------------------

describe("buildAnalyzerUserPrompt", () => {
  beforeAll(() => {
    writeFileSync(obsPath, OBSERVATION_LINE + "\n", "utf-8");
  });

  it("includes the absolute path to observations.jsonl", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT);
    expect(prompt).toContain(obsPath);
  });

  it("includes the absolute path to the instincts directory", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT);
    expect(prompt).toContain(instinctsDir);
  });

  it("includes project_id in the prompt", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT);
    expect(prompt).toContain(PROJECT.id);
  });

  it("includes project_name in the prompt", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT);
    expect(prompt).toContain(PROJECT.name);
  });

  it("includes the tailed observation content", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT);
    expect(prompt).toContain("tool_start");
  });

  it("shows placeholder when observations file does not exist", () => {
    const noObs = join(tmpDir, "missing.jsonl");
    const prompt = buildAnalyzerUserPrompt(noObs, instinctsDir, PROJECT);
    expect(prompt).toContain("no observations recorded yet");
    // Path to the (missing) file is still in the prompt
    expect(prompt).toContain(noObs);
  });

  it("returns a non-empty string", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("mentions the max tail entries limit", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT);
    expect(prompt).toContain("500");
  });
});

describe("buildAnalyzerUserPrompt - optional parameters", () => {
  beforeAll(() => {
    writeFileSync(obsPath, OBSERVATION_LINE + "\n", "utf-8");
  });

  it("includes project AGENTS.md content under Existing Guidelines when provided", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT, {
      agentsMdProject: "# Project Rules\n\n- Use TypeScript strict mode\n",
    });
    expect(prompt).toContain("## Existing Guidelines");
    expect(prompt).toContain("### Project AGENTS.md");
    expect(prompt).toContain("Use TypeScript strict mode");
  });

  it("includes global AGENTS.md content under Existing Guidelines when provided", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT, {
      agentsMdGlobal: "# Global Rules\n\n- Atomic commits\n",
    });
    expect(prompt).toContain("## Existing Guidelines");
    expect(prompt).toContain("### Global AGENTS.md");
    expect(prompt).toContain("Atomic commits");
  });

  it("includes both project and global AGENTS.md when both are provided", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT, {
      agentsMdProject: "project content",
      agentsMdGlobal: "global content",
    });
    expect(prompt).toContain("### Project AGENTS.md");
    expect(prompt).toContain("project content");
    expect(prompt).toContain("### Global AGENTS.md");
    expect(prompt).toContain("global content");
  });

  it("omits Existing Guidelines section when both are null", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT, {
      agentsMdProject: null,
      agentsMdGlobal: null,
    });
    expect(prompt).not.toContain("## Existing Guidelines");
  });

  it("omits Existing Guidelines section when options are not provided", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT);
    expect(prompt).not.toContain("## Existing Guidelines");
  });

  it("includes installed skills under Installed Skills when non-empty", () => {
    const skills: InstalledSkill[] = [
      { name: "git-workflow", description: "Git workflow assistant" },
      { name: "debug-helper", description: "Debug assistant for error analysis" },
    ];
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT, {
      installedSkills: skills,
    });
    expect(prompt).toContain("## Installed Skills");
    expect(prompt).toContain("git-workflow");
    expect(prompt).toContain("Git workflow assistant");
    expect(prompt).toContain("debug-helper");
    expect(prompt).toContain("Debug assistant for error analysis");
  });

  it("omits Installed Skills section when list is empty", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT, {
      installedSkills: [],
    });
    expect(prompt).not.toContain("## Installed Skills");
  });

  it("omits Installed Skills section when not provided", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT);
    expect(prompt).not.toContain("## Installed Skills");
  });

  it("still includes Instructions section when optional params are provided", () => {
    const prompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, PROJECT, {
      agentsMdProject: "some content",
      installedSkills: [{ name: "skill-a", description: "desc" }],
    });
    expect(prompt).toContain("## Instructions");
  });
});

describe("tailObservationsSince", () => {
  const toolStart = JSON.stringify({
    timestamp: "2026-01-01T00:00:00.000Z",
    event: "tool_start",
    session: "s1",
    project_id: "p1",
    project_name: "proj",
    tool: "bash",
    input: "ls",
  });
  const toolComplete = JSON.stringify({
    timestamp: "2026-01-01T00:00:01.000Z",
    event: "tool_complete",
    session: "s1",
    project_id: "p1",
    project_name: "proj",
    tool: "bash",
    output: "file1.ts\nfile2.ts",
    is_error: false,
  });
  const errorComplete = JSON.stringify({
    timestamp: "2026-01-01T00:00:02.000Z",
    event: "tool_complete",
    session: "s1",
    project_id: "p1",
    project_name: "proj",
    tool: "bash",
    output: "command not found",
    is_error: true,
  });
  const userBash = JSON.stringify({
    timestamp: "2026-01-01T00:00:03.000Z",
    event: "user_bash",
    session: "s1",
    project_id: "p1",
    project_name: "proj",
    command: "git status",
  });

  it("returns empty result with rawLineCount=0 when file does not exist", () => {
    const result = tailObservationsSince(join(tmpDir, "nope.jsonl"), 0);
    expect(result.lines).toEqual([]);
    expect(result.totalLineCount).toBe(0);
    expect(result.rawLineCount).toBe(0);
  });

  it("drops tool_start and strips output from non-error tool_complete by default", () => {
    const obsFile = join(tmpDir, "obs-since.jsonl");
    writeFileSync(obsFile, [toolStart, toolComplete, errorComplete, userBash].join("\n") + "\n");

    const result = tailObservationsSince(obsFile, 0);
    // tool_start dropped → 3 remain (toolComplete stripped, errorComplete kept, userBash kept)
    expect(result.rawLineCount).toBe(4);
    expect(result.lines).toHaveLength(3);

    const parsed = result.lines.map((l) => JSON.parse(l));
    expect(parsed.some((o: { event: string }) => o.event === "tool_start")).toBe(false);
    expect(parsed.find((o: { event: string }) => o.event === "tool_complete" && !(o as { is_error?: boolean }).is_error)?.output).toBeUndefined();
    expect(parsed.find((o: { event: string; is_error?: boolean }) => o.event === "tool_complete" && o.is_error)?.output).toBe("command not found");
  });

  it("skips preprocessing when preprocess=false", () => {
    const obsFile = join(tmpDir, "obs-raw.jsonl");
    writeFileSync(obsFile, [toolStart, toolComplete].join("\n") + "\n");

    const result = tailObservationsSince(obsFile, 0, 500, false);
    expect(result.lines).toHaveLength(2);
    expect(result.rawLineCount).toBe(2);
    const parsed = result.lines.map((l) => JSON.parse(l));
    expect(parsed[0].event).toBe("tool_start");
    expect(parsed[1].output).toBeDefined();
  });

  it("only returns lines since the cursor position", () => {
    const obsFile = join(tmpDir, "obs-cursor.jsonl");
    writeFileSync(obsFile, [userBash, userBash, userBash, userBash].join("\n") + "\n");

    const result = tailObservationsSince(obsFile, 2);
    expect(result.rawLineCount).toBe(2);
    expect(result.totalLineCount).toBe(4);
  });
});
