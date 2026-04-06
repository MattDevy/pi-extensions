import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkConsolidationGate,
  countDistinctSessions,
  loadConsolidationMeta,
  saveConsolidationMeta,
  DEFAULT_CONSOLIDATION_MIN_SESSIONS,
  type ConsolidationMeta,
} from "./consolidation.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-cl-consolidation-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// checkConsolidationGate
// ---------------------------------------------------------------------------

describe("checkConsolidationGate", () => {
  const now = new Date("2026-03-27T12:00:00Z");

  it("returns eligible on first run when enough sessions exist", () => {
    const result = checkConsolidationGate({
      meta: {},
      currentSessionCount: 15,
      now,
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toContain("first consolidation");
  });

  it("returns ineligible on first run when too few sessions", () => {
    const result = checkConsolidationGate({
      meta: {},
      currentSessionCount: 3,
      now,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("3 sessions");
  });

  it("returns ineligible when not enough days elapsed", () => {
    const result = checkConsolidationGate({
      meta: {
        last_consolidation_at: "2026-03-25T12:00:00Z", // 2 days ago
        last_consolidation_session_count: 5,
      },
      currentSessionCount: 50,
      now,
      intervalDays: 7,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("days since last");
  });

  it("returns ineligible when not enough sessions since last run", () => {
    const result = checkConsolidationGate({
      meta: {
        last_consolidation_at: "2026-03-10T12:00:00Z", // 17 days ago
        last_consolidation_session_count: 45,
      },
      currentSessionCount: 48, // only 3 new sessions
      now,
      minSessions: 10,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("3 sessions since last");
  });

  it("returns eligible when both gates pass", () => {
    const result = checkConsolidationGate({
      meta: {
        last_consolidation_at: "2026-03-10T12:00:00Z",
        last_consolidation_session_count: 20,
      },
      currentSessionCount: 35,
      now,
      intervalDays: 7,
      minSessions: 10,
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toContain("gate conditions met");
  });

  it("uses default intervals when not specified", () => {
    const result = checkConsolidationGate({
      meta: {
        last_consolidation_at: "2026-01-01T00:00:00Z",
        last_consolidation_session_count: 0,
      },
      currentSessionCount: DEFAULT_CONSOLIDATION_MIN_SESSIONS + 5,
      now,
    });
    expect(result.eligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// countDistinctSessions
// ---------------------------------------------------------------------------

describe("countDistinctSessions", () => {
  it("returns 0 for nonexistent file", () => {
    expect(countDistinctSessions(join(tmpDir, "nope.jsonl"))).toBe(0);
  });

  it("counts distinct session IDs from JSONL", () => {
    const obsPath = join(tmpDir, "obs.jsonl");
    const lines = [
      JSON.stringify({ session: "aaa", event: "tool_start" }),
      JSON.stringify({ session: "aaa", event: "tool_complete" }),
      JSON.stringify({ session: "bbb", event: "user_prompt" }),
      JSON.stringify({ session: "ccc", event: "agent_end" }),
      JSON.stringify({ session: "bbb", event: "tool_start" }),
    ];
    writeFileSync(obsPath, lines.join("\n"), "utf-8");
    expect(countDistinctSessions(obsPath)).toBe(3);
  });

  it("handles empty file", () => {
    const obsPath = join(tmpDir, "empty.jsonl");
    writeFileSync(obsPath, "", "utf-8");
    expect(countDistinctSessions(obsPath)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Consolidation meta persistence
// ---------------------------------------------------------------------------

describe("consolidation meta persistence", () => {
  it("returns empty meta when file does not exist", () => {
    const meta = loadConsolidationMeta("fake-project", tmpDir);
    expect(meta).toEqual({});
  });

  it("round-trips meta through save and load", () => {
    const projectId = "test-proj";
    const projectDir = join(tmpDir, "projects", projectId);
    mkdirSync(projectDir, { recursive: true });

    const meta: ConsolidationMeta = {
      last_consolidation_at: "2026-03-20T10:00:00Z",
      last_consolidation_session_count: 42,
    };

    saveConsolidationMeta(projectId, meta, tmpDir);
    const loaded = loadConsolidationMeta(projectId, tmpDir);
    expect(loaded).toEqual(meta);
  });

  it("returns empty meta for malformed JSON", () => {
    const projectId = "bad-json";
    const projectDir = join(tmpDir, "projects", projectId);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "consolidation.json"), "not json", "utf-8");
    const meta = loadConsolidationMeta(projectId, tmpDir);
    expect(meta).toEqual({});
  });
});
