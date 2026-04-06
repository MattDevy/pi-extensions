import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveFact, loadFact, listFacts, loadProjectFacts, loadGlobalFacts, invalidateFactCache } from "./fact-store.js";
import type { Fact } from "./types.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-cl-fact-store-test-"));
}

const BASE_FACT: Fact = {
  id: "db-port",
  title: "DB Port",
  content: "The database runs on port 5432.",
  confidence: 0.7,
  domain: "database",
  source: "personal",
  scope: "project",
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-01T00:00:00.000Z",
  observation_count: 2,
  confirmed_count: 1,
  contradicted_count: 0,
  inactive_count: 0,
};

describe("saveFact / loadFact", () => {
  let tmpDir: string;
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    invalidateFactCache();
  });

  it("saves and loads a fact round-trip", () => {
    tmpDir = makeTmpDir();
    saveFact(BASE_FACT, tmpDir);
    const loaded = loadFact(join(tmpDir, "db-port.md"));
    expect(loaded.id).toBe("db-port");
    expect(loaded.content).toBe("The database runs on port 5432.");
    expect(loaded.confidence).toBeCloseTo(0.7);
  });

  it("saveFact throws on path traversal IDs", () => {
    tmpDir = makeTmpDir();
    expect(() =>
      saveFact({ ...BASE_FACT, id: "../evil" }, tmpDir),
    ).toThrow(/path traversal/);
  });
});

describe("listFacts", () => {
  let tmpDir: string;
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    invalidateFactCache();
  });

  it("returns empty array for non-existent directory", () => {
    tmpDir = makeTmpDir(); // ensure afterEach can clean up
    const missing = join(tmpDir, "does-not-exist-subdir");
    expect(listFacts(missing)).toEqual([]);
  });

  it("lists all fact files in a directory", () => {
    tmpDir = makeTmpDir();
    const fact2: Fact = { ...BASE_FACT, id: "build-cmd", content: "Use pnpm build:fast." };
    saveFact(BASE_FACT, tmpDir);
    saveFact(fact2, tmpDir);
    const facts = listFacts(tmpDir);
    expect(facts).toHaveLength(2);
  });

  it("silently skips malformed files", () => {
    tmpDir = makeTmpDir();
    writeFileSync(join(tmpDir, "broken.md"), "not valid frontmatter", "utf-8");
    saveFact(BASE_FACT, tmpDir);
    const facts = listFacts(tmpDir);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.id).toBe("db-port");
  });
});

describe("loadProjectFacts / loadGlobalFacts", () => {
  let tmpDir: string;
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    invalidateFactCache();
  });

  it("loadProjectFacts resolves to the correct path and returns facts", () => {
    tmpDir = makeTmpDir();
    const dir = join(tmpDir, "projects", "proj1", "facts", "personal");
    mkdirSync(dir, { recursive: true });
    saveFact({ ...BASE_FACT, scope: "project" }, dir);
    const facts = loadProjectFacts("proj1", tmpDir);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.id).toBe("db-port");
  });

  it("loadGlobalFacts resolves to the correct path and returns facts", () => {
    tmpDir = makeTmpDir();
    const dir = join(tmpDir, "facts", "personal");
    mkdirSync(dir, { recursive: true });
    saveFact({ ...BASE_FACT, scope: "global" }, dir);
    const facts = loadGlobalFacts(tmpDir);
    expect(facts).toHaveLength(1);
  });

  it("returns empty array when facts directory does not exist", () => {
    tmpDir = makeTmpDir();
    expect(loadProjectFacts("no-such-project", tmpDir)).toEqual([]);
    expect(loadGlobalFacts(tmpDir)).toEqual([]);
  });
});
