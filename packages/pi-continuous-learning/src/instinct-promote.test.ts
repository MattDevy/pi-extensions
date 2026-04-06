/**
 * Tests for /instinct-promote command.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Instinct } from "./types.js";
import {
  saveInstinct,
  loadGlobalInstincts,
  loadProjectInstincts,
} from "./instinct-store.js";
import {
  getProjectInstinctsDir,
  getGlobalInstinctsDir,
  getProjectsRegistryPath,
} from "./storage.js";
import {
  COMMAND_NAME,
  AUTO_PROMOTE_MIN_CONFIDENCE,
  AUTO_PROMOTE_MIN_PROJECTS,
  toGlobalInstinct,
  getKnownProjectIds,
  promoteById,
  findCrossProjectInstincts,
  autoPromoteInstincts,
  handleInstinctPromote,
} from "./instinct-promote.js";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "promote-test-"));
});

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test Instinct",
    trigger: "when testing",
    action: "do something",
    confidence: 0.7,
    domain: "testing",
    source: "personal",
    scope: "project",
    project_id: "proj123",
    project_name: "my-project",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-15T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 3,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

function populateProjectRegistry(projectIds: string[], base: string): void {
  const registry: Record<string, unknown> = {};
  for (const id of projectIds) {
    registry[id] = {
      id,
      name: `project-${id}`,
      root: `/repos/${id}`,
      remote: `https://github.com/user/${id}`,
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen: "2026-01-15T00:00:00.000Z",
    };
  }
  writeFileSync(
    getProjectsRegistryPath(base),
    JSON.stringify(registry, null, 2),
    "utf-8",
  );
}

function makeCtx(notify = vi.fn()): ExtensionCommandContext {
  return { cwd: baseDir, ui: { notify } } as unknown as ExtensionCommandContext;
}

// ---------------------------------------------------------------------------
// COMMAND_NAME
// ---------------------------------------------------------------------------

describe("COMMAND_NAME", () => {
  it("exports the correct command name", () => {
    expect(COMMAND_NAME).toBe("instinct-promote");
  });
});

// ---------------------------------------------------------------------------
// toGlobalInstinct
// ---------------------------------------------------------------------------

describe("toGlobalInstinct", () => {
  it("sets scope to global", () => {
    const inst = makeInstinct();
    const promoted = toGlobalInstinct(inst);
    expect(promoted.scope).toBe("global");
  });

  it("removes project_id and project_name", () => {
    const inst = makeInstinct({ project_id: "abc", project_name: "MyProject" });
    const promoted = toGlobalInstinct(inst);
    expect(promoted.project_id).toBeUndefined();
    expect(promoted.project_name).toBeUndefined();
  });

  it("does not mutate the original instinct", () => {
    const inst = makeInstinct({ scope: "project", project_id: "abc" });
    toGlobalInstinct(inst);
    expect(inst.scope).toBe("project");
    expect(inst.project_id).toBe("abc");
  });

  it("updates updated_at to a recent timestamp", () => {
    const before = new Date().toISOString();
    const inst = makeInstinct({ updated_at: "2020-01-01T00:00:00.000Z" });
    const promoted = toGlobalInstinct(inst);
    expect(promoted.updated_at >= before).toBe(true);
  });

  it("preserves all other fields", () => {
    const inst = makeInstinct({
      confidence: 0.85,
      domain: "typescript",
      title: "Keep This",
    });
    const promoted = toGlobalInstinct(inst);
    expect(promoted.confidence).toBe(0.85);
    expect(promoted.domain).toBe("typescript");
    expect(promoted.title).toBe("Keep This");
  });
});

// ---------------------------------------------------------------------------
// getKnownProjectIds
// ---------------------------------------------------------------------------

describe("getKnownProjectIds", () => {
  it("returns empty array when registry does not exist", () => {
    expect(getKnownProjectIds(baseDir)).toEqual([]);
  });

  it("returns project IDs from registry", () => {
    populateProjectRegistry(["proj-a", "proj-b"], baseDir);
    const ids = getKnownProjectIds(baseDir);
    expect(ids).toContain("proj-a");
    expect(ids).toContain("proj-b");
    expect(ids).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// promoteById
// ---------------------------------------------------------------------------

describe("promoteById", () => {
  it("returns null when instinct not found", () => {
    const result = promoteById("nonexistent", "proj123", baseDir);
    expect(result).toBeNull();
  });

  it("returns promoted instinct when found", () => {
    const projectDir = getProjectInstinctsDir("proj123", "personal", baseDir);
    mkdirSync(projectDir, { recursive: true });
    const inst = makeInstinct({ id: "my-instinct", confidence: 0.75 });
    saveInstinct(inst, projectDir);

    const promoted = promoteById("my-instinct", "proj123", baseDir);
    expect(promoted).not.toBeNull();
    expect(promoted?.id).toBe("my-instinct");
    expect(promoted?.scope).toBe("global");
  });

  it("saves promoted instinct to global personal/ directory", () => {
    const projectDir = getProjectInstinctsDir("proj123", "personal", baseDir);
    mkdirSync(projectDir, { recursive: true });
    saveInstinct(makeInstinct({ id: "saved-instinct" }), projectDir);

    promoteById("saved-instinct", "proj123", baseDir);

    const globalInstincts = loadGlobalInstincts(baseDir);
    expect(globalInstincts.some((i) => i.id === "saved-instinct")).toBe(true);
  });

  it("does not delete the project-scoped original", () => {
    const projectDir = getProjectInstinctsDir("proj123", "personal", baseDir);
    mkdirSync(projectDir, { recursive: true });
    saveInstinct(makeInstinct({ id: "keep-original" }), projectDir);

    promoteById("keep-original", "proj123", baseDir);

    const projectInstincts = loadProjectInstincts("proj123", baseDir);
    expect(projectInstincts.some((i) => i.id === "keep-original")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findCrossProjectInstincts
// ---------------------------------------------------------------------------

describe("findCrossProjectInstincts", () => {
  it("returns empty map when no projects have instincts", () => {
    const result = findCrossProjectInstincts(["p1", "p2"], baseDir);
    expect(result.size).toBe(0);
  });

  it("groups instincts by id across projects", () => {
    for (const projectId of ["p1", "p2"]) {
      const dir = getProjectInstinctsDir(projectId, "personal", baseDir);
      mkdirSync(dir, { recursive: true });
      saveInstinct(
        makeInstinct({ id: "shared-instinct", project_id: projectId }),
        dir,
      );
    }
    const dir2 = getProjectInstinctsDir("p2", "personal", baseDir);
    saveInstinct(makeInstinct({ id: "only-p2", project_id: "p2" }), dir2);

    const result = findCrossProjectInstincts(["p1", "p2"], baseDir);
    expect(result.get("shared-instinct")).toHaveLength(2);
    expect(result.get("only-p2")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// autoPromoteInstincts
// ---------------------------------------------------------------------------

describe("autoPromoteInstincts", () => {
  it("returns empty array when fewer than MIN_PROJECTS are known", () => {
    populateProjectRegistry(["only-one"], baseDir);
    const result = autoPromoteInstincts(baseDir);
    expect(result).toEqual([]);
  });

  it("does not promote instinct present in only one project", () => {
    populateProjectRegistry(["p1", "p2"], baseDir);
    const dir = getProjectInstinctsDir("p1", "personal", baseDir);
    mkdirSync(dir, { recursive: true });
    saveInstinct(makeInstinct({ id: "single-project", confidence: 0.9 }), dir);

    const result = autoPromoteInstincts(baseDir);
    expect(result).toEqual([]);
  });

  it("does not promote instinct with confidence below threshold", () => {
    populateProjectRegistry(["p1", "p2"], baseDir);
    for (const pid of ["p1", "p2"]) {
      const dir = getProjectInstinctsDir(pid, "personal", baseDir);
      mkdirSync(dir, { recursive: true });
      saveInstinct(
        makeInstinct({
          id: "low-confidence",
          confidence: 0.6,
          project_id: pid,
        }),
        dir,
      );
    }

    const result = autoPromoteInstincts(baseDir);
    expect(result).toEqual([]);
  });

  it("promotes qualifying instinct present in 2+ projects with high confidence", () => {
    populateProjectRegistry(["p1", "p2"], baseDir);
    for (const pid of ["p1", "p2"]) {
      const dir = getProjectInstinctsDir(pid, "personal", baseDir);
      mkdirSync(dir, { recursive: true });
      saveInstinct(
        makeInstinct({ id: "qualifies", confidence: 0.85, project_id: pid }),
        dir,
      );
    }

    const result = autoPromoteInstincts(baseDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("qualifies");
    expect(result[0]?.scope).toBe("global");
  });

  it("skips instincts already promoted to global", () => {
    populateProjectRegistry(["p1", "p2"], baseDir);
    for (const pid of ["p1", "p2"]) {
      const dir = getProjectInstinctsDir(pid, "personal", baseDir);
      mkdirSync(dir, { recursive: true });
      saveInstinct(
        makeInstinct({
          id: "already-global",
          confidence: 0.85,
          project_id: pid,
        }),
        dir,
      );
    }

    const globalDir = getGlobalInstinctsDir("personal", baseDir);
    mkdirSync(globalDir, { recursive: true });
    saveInstinct(
      makeInstinct({ id: "already-global", scope: "global" }),
      globalDir,
    );

    const result = autoPromoteInstincts(baseDir);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleInstinctPromote - manual promotion
// ---------------------------------------------------------------------------

describe("handleInstinctPromote - manual by ID", () => {
  it("notifies error when no project detected and ID provided", async () => {
    const notify = vi.fn();
    const ctx = makeCtx(notify);

    await handleInstinctPromote("some-id", ctx, null, baseDir);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("no active project"),
      "error",
    );
  });

  it("notifies error when instinct ID not found in project", async () => {
    const notify = vi.fn();
    const ctx = makeCtx(notify);

    await handleInstinctPromote("missing-id", ctx, "proj123", baseDir);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('"missing-id" not found'),
      "error",
    );
  });

  it("notifies success after manual promotion", async () => {
    const projectDir = getProjectInstinctsDir("proj123", "personal", baseDir);
    mkdirSync(projectDir, { recursive: true });
    saveInstinct(
      makeInstinct({ id: "promote-me", title: "My Instinct" }),
      projectDir,
    );

    const notify = vi.fn();
    const ctx = makeCtx(notify);

    await handleInstinctPromote("promote-me", ctx, "proj123", baseDir);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('"promote-me"'),
      "info",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("global scope"),
      "info",
    );
  });
});

// ---------------------------------------------------------------------------
// handleInstinctPromote - auto-promotion
// ---------------------------------------------------------------------------

describe("handleInstinctPromote - auto-promotion", () => {
  it("notifies when no instincts qualify for auto-promotion", async () => {
    const notify = vi.fn();
    const ctx = makeCtx(notify);

    await handleInstinctPromote("", ctx, null, baseDir);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("No instincts qualify"),
      "info",
    );
  });

  it("reports promoted instincts on successful auto-promotion", async () => {
    populateProjectRegistry(["pa", "pb"], baseDir);
    for (const pid of ["pa", "pb"]) {
      const dir = getProjectInstinctsDir(pid, "personal", baseDir);
      mkdirSync(dir, { recursive: true });
      saveInstinct(
        makeInstinct({
          id: "auto-candidate",
          confidence: 0.85,
          project_id: pid,
          title: "Auto Instinct",
        }),
        dir,
      );
    }

    const notify = vi.fn();
    const ctx = makeCtx(notify);

    await handleInstinctPromote("", ctx, null, baseDir);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Auto-promoted 1 instinct"),
      "info",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("auto-candidate"),
      "info",
    );
  });
});

// ---------------------------------------------------------------------------
// Constant values
// ---------------------------------------------------------------------------

describe("promotion constants", () => {
  it("AUTO_PROMOTE_MIN_CONFIDENCE is 0.8", () => {
    expect(AUTO_PROMOTE_MIN_CONFIDENCE).toBe(0.8);
  });

  it("AUTO_PROMOTE_MIN_PROJECTS is 2", () => {
    expect(AUTO_PROMOTE_MIN_PROJECTS).toBe(2);
  });
});
