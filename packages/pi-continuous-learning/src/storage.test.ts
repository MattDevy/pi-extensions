import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureStorageLayout,
  getProjectDir,
  getObservationsPath,
  getArchiveDir,
  getProjectInstinctsDir,
  getGlobalInstinctsDir,
  getProjectsRegistryPath,
} from "./storage.js";
import type { ProjectEntry } from "./types.js";

const SAMPLE_PROJECT: ProjectEntry = {
  id: "abc123def456",
  name: "my-project",
  root: "/home/user/my-project",
  remote: "git@github.com:user/my-project.git",
  created_at: "2026-01-01T00:00:00.000Z",
  last_seen: "2026-01-02T00:00:00.000Z",
};

let testBase: string;

beforeAll(() => {
  testBase = mkdtempSync(join(tmpdir(), "pi-cl-storage-test-"));
});

afterAll(() => {
  rmSync(testBase, { recursive: true, force: true });
});

describe("path helpers", () => {
  it("getProjectDir returns correct path", () => {
    expect(getProjectDir("proj1", testBase)).toBe(
      join(testBase, "projects", "proj1"),
    );
  });

  it("getObservationsPath returns correct path", () => {
    expect(getObservationsPath("proj1", testBase)).toBe(
      join(testBase, "projects", "proj1", "observations.jsonl"),
    );
  });

  it("getArchiveDir returns correct path", () => {
    expect(getArchiveDir("proj1", testBase)).toBe(
      join(testBase, "projects", "proj1", "observations.archive"),
    );
  });

  it("getProjectInstinctsDir returns correct path for personal", () => {
    expect(getProjectInstinctsDir("proj1", "personal", testBase)).toBe(
      join(testBase, "projects", "proj1", "instincts", "personal"),
    );
  });

  it("getProjectInstinctsDir returns correct path for inherited", () => {
    expect(getProjectInstinctsDir("proj1", "inherited", testBase)).toBe(
      join(testBase, "projects", "proj1", "instincts", "inherited"),
    );
  });

  it("getGlobalInstinctsDir returns correct path for personal", () => {
    expect(getGlobalInstinctsDir("personal", testBase)).toBe(
      join(testBase, "instincts", "personal"),
    );
  });

  it("getGlobalInstinctsDir returns correct path for inherited", () => {
    expect(getGlobalInstinctsDir("inherited", testBase)).toBe(
      join(testBase, "instincts", "inherited"),
    );
  });

  it("getProjectsRegistryPath returns correct path", () => {
    expect(getProjectsRegistryPath(testBase)).toBe(
      join(testBase, "projects.json"),
    );
  });
});

describe("ensureStorageLayout", () => {
  it("creates all required directories", () => {
    const base = join(testBase, "layout-test");
    ensureStorageLayout(SAMPLE_PROJECT, base);

    expect(existsSync(join(base, "instincts", "personal"))).toBe(true);
    expect(existsSync(join(base, "instincts", "inherited"))).toBe(true);

    const projectDir = join(base, "projects", SAMPLE_PROJECT.id);
    expect(existsSync(join(projectDir, "instincts", "personal"))).toBe(true);
    expect(existsSync(join(projectDir, "instincts", "inherited"))).toBe(true);
    expect(existsSync(join(projectDir, "observations.archive"))).toBe(true);
  });

  it("writes project.json on first call", () => {
    const base = join(testBase, "project-json-test");
    ensureStorageLayout(SAMPLE_PROJECT, base);

    const projectJsonPath = join(
      base,
      "projects",
      SAMPLE_PROJECT.id,
      "project.json",
    );
    expect(existsSync(projectJsonPath)).toBe(true);

    const written = JSON.parse(
      readFileSync(projectJsonPath, "utf-8"),
    ) as ProjectEntry;
    expect(written.id).toBe(SAMPLE_PROJECT.id);
    expect(written.name).toBe(SAMPLE_PROJECT.name);
    expect(written.remote).toBe(SAMPLE_PROJECT.remote);
  });

  it("does not overwrite project.json on subsequent calls", () => {
    const base = join(testBase, "no-overwrite-test");
    ensureStorageLayout(SAMPLE_PROJECT, base);

    const projectJsonPath = join(
      base,
      "projects",
      SAMPLE_PROJECT.id,
      "project.json",
    );
    const originalContent = readFileSync(projectJsonPath, "utf-8");

    // Call again with updated last_seen
    const updatedProject: ProjectEntry = {
      ...SAMPLE_PROJECT,
      last_seen: "2026-03-01T00:00:00.000Z",
    };
    ensureStorageLayout(updatedProject, base);

    const contentAfter = readFileSync(projectJsonPath, "utf-8");
    expect(contentAfter).toBe(originalContent);
  });

  it("updates projects.json registry on each call", () => {
    const base = join(testBase, "registry-test");
    ensureStorageLayout(SAMPLE_PROJECT, base);

    const registryPath = join(base, "projects.json");
    expect(existsSync(registryPath)).toBe(true);

    const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as Record<
      string,
      ProjectEntry
    >;
    expect(registry[SAMPLE_PROJECT.id]).toBeDefined();
    expect(registry[SAMPLE_PROJECT.id]!.name).toBe(SAMPLE_PROJECT.name);
  });

  it("updates registry entry on second call with newer data", () => {
    const base = join(testBase, "registry-update-test");
    ensureStorageLayout(SAMPLE_PROJECT, base);

    const updated: ProjectEntry = {
      ...SAMPLE_PROJECT,
      last_seen: "2026-06-01T00:00:00.000Z",
    };
    ensureStorageLayout(updated, base);

    const registry = JSON.parse(
      readFileSync(join(base, "projects.json"), "utf-8"),
    ) as Record<string, ProjectEntry>;
    expect(registry[SAMPLE_PROJECT.id]!.last_seen).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });

  it("preserves existing registry entries when adding a new project", () => {
    const base = join(testBase, "registry-preserve-test");
    const projectA: ProjectEntry = {
      ...SAMPLE_PROJECT,
      id: "aaaaaaaaaa01",
      name: "proj-a",
    };
    const projectB: ProjectEntry = {
      ...SAMPLE_PROJECT,
      id: "bbbbbbbbbb02",
      name: "proj-b",
    };

    ensureStorageLayout(projectA, base);
    ensureStorageLayout(projectB, base);

    const registry = JSON.parse(
      readFileSync(join(base, "projects.json"), "utf-8"),
    ) as Record<string, ProjectEntry>;
    expect(registry["aaaaaaaaaa01"]).toBeDefined();
    expect(registry["bbbbbbbbbb02"]).toBeDefined();
  });

  it("is idempotent - safe to call multiple times without error", () => {
    const base = join(testBase, "idempotent-test");
    expect(() => {
      ensureStorageLayout(SAMPLE_PROJECT, base);
      ensureStorageLayout(SAMPLE_PROJECT, base);
      ensureStorageLayout(SAMPLE_PROJECT, base);
    }).not.toThrow();
  });
});
