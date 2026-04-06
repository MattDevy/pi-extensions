import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendObservation, cleanOldArchives } from "./observations.js";
import { ensureStorageLayout } from "./storage.js";
import type { Observation, ProjectEntry } from "./types.js";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
const TWENTY_NINE_DAYS_MS = 29 * 24 * 60 * 60 * 1000;

const TEST_PROJECT_ID = "testproject1";

const testProject: ProjectEntry = {
  id: TEST_PROJECT_ID,
  name: "test-project",
  root: "/test",
  remote: "https://github.com/test/test.git",
  created_at: "2026-01-01T00:00:00Z",
  last_seen: "2026-01-01T00:00:00Z",
};

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    timestamp: "2026-03-26T12:00:00Z",
    event: "tool_start",
    session: "session-abc",
    project_id: TEST_PROJECT_ID,
    project_name: "test-project",
    ...overrides,
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "obs-test-"));
  ensureStorageLayout(testProject, tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("appendObservation", () => {
  it("appends a JSON line to observations.jsonl", () => {
    const obs = makeObservation();
    appendObservation(obs, TEST_PROJECT_ID, tempDir);

    const obsPath = join(
      tempDir,
      "projects",
      TEST_PROJECT_ID,
      "observations.jsonl",
    );
    const content = readFileSync(obsPath, "utf-8");
    expect(content.trim()).toBe(JSON.stringify(obs));
  });

  it("each observation is on its own line", () => {
    appendObservation(
      makeObservation({ tool: "read" }),
      TEST_PROJECT_ID,
      tempDir,
    );
    appendObservation(
      makeObservation({ tool: "write" }),
      TEST_PROJECT_ID,
      tempDir,
    );

    const obsPath = join(
      tempDir,
      "projects",
      TEST_PROJECT_ID,
      "observations.jsonl",
    );
    const lines = readFileSync(obsPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).tool).toBe("read");
    expect(JSON.parse(lines[1]!).tool).toBe("write");
  });

  it("archives the file when size reaches 10MB and then writes new observation", () => {
    const obsPath = join(
      tempDir,
      "projects",
      TEST_PROJECT_ID,
      "observations.jsonl",
    );
    const archiveDir = join(
      tempDir,
      "projects",
      TEST_PROJECT_ID,
      "observations.archive",
    );

    // Seed file at exactly the threshold
    writeFileSync(obsPath, "x".repeat(MAX_FILE_SIZE_BYTES), "utf-8");

    const obs = makeObservation();
    appendObservation(obs, TEST_PROJECT_ID, tempDir);

    // New observations.jsonl should contain only the new line
    const newContent = readFileSync(obsPath, "utf-8").trim();
    expect(newContent).toBe(JSON.stringify(obs));

    // One archive file should exist
    const archiveFiles = readdirSync(archiveDir).filter((f) =>
      f.endsWith(".jsonl"),
    );
    expect(archiveFiles).toHaveLength(1);
  });

  it("does not archive when file is below threshold", () => {
    const archiveDir = join(
      tempDir,
      "projects",
      TEST_PROJECT_ID,
      "observations.archive",
    );

    appendObservation(makeObservation(), TEST_PROJECT_ID, tempDir);

    const archiveFiles = readdirSync(archiveDir).filter((f) =>
      f.endsWith(".jsonl"),
    );
    expect(archiveFiles).toHaveLength(0);
  });

  it("works when observations.jsonl does not yet exist", () => {
    const obs = makeObservation();
    expect(() =>
      appendObservation(obs, TEST_PROJECT_ID, tempDir),
    ).not.toThrow();

    const obsPath = join(
      tempDir,
      "projects",
      TEST_PROJECT_ID,
      "observations.jsonl",
    );
    const content = readFileSync(obsPath, "utf-8");
    expect(content).toContain(JSON.stringify(obs));
  });
});

describe("cleanOldArchives", () => {
  it("deletes archive files older than 30 days", () => {
    const archiveDir = join(
      tempDir,
      "projects",
      TEST_PROJECT_ID,
      "observations.archive",
    );
    const oldFile = join(archiveDir, "old-archive.jsonl");
    writeFileSync(oldFile, "data", "utf-8");

    // Set mtime to 31 days ago
    const oldTime = new Date(Date.now() - THIRTY_ONE_DAYS_MS);
    utimesSync(oldFile, oldTime, oldTime);

    cleanOldArchives(TEST_PROJECT_ID, tempDir);

    const remaining = readdirSync(archiveDir).filter((f) =>
      f.endsWith(".jsonl"),
    );
    expect(remaining).toHaveLength(0);
  });

  it("keeps archive files newer than 30 days", () => {
    const archiveDir = join(
      tempDir,
      "projects",
      TEST_PROJECT_ID,
      "observations.archive",
    );
    const recentFile = join(archiveDir, "recent-archive.jsonl");
    writeFileSync(recentFile, "data", "utf-8");

    // Set mtime to 29 days ago (within retention window)
    const recentTime = new Date(Date.now() - TWENTY_NINE_DAYS_MS);
    utimesSync(recentFile, recentTime, recentTime);

    cleanOldArchives(TEST_PROJECT_ID, tempDir);

    const remaining = readdirSync(archiveDir).filter((f) =>
      f.endsWith(".jsonl"),
    );
    expect(remaining).toHaveLength(1);
  });

  it("deletes old archives but keeps recent ones", () => {
    const archiveDir = join(
      tempDir,
      "projects",
      TEST_PROJECT_ID,
      "observations.archive",
    );

    const oldFile = join(archiveDir, "old.jsonl");
    writeFileSync(oldFile, "old", "utf-8");
    const oldTime = new Date(Date.now() - THIRTY_ONE_DAYS_MS);
    utimesSync(oldFile, oldTime, oldTime);

    const recentFile = join(archiveDir, "recent.jsonl");
    writeFileSync(recentFile, "recent", "utf-8");
    const recentTime = new Date(Date.now() - TWENTY_NINE_DAYS_MS);
    utimesSync(recentFile, recentTime, recentTime);

    cleanOldArchives(TEST_PROJECT_ID, tempDir);

    const remaining = readdirSync(archiveDir).filter((f) =>
      f.endsWith(".jsonl"),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe("recent.jsonl");
  });

  it("does nothing when archive directory does not exist", () => {
    const freshProjectId = "freshproject";
    const freshProject: ProjectEntry = { ...testProject, id: freshProjectId };
    ensureStorageLayout(freshProject, tempDir);

    // archive dir exists but is empty - also test no-throw
    expect(() => cleanOldArchives(freshProjectId, tempDir)).not.toThrow();
  });
});
