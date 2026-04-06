import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Instinct } from "./types.js";
import {
  parseExportArgs,
  filterInstinctsForExport,
  buildExportFilename,
  handleInstinctExport,
  COMMAND_NAME,
} from "./instinct-export.js";
import { ensureStorageLayout } from "./storage.js";
import { saveInstinct } from "./instinct-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-cl-export-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test Instinct",
    trigger: "when testing",
    action: "run the tests",
    confidence: 0.7,
    domain: "testing",
    source: "personal",
    scope: "project",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 3,
    contradicted_count: 1,
    inactive_count: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// COMMAND_NAME
// ---------------------------------------------------------------------------

describe("COMMAND_NAME", () => {
  it("is instinct-export", () => {
    expect(COMMAND_NAME).toBe("instinct-export");
  });
});

// ---------------------------------------------------------------------------
// parseExportArgs
// ---------------------------------------------------------------------------

describe("parseExportArgs", () => {
  it("returns null scope and null domain for empty string", () => {
    expect(parseExportArgs("")).toEqual({ scope: null, domain: null });
  });

  it("returns null scope and null domain for whitespace-only string", () => {
    expect(parseExportArgs("   ")).toEqual({ scope: null, domain: null });
  });

  it("returns scope=project when first token is 'project'", () => {
    expect(parseExportArgs("project")).toEqual({
      scope: "project",
      domain: null,
    });
  });

  it("returns scope=global when first token is 'global'", () => {
    expect(parseExportArgs("global")).toEqual({
      scope: "global",
      domain: null,
    });
  });

  it("returns scope and domain when both are provided", () => {
    expect(parseExportArgs("project testing")).toEqual({
      scope: "project",
      domain: "testing",
    });
  });

  it("returns global scope with domain", () => {
    expect(parseExportArgs("global git")).toEqual({
      scope: "global",
      domain: "git",
    });
  });

  it("treats non-scope first token as domain (no scope)", () => {
    expect(parseExportArgs("testing")).toEqual({
      scope: null,
      domain: "testing",
    });
  });

  it("joins multi-word domain tokens when no scope prefix", () => {
    expect(parseExportArgs("git workflow")).toEqual({
      scope: null,
      domain: "git workflow",
    });
  });

  it("joins multi-word domain tokens when scope is present", () => {
    expect(parseExportArgs("project git workflow")).toEqual({
      scope: "project",
      domain: "git workflow",
    });
  });
});

// ---------------------------------------------------------------------------
// filterInstinctsForExport
// ---------------------------------------------------------------------------

describe("filterInstinctsForExport", () => {
  const instincts = [
    makeInstinct({ id: "a", scope: "project", domain: "testing" }),
    makeInstinct({ id: "b", scope: "global", domain: "testing" }),
    makeInstinct({ id: "c", scope: "project", domain: "git" }),
    makeInstinct({ id: "d", scope: "global", domain: "git" }),
  ];

  it("returns all instincts when no filters", () => {
    expect(filterInstinctsForExport(instincts, null, null)).toHaveLength(4);
  });

  it("filters by scope=project", () => {
    const result = filterInstinctsForExport(instincts, "project", null);
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.scope === "project")).toBe(true);
  });

  it("filters by scope=global", () => {
    const result = filterInstinctsForExport(instincts, "global", null);
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.scope === "global")).toBe(true);
  });

  it("filters by domain", () => {
    const result = filterInstinctsForExport(instincts, null, "testing");
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.domain === "testing")).toBe(true);
  });

  it("filters by both scope and domain", () => {
    const result = filterInstinctsForExport(instincts, "project", "testing");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a");
  });

  it("returns empty array when no instincts match", () => {
    const result = filterInstinctsForExport(instincts, "global", "nonexistent");
    expect(result).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const copy = [...instincts];
    filterInstinctsForExport(instincts, "project", null);
    expect(instincts).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// buildExportFilename
// ---------------------------------------------------------------------------

describe("buildExportFilename", () => {
  it("starts with instincts-export-", () => {
    expect(buildExportFilename()).toMatch(/^instincts-export-/);
  });

  it("ends with .json", () => {
    expect(buildExportFilename()).toMatch(/\.json$/);
  });

  it("uses provided date for timestamp", () => {
    const date = new Date("2026-03-26T17:12:20.000Z");
    const filename = buildExportFilename(date);
    expect(filename).toBe("instincts-export-20260326T171220.json");
  });

  it("produces filesystem-safe names (no colons or spaces)", () => {
    const filename = buildExportFilename(new Date("2026-12-01T09:05:03.000Z"));
    expect(filename).not.toContain(":");
    expect(filename).not.toContain(" ");
  });
});

// ---------------------------------------------------------------------------
// handleInstinctExport (integration with real files)
// ---------------------------------------------------------------------------

describe("handleInstinctExport", () => {
  const project = {
    id: "proj123456ab",
    name: "my-project",
    root: "/tmp/my-project",
    remote: "https://github.com/user/repo",
    created_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  it("writes JSON file to cwd and notifies with count", async () => {
    ensureStorageLayout(project, tmpDir);

    const instinct = makeInstinct({ id: "export-test", domain: "workflow" });
    const instinctsDir = join(
      tmpDir,
      "projects",
      project.id,
      "instincts",
      "personal",
    );
    saveInstinct(instinct, instinctsDir);

    const notifyMock = vi.fn();
    const ctx = {
      cwd: tmpDir,
      ui: { notify: notifyMock },
    } as unknown as Parameters<typeof handleInstinctExport>[1];

    await handleInstinctExport("", ctx, project.id, tmpDir);

    expect(notifyMock).toHaveBeenCalledOnce();
    const msg = notifyMock.mock.calls[0]?.[0] as string;
    expect(msg).toContain("1 instinct");
    expect(msg).toContain(tmpDir);
  });

  it("JSON file contains instinct objects matching the instinct data", async () => {
    ensureStorageLayout(project, tmpDir);

    const instinct = makeInstinct({
      id: "data-check",
      title: "Data Check Instinct",
      domain: "data",
      scope: "project",
    });
    const instinctsDir = join(
      tmpDir,
      "projects",
      project.id,
      "instincts",
      "personal",
    );
    saveInstinct(instinct, instinctsDir);

    const notifyMock = vi.fn();
    const ctx = {
      cwd: tmpDir,
      ui: { notify: notifyMock },
    } as unknown as Parameters<typeof handleInstinctExport>[1];

    await handleInstinctExport("", ctx, project.id, tmpDir);

    // Find the exported file
    const msg = notifyMock.mock.calls[0]?.[0] as string;
    const pathMatch = msg.match(/to (.+\.json)/);
    expect(pathMatch).not.toBeNull();
    const exportedPath = pathMatch![1]!;

    const content = readFileSync(exportedPath, "utf-8");
    const parsed = JSON.parse(content) as Instinct[];

    expect(Array.isArray(parsed)).toBe(true);
    const found = parsed.find((i) => i.id === "data-check");
    expect(found).toBeDefined();
    expect(found?.title).toBe("Data Check Instinct");
    expect(found?.domain).toBe("data");
  });

  it("applies scope filter to exported instincts", async () => {
    const globalDir = join(tmpDir, "instincts", "personal");
    ensureStorageLayout(project, tmpDir);

    const projectInstinct = makeInstinct({
      id: "proj-instinct",
      scope: "project",
    });
    const globalInstinct = makeInstinct({
      id: "global-instinct",
      scope: "global",
      source: "personal",
    });
    const projectInstinctsDir = join(
      tmpDir,
      "projects",
      project.id,
      "instincts",
      "personal",
    );
    saveInstinct(projectInstinct, projectInstinctsDir);
    saveInstinct(globalInstinct, globalDir);

    const notifyMock = vi.fn();
    const ctx = {
      cwd: tmpDir,
      ui: { notify: notifyMock },
    } as unknown as Parameters<typeof handleInstinctExport>[1];

    await handleInstinctExport("global", ctx, project.id, tmpDir);

    const msg = notifyMock.mock.calls[0]?.[0] as string;
    const pathMatch = msg.match(/to (.+\.json)/);
    const exportedPath = pathMatch![1]!;

    const content = readFileSync(exportedPath, "utf-8");
    const parsed = JSON.parse(content) as Instinct[];

    expect(parsed.every((i) => i.scope === "global")).toBe(true);
    expect(parsed.find((i) => i.id === "global-instinct")).toBeDefined();
    expect(parsed.find((i) => i.id === "proj-instinct")).toBeUndefined();
  });

  it("exports 0 instincts and says so when storage is empty", async () => {
    const notifyMock = vi.fn();
    const ctx = {
      cwd: tmpDir,
      ui: { notify: notifyMock },
    } as unknown as Parameters<typeof handleInstinctExport>[1];

    await handleInstinctExport("", ctx, null, tmpDir);

    const msg = notifyMock.mock.calls[0]?.[0] as string;
    expect(msg).toContain("0 instincts");
  });
});
