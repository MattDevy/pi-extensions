import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getBaseDir,
  getStatePath,
  getHistoryPath,
  ensureStorageLayout,
  loadState,
  saveState,
  clearState,
  appendCycleRecord,
} from "./storage.js";
import { createInitialState } from "./state-machine.js";
import type { TddCycleRecord } from "./types.js";

const tmpBase = mkdtempSync(join(tmpdir(), "rg-storage-test-"));

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

describe("path helpers", () => {
  it("getBaseDir returns a path under ~/.pi/red-green", () => {
    const base = getBaseDir();
    expect(base).toContain(".pi");
    expect(base).toContain("red-green");
  });

  it("getStatePath returns state.json under base", () => {
    const p = getStatePath(tmpBase);
    expect(p).toBe(join(tmpBase, "state.json"));
  });

  it("getHistoryPath returns history.jsonl under base", () => {
    const p = getHistoryPath(tmpBase);
    expect(p).toBe(join(tmpBase, "history.jsonl"));
  });

});

describe("ensureStorageLayout", () => {
  it("creates base directory if missing", () => {
    const dir = join(tmpBase, "ensure-test");
    expect(existsSync(dir)).toBe(false);
    ensureStorageLayout(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it("is idempotent", () => {
    const dir = join(tmpBase, "ensure-idem");
    ensureStorageLayout(dir);
    ensureStorageLayout(dir);
    expect(existsSync(dir)).toBe(true);
  });
});

describe("loadState / saveState / clearState", () => {
  it("returns null when state file does not exist", () => {
    const dir = join(tmpBase, "no-state");
    ensureStorageLayout(dir);
    expect(loadState(dir)).toBeNull();
  });

  it("round-trips state through save and load", () => {
    const dir = join(tmpBase, "roundtrip");
    ensureStorageLayout(dir);
    const state = createInitialState("Add auth", "sess-1", "proj-1");
    saveState(state, dir);
    const loaded = loadState(dir);
    expect(loaded).toEqual(state);
  });

  it("clearState removes the state file", () => {
    const dir = join(tmpBase, "clear-test");
    ensureStorageLayout(dir);
    const state = createInitialState("Task", "s", "p");
    saveState(state, dir);
    expect(loadState(dir)).not.toBeNull();
    clearState(dir);
    expect(loadState(dir)).toBeNull();
  });

  it("clearState is safe when file does not exist", () => {
    const dir = join(tmpBase, "clear-noop");
    ensureStorageLayout(dir);
    expect(() => clearState(dir)).not.toThrow();
  });
});

describe("appendCycleRecord", () => {
  it("appends JSONL lines to history file", () => {
    const dir = join(tmpBase, "history-test");
    ensureStorageLayout(dir);
    const record: TddCycleRecord = {
      task: "Add auth",
      session_id: "sess-1",
      project_id: "proj-1",
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T01:00:00Z",
      final_phase: "complete",
      test_files: ["auth.test.ts"],
      impl_files: ["auth.ts"],
      phase_history: [
        { phase: "red", entered_at: "2026-01-01T00:00:00Z" },
        { phase: "green", entered_at: "2026-01-01T00:15:00Z" },
        { phase: "refactor", entered_at: "2026-01-01T00:30:00Z" },
        { phase: "complete", entered_at: "2026-01-01T00:45:00Z" },
      ],
    };

    appendCycleRecord(record, dir);
    appendCycleRecord({ ...record, task: "Add logout" }, dir);

    const raw = readFileSync(getHistoryPath(dir), "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).task).toBe("Add auth");
    expect(JSON.parse(lines[1]!).task).toBe("Add logout");
  });
});
