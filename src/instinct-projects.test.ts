import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectEntry } from "./types.js";
import {
  COMMAND_NAME,
  readProjectsRegistry,
  countProjectInstincts,
  formatDate,
  formatProjectsOutput,
  handleInstinctProjects,
} from "./instinct-projects.js";
import { ensureStorageLayout } from "./storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-cl-projects-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeProject(overrides: Partial<ProjectEntry> = {}): ProjectEntry {
  return {
    id: "abc123def456",
    name: "my-project",
    root: "/home/user/my-project",
    remote: "https://github.com/user/my-project.git",
    created_at: "2026-01-01T00:00:00.000Z",
    last_seen: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeMockCtx(baseDir: string): {
  ui: { notify: ReturnType<typeof vi.fn> };
  cwd: string;
} {
  return { ui: { notify: vi.fn() }, cwd: baseDir };
}

// ---------------------------------------------------------------------------
// COMMAND_NAME
// ---------------------------------------------------------------------------

describe("COMMAND_NAME", () => {
  it("exports instinct-projects", () => {
    expect(COMMAND_NAME).toBe("instinct-projects");
  });
});

// ---------------------------------------------------------------------------
// readProjectsRegistry
// ---------------------------------------------------------------------------

describe("readProjectsRegistry", () => {
  it("returns empty record when projects.json does not exist", () => {
    const result = readProjectsRegistry(tmpDir);
    expect(result).toEqual({});
  });

  it("returns parsed registry from projects.json", () => {
    const project = makeProject();
    const registry = { [project.id]: project };
    writeFileSync(
      join(tmpDir, "projects.json"),
      JSON.stringify(registry),
      "utf-8",
    );
    const result = readProjectsRegistry(tmpDir);
    expect(result).toEqual(registry);
  });

  it("returns empty record on invalid JSON", () => {
    writeFileSync(join(tmpDir, "projects.json"), "not-json", "utf-8");
    const result = readProjectsRegistry(tmpDir);
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// countProjectInstincts
// ---------------------------------------------------------------------------

describe("countProjectInstincts", () => {
  it("returns 0 when instincts directory does not exist", () => {
    const count = countProjectInstincts("nonexistent-id", tmpDir);
    expect(count).toBe(0);
  });

  it("returns 0 when instincts directory is empty", () => {
    const project = makeProject();
    ensureStorageLayout(project, tmpDir);
    const count = countProjectInstincts(project.id, tmpDir);
    expect(count).toBe(0);
  });

  it("counts only .md files in personal instincts directory", () => {
    const project = makeProject();
    ensureStorageLayout(project, tmpDir);
    const instinctsDir = join(
      tmpDir,
      "projects",
      project.id,
      "instincts",
      "personal",
    );
    writeFileSync(join(instinctsDir, "first-instinct.md"), "# test", "utf-8");
    writeFileSync(join(instinctsDir, "second-instinct.md"), "# test", "utf-8");
    writeFileSync(join(instinctsDir, "README.txt"), "not an instinct", "utf-8");
    const count = countProjectInstincts(project.id, tmpDir);
    expect(count).toBe(2);
  });

  it("does not count inherited instincts", () => {
    const project = makeProject();
    ensureStorageLayout(project, tmpDir);
    const inheritedDir = join(
      tmpDir,
      "projects",
      project.id,
      "instincts",
      "inherited",
    );
    writeFileSync(
      join(inheritedDir, "inherited-instinct.md"),
      "# test",
      "utf-8",
    );
    const count = countProjectInstincts(project.id, tmpDir);
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  it("returns a non-empty string for a valid ISO date", () => {
    const result = formatDate("2026-03-01T00:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns the raw string for an invalid date", () => {
    const result = formatDate("not-a-date");
    expect(result).toBe("Invalid Date");
  });
});

// ---------------------------------------------------------------------------
// formatProjectsOutput
// ---------------------------------------------------------------------------

describe("formatProjectsOutput", () => {
  it("returns no-projects message for empty registry", () => {
    const output = formatProjectsOutput({}, tmpDir);
    expect(output).toBe("No projects found.");
  });

  it("includes project name and ID", () => {
    const project = makeProject();
    ensureStorageLayout(project, tmpDir);
    const output = formatProjectsOutput({ [project.id]: project }, tmpDir);
    expect(output).toContain(project.name);
    expect(output).toContain(project.id);
  });

  it("displays correct instinct count", () => {
    const project = makeProject();
    ensureStorageLayout(project, tmpDir);
    const instinctsDir = join(
      tmpDir,
      "projects",
      project.id,
      "instincts",
      "personal",
    );
    writeFileSync(join(instinctsDir, "one.md"), "# test", "utf-8");
    writeFileSync(join(instinctsDir, "two.md"), "# test", "utf-8");
    const output = formatProjectsOutput({ [project.id]: project }, tmpDir);
    expect(output).toContain("Instincts: 2");
  });

  it("sorts projects by last_seen descending (most recent first)", () => {
    const older = makeProject({
      id: "older000001",
      name: "older-project",
      last_seen: "2026-01-01T00:00:00.000Z",
    });
    const newer = makeProject({
      id: "newer000001",
      name: "newer-project",
      last_seen: "2026-03-01T00:00:00.000Z",
    });
    const registry = { [older.id]: older, [newer.id]: newer };
    const output = formatProjectsOutput(registry, tmpDir);
    const olderIdx = output.indexOf("older-project");
    const newerIdx = output.indexOf("newer-project");
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("shows total project count", () => {
    const p1 = makeProject({ id: "proj111111a", name: "project-one" });
    const p2 = makeProject({ id: "proj222222b", name: "project-two" });
    const output = formatProjectsOutput({ [p1.id]: p1, [p2.id]: p2 }, tmpDir);
    expect(output).toContain("Total: 2 projects");
  });

  it("uses singular form for one project", () => {
    const project = makeProject();
    const output = formatProjectsOutput({ [project.id]: project }, tmpDir);
    expect(output).toContain("Total: 1 project");
    expect(output).not.toContain("1 projects");
  });
});

// ---------------------------------------------------------------------------
// handleInstinctProjects
// ---------------------------------------------------------------------------

describe("handleInstinctProjects", () => {
  it("calls ctx.ui.notify with formatted output", async () => {
    const project = makeProject();
    ensureStorageLayout(project, tmpDir);
    const ctx = makeMockCtx(tmpDir) as unknown as Parameters<
      typeof handleInstinctProjects
    >[1];
    await handleInstinctProjects("", ctx, tmpDir);
    expect(
      (ctx as unknown as ReturnType<typeof makeMockCtx>).ui.notify,
    ).toHaveBeenCalledOnce();
    const [message, level] = (ctx as unknown as ReturnType<typeof makeMockCtx>)
      .ui.notify.mock.calls[0] as [string, string];
    expect(typeof message).toBe("string");
    expect(level).toBe("info");
  });

  it("shows no-projects message when registry is empty", async () => {
    const ctx = makeMockCtx(tmpDir) as unknown as Parameters<
      typeof handleInstinctProjects
    >[1];
    await handleInstinctProjects("", ctx, tmpDir);
    const [message] = (ctx as unknown as ReturnType<typeof makeMockCtx>).ui
      .notify.mock.calls[0] as [string, string];
    expect(message).toBe("No projects found.");
  });
});
