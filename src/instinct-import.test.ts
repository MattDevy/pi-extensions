import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Instinct } from "./types.js";
import {
  validateImportObject,
  loadImportFile,
  partitionByDuplicates,
  getTargetDir,
  handleInstinctImport,
  COMMAND_NAME,
} from "./instinct-import.js";
import { ensureStorageLayout } from "./storage.js";
import { saveInstinct } from "./instinct-store.js";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-cl-import-"));
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

function makeMockCtx(cwd: string) {
  const notifyMock = { calls: [] as Array<[string, string]> };
  const ctx = {
    cwd,
    ui: {
      notify: (msg: string, level: string) => {
        notifyMock.calls.push([msg, level]);
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notifyMock };
}

function writeImportFile(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// COMMAND_NAME
// ---------------------------------------------------------------------------

describe("COMMAND_NAME", () => {
  it("is instinct-import", () => {
    expect(COMMAND_NAME).toBe("instinct-import");
  });
});

// ---------------------------------------------------------------------------
// validateImportObject
// ---------------------------------------------------------------------------

describe("validateImportObject", () => {
  it("returns null for a valid instinct object", () => {
    const inst = makeInstinct();
    expect(validateImportObject(inst, 0)).toBeNull();
  });

  it("returns error for non-object", () => {
    expect(validateImportObject("string", 0)?.reason).toContain(
      "not an object",
    );
    expect(validateImportObject(42, 1)?.reason).toContain("not an object");
    expect(validateImportObject(null, 2)?.reason).toContain("not an object");
    expect(validateImportObject([1, 2], 3)?.reason).toContain("not an object");
  });

  it("returns error for missing required fields", () => {
    const partial = { id: "test-id", title: "Title" };
    const err = validateImportObject(partial, 0);
    expect(err).not.toBeNull();
    expect(err?.reason).toContain("missing required field");
  });

  it("returns error for invalid id format", () => {
    const inst = makeInstinct({ id: "Invalid_ID" });
    const err = validateImportObject(inst, 0);
    expect(err).not.toBeNull();
    expect(err?.reason).toContain("invalid id");
  });

  it("returns error for id with special characters", () => {
    const inst = makeInstinct({ id: "has..dots" });
    const err = validateImportObject(inst, 0);
    expect(err).not.toBeNull();
  });

  it("accepts kebab-case ids with numbers", () => {
    const inst = makeInstinct({ id: "test-123-abc" });
    expect(validateImportObject(inst, 0)).toBeNull();
  });

  it("records the index in the error", () => {
    const err = validateImportObject(null, 5);
    expect(err?.index).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// loadImportFile
// ---------------------------------------------------------------------------

describe("loadImportFile", () => {
  it("loads valid instinct array", () => {
    const instincts = [
      makeInstinct({ id: "first-inst" }),
      makeInstinct({ id: "second-inst" }),
    ];
    const filePath = join(tmpDir, "import.json");
    writeImportFile(filePath, instincts);

    const result = loadImportFile(filePath);
    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(0);
  });

  it("separates invalid entries from valid ones", () => {
    const data = [
      makeInstinct({ id: "valid-inst" }),
      { id: "Invalid ID", title: "bad" }, // invalid
      makeInstinct({ id: "another-valid" }),
    ];
    const filePath = join(tmpDir, "mixed.json");
    writeImportFile(filePath, data);

    const result = loadImportFile(filePath);
    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.index).toBe(1);
  });

  it("throws when file contains non-array JSON", () => {
    const filePath = join(tmpDir, "not-array.json");
    writeFileSync(filePath, JSON.stringify({ key: "value" }), "utf-8");

    expect(() => loadImportFile(filePath)).toThrow("JSON array");
  });

  it("throws when file contains invalid JSON", () => {
    const filePath = join(tmpDir, "bad.json");
    writeFileSync(filePath, "not json at all", "utf-8");

    expect(() => loadImportFile(filePath)).toThrow();
  });

  it("returns empty valid and invalid arrays for empty array file", () => {
    const filePath = join(tmpDir, "empty.json");
    writeImportFile(filePath, []);

    const result = loadImportFile(filePath);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// partitionByDuplicates
// ---------------------------------------------------------------------------

describe("partitionByDuplicates", () => {
  const project = {
    id: "proj123456ab",
    name: "my-project",
    root: "/tmp/my-project",
    remote: "https://github.com/user/repo",
    created_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  it("returns all instincts in toImport when no duplicates exist", () => {
    ensureStorageLayout(project, tmpDir);
    const instincts = [makeInstinct({ id: "new-instinct" })];

    const result = partitionByDuplicates(instincts, project.id, tmpDir);
    expect(result.toImport).toHaveLength(1);
    expect(result.duplicates).toHaveLength(0);
  });

  it("detects duplicates in global inherited dir", () => {
    const globalDir = join(tmpDir, "instincts", "inherited");
    mkdirSync(globalDir, { recursive: true });

    const existing = makeInstinct({ id: "existing-global", scope: "global" });
    saveInstinct(existing, globalDir);

    const instincts = [makeInstinct({ id: "existing-global" })];
    const result = partitionByDuplicates(instincts, null, tmpDir);

    expect(result.toImport).toHaveLength(0);
    expect(result.duplicates).toContain("existing-global");
  });

  it("detects duplicates in project inherited dir", () => {
    ensureStorageLayout(project, tmpDir);
    const projectDir = join(
      tmpDir,
      "projects",
      project.id,
      "instincts",
      "inherited",
    );
    mkdirSync(projectDir, { recursive: true });

    const existing = makeInstinct({ id: "existing-project" });
    saveInstinct(existing, projectDir);

    const instincts = [
      makeInstinct({ id: "existing-project" }),
      makeInstinct({ id: "new-one" }),
    ];
    const result = partitionByDuplicates(instincts, project.id, tmpDir);

    expect(result.toImport).toHaveLength(1);
    expect(result.toImport[0]?.id).toBe("new-one");
    expect(result.duplicates).toContain("existing-project");
  });

  it("handles null projectId gracefully", () => {
    const instincts = [makeInstinct({ id: "inst-no-project" })];
    const result = partitionByDuplicates(instincts, null, tmpDir);
    expect(result.toImport).toHaveLength(1);
    expect(result.duplicates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getTargetDir
// ---------------------------------------------------------------------------

describe("getTargetDir", () => {
  it("returns global inherited dir for global-scoped instincts", () => {
    const inst = makeInstinct({ scope: "global" });
    const dir = getTargetDir(inst, "proj123456ab", tmpDir);
    expect(dir).toContain("instincts/inherited");
    expect(dir).not.toContain("projects");
  });

  it("returns project inherited dir for project-scoped instincts", () => {
    const inst = makeInstinct({ scope: "project" });
    const dir = getTargetDir(inst, "proj123456ab", tmpDir);
    expect(dir).toContain("projects");
    expect(dir).toContain("inherited");
  });

  it("falls back to global dir when project-scoped but no projectId", () => {
    const inst = makeInstinct({ scope: "project" });
    const dir = getTargetDir(inst, null, tmpDir);
    expect(dir).not.toContain("projects");
    expect(dir).toContain("instincts/inherited");
  });
});

// ---------------------------------------------------------------------------
// handleInstinctImport (integration)
// ---------------------------------------------------------------------------

describe("handleInstinctImport", () => {
  const project = {
    id: "proj123456ab",
    name: "my-project",
    root: "/tmp/my-project",
    remote: "https://github.com/user/repo",
    created_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  it("imports valid instincts and notifies count", async () => {
    ensureStorageLayout(project, tmpDir);

    const instincts = [
      makeInstinct({ id: "import-one", scope: "global" }),
      makeInstinct({ id: "import-two", scope: "global" }),
    ];
    const importPath = join(tmpDir, "batch.json");
    writeImportFile(importPath, instincts);

    const { ctx, notifyMock } = makeMockCtx(tmpDir);

    await handleInstinctImport(importPath, ctx, project.id, tmpDir);

    expect(notifyMock.calls).toHaveLength(1);
    const msg = notifyMock.calls[0]?.[0] ?? "";
    expect(msg).toContain("2 instincts");
  });

  it("saves project-scoped instincts to project inherited dir", async () => {
    ensureStorageLayout(project, tmpDir);

    const instinct = makeInstinct({ id: "proj-import", scope: "project" });
    const importPath = join(tmpDir, "proj.json");
    writeImportFile(importPath, [instinct]);

    const { ctx } = makeMockCtx(tmpDir);
    await handleInstinctImport(importPath, ctx, project.id, tmpDir);

    const expectedDir = join(
      tmpDir,
      "projects",
      project.id,
      "instincts",
      "inherited",
    );
    const filePath = join(expectedDir, "proj-import.md");
    const { existsSync } = await import("node:fs");
    expect(existsSync(filePath)).toBe(true);
  });

  it("saves global-scoped instincts to global inherited dir", async () => {
    ensureStorageLayout(project, tmpDir);

    const instinct = makeInstinct({ id: "global-import", scope: "global" });
    const importPath = join(tmpDir, "global.json");
    writeImportFile(importPath, [instinct]);

    const { ctx } = makeMockCtx(tmpDir);
    await handleInstinctImport(importPath, ctx, project.id, tmpDir);

    const expectedDir = join(tmpDir, "instincts", "inherited");
    const filePath = join(expectedDir, "global-import.md");
    const { existsSync } = await import("node:fs");
    expect(existsSync(filePath)).toBe(true);
  });

  it("warns about duplicate IDs and skips them", async () => {
    ensureStorageLayout(project, tmpDir);

    // Pre-save a duplicate
    const existingDir = join(tmpDir, "instincts", "inherited");
    mkdirSync(existingDir, { recursive: true });
    const dup = makeInstinct({ id: "dup-instinct", scope: "global" });
    saveInstinct(dup, existingDir);

    const importPath = join(tmpDir, "dup.json");
    writeImportFile(importPath, [
      makeInstinct({ id: "dup-instinct", scope: "global" }),
      makeInstinct({ id: "fresh-instinct", scope: "global" }),
    ]);

    const { ctx, notifyMock } = makeMockCtx(tmpDir);
    await handleInstinctImport(importPath, ctx, project.id, tmpDir);

    const msg = notifyMock.calls[0]?.[0] ?? "";
    expect(msg).toContain("1 instinct"); // only fresh-instinct imported
    expect(msg).toContain("dup-instinct");
    expect(msg).toContain("Skipped");
  });

  it("reports invalid entries in the summary", async () => {
    ensureStorageLayout(project, tmpDir);

    const importPath = join(tmpDir, "invalid.json");
    writeImportFile(importPath, [
      makeInstinct({ id: "good-one" }),
      { id: "Bad ID!!", title: "broken" }, // invalid
    ]);

    const { ctx, notifyMock } = makeMockCtx(tmpDir);
    await handleInstinctImport(importPath, ctx, project.id, tmpDir);

    const msg = notifyMock.calls[0]?.[0] ?? "";
    expect(msg).toContain("Skipped");
    expect(msg).toContain("invalid");
  });

  it("notifies error when file does not exist", async () => {
    const { ctx, notifyMock } = makeMockCtx(tmpDir);
    await handleInstinctImport(
      "/nonexistent/path.json",
      ctx,
      project.id,
      tmpDir,
    );

    const [msg, level] = notifyMock.calls[0] ?? ["", ""];
    expect(level).toBe("error");
    expect(msg).toContain("not found");
  });

  it("notifies error when file contains invalid JSON", async () => {
    const badPath = join(tmpDir, "bad.json");
    writeFileSync(badPath, "not json", "utf-8");

    const { ctx, notifyMock } = makeMockCtx(tmpDir);
    await handleInstinctImport(badPath, ctx, project.id, tmpDir);

    const [, level] = notifyMock.calls[0] ?? ["", ""];
    expect(level).toBe("error");
  });
});
