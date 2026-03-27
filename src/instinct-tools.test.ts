/**
 * Tests for instinct-tools - scope-aware delete and merge (issue #11).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Instinct } from "./types.js";
import { saveInstinct } from "./instinct-store.js";
import { getProjectInstinctsDir, getGlobalInstinctsDir } from "./storage.js";
import { createInstinctDeleteTool, createInstinctMergeTool } from "./instinct-tools.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = "proj-abc123";
const PROJECT_NAME = "test-project";

let baseDir: string;
let projectInstinctsDir: string;
let globalInstinctsDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "instinct-tools-test-"));
  projectInstinctsDir = getProjectInstinctsDir(PROJECT_ID, "personal", baseDir);
  globalInstinctsDir = getGlobalInstinctsDir("personal", baseDir);
  mkdirSync(projectInstinctsDir, { recursive: true });
  mkdirSync(globalInstinctsDir, { recursive: true });
});

function makeInstinct(id: string, scope: "project" | "global", overrides: Partial<Instinct> = {}): Instinct {
  return {
    id,
    title: `Title for ${id}`,
    trigger: "when testing",
    action: "do something",
    confidence: 0.7,
    domain: "testing",
    source: "personal",
    scope,
    ...(scope === "project" ? { project_id: PROJECT_ID, project_name: PROJECT_NAME } : {}),
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    observation_count: 3,
    confirmed_count: 1,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

function seedProject(id: string, overrides: Partial<Instinct> = {}): void {
  saveInstinct(makeInstinct(id, "project", overrides), projectInstinctsDir);
}

function seedGlobal(id: string, overrides: Partial<Instinct> = {}): void {
  saveInstinct(makeInstinct(id, "global", overrides), globalInstinctsDir);
}

function projectFileExists(id: string): boolean {
  return existsSync(join(projectInstinctsDir, `${id}.md`));
}

function globalFileExists(id: string): boolean {
  return existsSync(join(globalInstinctsDir, `${id}.md`));
}

async function callDelete(params: { id: string; scope?: "project" | "global" }) {
  const tool = createInstinctDeleteTool(PROJECT_ID, baseDir);
  return tool.execute("call-id", params as never, undefined, undefined, undefined);
}

async function callMerge(params: {
  merged: { id: string; title: string; trigger: string; action: string; confidence: number; domain: string; scope: "project" | "global"; evidence?: string[] };
  delete_ids: string[];
  delete_scoped_ids?: { id: string; scope: "project" | "global" }[];
}) {
  const tool = createInstinctMergeTool(PROJECT_ID, PROJECT_NAME, baseDir);
  return tool.execute("call-id", params as never, undefined, undefined, undefined);
}

// ---------------------------------------------------------------------------
// createInstinctDeleteTool - no scope (existing behavior)
// ---------------------------------------------------------------------------

describe("createInstinctDeleteTool - without scope", () => {
  it("deletes project copy when both project and global exist (project-first priority)", async () => {
    seedProject("read-before-edit");
    seedGlobal("read-before-edit");

    await callDelete({ id: "read-before-edit" });

    expect(projectFileExists("read-before-edit")).toBe(false);
    expect(globalFileExists("read-before-edit")).toBe(true);
  });

  it("deletes global copy when only global exists", async () => {
    seedGlobal("global-only");

    await callDelete({ id: "global-only" });

    expect(globalFileExists("global-only")).toBe(false);
  });

  it("deletes project copy when only project exists", async () => {
    seedProject("project-only");

    await callDelete({ id: "project-only" });

    expect(projectFileExists("project-only")).toBe(false);
  });

  it("throws when instinct not found in either scope", async () => {
    await expect(callDelete({ id: "nonexistent" })).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------------------
// createInstinctDeleteTool - with scope (new behavior)
// ---------------------------------------------------------------------------

describe("createInstinctDeleteTool - with scope", () => {
  it("deletes only project copy when scope is 'project', leaving global intact", async () => {
    seedProject("read-before-edit");
    seedGlobal("read-before-edit");

    const result = await callDelete({ id: "read-before-edit", scope: "project" });

    expect(projectFileExists("read-before-edit")).toBe(false);
    expect(globalFileExists("read-before-edit")).toBe(true);
    expect(result.content[0]?.text).toContain("project");
  });

  it("deletes only global copy when scope is 'global', leaving project intact", async () => {
    seedProject("read-before-edit");
    seedGlobal("read-before-edit");

    const result = await callDelete({ id: "read-before-edit", scope: "global" });

    expect(globalFileExists("read-before-edit")).toBe(false);
    expect(projectFileExists("read-before-edit")).toBe(true);
    expect(result.content[0]?.text).toContain("global");
  });

  it("throws when scope is 'project' but only global exists", async () => {
    seedGlobal("global-only");

    await expect(callDelete({ id: "global-only", scope: "project" })).rejects.toThrow(
      /not found.*project/i
    );
    expect(globalFileExists("global-only")).toBe(true);
  });

  it("throws when scope is 'global' but only project exists", async () => {
    seedProject("project-only");

    await expect(callDelete({ id: "project-only", scope: "global" })).rejects.toThrow(
      /not found.*global/i
    );
    expect(projectFileExists("project-only")).toBe(true);
  });

  it("throws when scope is 'project' and no project detected", async () => {
    seedGlobal("some-instinct");
    const tool = createInstinctDeleteTool(null, baseDir);

    await expect(
      tool.execute("call-id", { id: "some-instinct", scope: "project" } as never, undefined, undefined, undefined)
    ).rejects.toThrow(/no project/i);
  });
});

// ---------------------------------------------------------------------------
// createInstinctMergeTool - delete_ids (existing behavior)
// ---------------------------------------------------------------------------

describe("createInstinctMergeTool - delete_ids", () => {
  const mergedBase = {
    id: "merged-instinct",
    title: "Merged",
    trigger: "when needed",
    action: "do it",
    confidence: 0.8,
    domain: "testing",
    scope: "global" as const,
  };

  it("saves merged instinct and deletes listed source IDs", async () => {
    seedGlobal("source-a");
    seedGlobal("source-b");

    const result = await callMerge({
      merged: mergedBase,
      delete_ids: ["source-a", "source-b"],
    });

    expect(globalFileExists("merged-instinct")).toBe(true);
    expect(globalFileExists("source-a")).toBe(false);
    expect(globalFileExists("source-b")).toBe(false);
    expect(result.details.deleted).toEqual(expect.arrayContaining(["source-a", "source-b"]));
  });

  it("skips deletion when delete_id matches merged.id (same-scope guard)", async () => {
    seedGlobal("merged-instinct");

    const result = await callMerge({
      merged: mergedBase,
      delete_ids: ["merged-instinct"],
    });

    // The merged instinct file is written fresh, so it should exist
    expect(globalFileExists("merged-instinct")).toBe(true);
    // Should not be listed in deleted since it was skipped
    expect(result.details.deleted).not.toContain("merged-instinct");
  });
});

// ---------------------------------------------------------------------------
// createInstinctMergeTool - delete_scoped_ids (new behavior)
// ---------------------------------------------------------------------------

describe("createInstinctMergeTool - delete_scoped_ids", () => {
  const mergedGlobal = {
    id: "read-before-edit",
    title: "Read Before Edit",
    trigger: "when editing",
    action: "read the file first",
    confidence: 0.85,
    domain: "workflow",
    scope: "global" as const,
  };

  it("deletes project copy via delete_scoped_ids while leaving global alone", async () => {
    seedProject("read-before-edit");
    seedGlobal("read-before-edit");

    await callMerge({
      merged: mergedGlobal,
      delete_ids: [],
      delete_scoped_ids: [{ id: "read-before-edit", scope: "project" }],
    });

    expect(projectFileExists("read-before-edit")).toBe(false);
    // Global was overwritten by the merge write (same ID), not deleted
    expect(globalFileExists("read-before-edit")).toBe(true);
  });

  it("deletes global copy via delete_scoped_ids when merging into project scope", async () => {
    seedProject("some-instinct");
    seedGlobal("some-instinct");

    const mergedProject = { ...mergedGlobal, id: "some-instinct", scope: "project" as const };

    await callMerge({
      merged: mergedProject,
      delete_ids: [],
      delete_scoped_ids: [{ id: "some-instinct", scope: "global" }],
    });

    expect(globalFileExists("some-instinct")).toBe(false);
    expect(projectFileExists("some-instinct")).toBe(true);
  });

  it("allows promoting: write global + delete project copy even when IDs match", async () => {
    seedProject("read-before-edit");
    seedGlobal("old-global-version");

    // Promote: write a new global version, delete the project copy
    await callMerge({
      merged: mergedGlobal,
      delete_ids: ["old-global-version"],
      delete_scoped_ids: [{ id: "read-before-edit", scope: "project" }],
    });

    expect(globalFileExists("read-before-edit")).toBe(true);
    expect(projectFileExists("read-before-edit")).toBe(false);
    expect(globalFileExists("old-global-version")).toBe(false);
  });

  it("throws when delete_scoped_ids targets a scope that does not contain the instinct", async () => {
    seedGlobal("global-only");

    await expect(
      callMerge({
        merged: { ...mergedGlobal, id: "result" },
        delete_ids: [],
        delete_scoped_ids: [{ id: "global-only", scope: "project" }],
      })
    ).rejects.toThrow(/not found.*project/i);
  });

  it("works with empty delete_scoped_ids", async () => {
    seedGlobal("source-x");

    await callMerge({
      merged: { ...mergedGlobal, id: "merged-result" },
      delete_ids: ["source-x"],
      delete_scoped_ids: [],
    });

    expect(globalFileExists("merged-result")).toBe(true);
    expect(globalFileExists("source-x")).toBe(false);
  });
});
