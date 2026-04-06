import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadInstinct,
  saveInstinct,
  listInstincts,
  loadProjectInstincts,
  loadGlobalInstincts,
} from "./instinct-store.js";
import type { Instinct } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_INSTINCT: Instinct = {
  id: "use-descriptive-names",
  title: "Use Descriptive Variable Names",
  trigger: "when writing new variables or functions",
  action: "Always use descriptive, intention-revealing names.",
  confidence: 0.7,
  domain: "code-quality",
  source: "personal",
  scope: "global",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  observation_count: 5,
  confirmed_count: 3,
  contradicted_count: 0,
  inactive_count: 1,
};

const PROJECT_INSTINCT: Instinct = {
  ...BASE_INSTINCT,
  id: "prefer-const-over-let",
  title: "Prefer const over let",
  trigger: "when declaring variables in TypeScript",
  action: "Use const for all declarations unless reassignment is required.",
  scope: "project",
  project_id: "abc123def456",
  project_name: "my-project",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const tmpBase = mkdtempSync(join(tmpdir(), "instinct-store-test-"));

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loadInstinct
// ---------------------------------------------------------------------------

describe("loadInstinct", () => {
  it("reads a .md file and returns a parsed Instinct", () => {
    const dir = join(tmpBase, "load-test");
    mkdirSync(dir);
    saveInstinct(BASE_INSTINCT, dir);

    const loaded = loadInstinct(join(dir, "use-descriptive-names.md"));

    expect(loaded.id).toBe("use-descriptive-names");
    expect(loaded.title).toBe("Use Descriptive Variable Names");
    expect(loaded.confidence).toBe(0.7);
  });

  it("throws if the file does not exist", () => {
    expect(() => loadInstinct(join(tmpBase, "nonexistent.md"))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// saveInstinct
// ---------------------------------------------------------------------------

describe("saveInstinct", () => {
  it("writes <dir>/<id>.md with serialized content", () => {
    const dir = join(tmpBase, "save-test");
    mkdirSync(dir);

    saveInstinct(BASE_INSTINCT, dir);

    const loaded = loadInstinct(join(dir, "use-descriptive-names.md"));
    expect(loaded.id).toBe(BASE_INSTINCT.id);
    expect(loaded.action).toBe(BASE_INSTINCT.action);
    expect(loaded.confidence).toBe(BASE_INSTINCT.confidence);
  });

  it("rejects instinct IDs with path traversal sequences", () => {
    const dir = join(tmpBase, "traversal-test");
    mkdirSync(dir);

    const malicious: Instinct = { ...BASE_INSTINCT, id: "../evil" };
    expect(() => saveInstinct(malicious, dir)).toThrow(/path traversal/);
  });

  it("rejects instinct IDs with forward slashes", () => {
    const dir = join(tmpBase, "slash-test");
    mkdirSync(dir);

    const malicious: Instinct = { ...BASE_INSTINCT, id: "sub/directory" };
    expect(() => saveInstinct(malicious, dir)).toThrow(/path traversal/);
  });
});

// ---------------------------------------------------------------------------
// listInstincts
// ---------------------------------------------------------------------------

describe("listInstincts", () => {
  it("returns all instincts in a directory", () => {
    const dir = join(tmpBase, "list-test");
    mkdirSync(dir);

    saveInstinct(BASE_INSTINCT, dir);
    saveInstinct(PROJECT_INSTINCT, dir);

    const instincts = listInstincts(dir);
    expect(instincts).toHaveLength(2);

    const ids = instincts.map((i) => i.id);
    expect(ids).toContain("use-descriptive-names");
    expect(ids).toContain("prefer-const-over-let");
  });

  it("returns empty array for non-existent directory", () => {
    const result = listInstincts(join(tmpBase, "does-not-exist"));
    expect(result).toEqual([]);
  });

  it("returns empty array for empty directory", () => {
    const dir = join(tmpBase, "empty-dir");
    mkdirSync(dir);
    expect(listInstincts(dir)).toEqual([]);
  });

  it("skips malformed instinct files without throwing", () => {
    const dir = join(tmpBase, "malformed-test");
    mkdirSync(dir);

    // Write a valid instinct
    saveInstinct(BASE_INSTINCT, dir);
    // Write a malformed file
    writeFileSync(
      join(dir, "bad-instinct.md"),
      "not valid frontmatter",
      "utf-8",
    );

    const instincts = listInstincts(dir);
    // Only the valid one is returned
    expect(instincts).toHaveLength(1);
    expect(instincts[0]?.id).toBe("use-descriptive-names");
  });
});

// ---------------------------------------------------------------------------
// loadProjectInstincts
// ---------------------------------------------------------------------------

describe("loadProjectInstincts", () => {
  it("loads instincts from projects/<projectId>/instincts/personal/", () => {
    const projectId = "test-project-id";
    const instinctsDir = join(
      tmpBase,
      "projects",
      projectId,
      "instincts",
      "personal",
    );
    mkdirSync(instinctsDir, { recursive: true });

    saveInstinct(BASE_INSTINCT, instinctsDir);

    const instincts = loadProjectInstincts(projectId, tmpBase);
    expect(instincts).toHaveLength(1);
    expect(instincts[0]?.id).toBe("use-descriptive-names");
  });

  it("returns empty array if project instincts directory does not exist", () => {
    const instincts = loadProjectInstincts("nonexistent-project", tmpBase);
    expect(instincts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// loadGlobalInstincts
// ---------------------------------------------------------------------------

describe("loadGlobalInstincts", () => {
  it("loads instincts from instincts/personal/", () => {
    const globalDir = join(tmpBase, "instincts", "personal");
    mkdirSync(globalDir, { recursive: true });

    saveInstinct(BASE_INSTINCT, globalDir);

    const instincts = loadGlobalInstincts(tmpBase);
    expect(instincts).toHaveLength(1);
    expect(instincts[0]?.id).toBe("use-descriptive-names");
  });

  it("returns empty array if global instincts directory does not exist", () => {
    const emptyBase = join(tmpBase, "empty-global-base");
    mkdirSync(emptyBase);
    const instincts = loadGlobalInstincts(emptyBase);
    expect(instincts).toEqual([]);
  });
});
