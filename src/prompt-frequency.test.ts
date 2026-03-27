import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  normalizePrompt,
  hashPrompt,
  updateFrequencyTable,
  updateGlobalFrequencyTable,
  updateFrequencyTablesFromLines,
  loadProjectFrequencyTable,
  saveProjectFrequencyTable,
  loadGlobalFrequencyTable,
  saveGlobalFrequencyTable,
} from "./prompt-frequency.js";
import type {
  PromptFrequencyTable,
  GlobalPromptFrequencyTable,
  Observation,
} from "./types.js";

const NOW = new Date("2026-03-27T12:00:00Z");

const base: Omit<Observation, "event"> = {
  timestamp: "2026-03-27T12:00:00Z",
  session: "sess-1",
  project_id: "proj-1",
  project_name: "test",
};

function line(obs: Partial<Observation>): string {
  return JSON.stringify({ ...base, ...obs });
}

function makeTmpBase(): string {
  return mkdtempSync(join(tmpdir(), "pf-test-"));
}

// ---------------------------------------------------------------------------
// normalizePrompt
// ---------------------------------------------------------------------------

describe("normalizePrompt", () => {
  it("lowercases and trims", () => {
    expect(normalizePrompt("  PR It  ")).toBe("pr it");
  });

  it("collapses interior whitespace", () => {
    expect(normalizePrompt("ship   it   now")).toBe("ship it now");
  });

  it("strips trailing punctuation", () => {
    expect(normalizePrompt("deploy!")).toBe("deploy");
    expect(normalizePrompt("do it...")).toBe("do it");
    expect(normalizePrompt("go?!")).toBe("go");
    expect(normalizePrompt("test;")).toBe("test");
    expect(normalizePrompt("run:")).toBe("run");
    expect(normalizePrompt("ok,")).toBe("ok");
  });

  it("returns empty for empty input", () => {
    expect(normalizePrompt("")).toBe("");
    expect(normalizePrompt("   ")).toBe("");
  });

  it("returns empty for punctuation-only input", () => {
    expect(normalizePrompt("...")).toBe("");
    expect(normalizePrompt("!?")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// hashPrompt
// ---------------------------------------------------------------------------

describe("hashPrompt", () => {
  it("returns deterministic hex string", () => {
    const h1 = hashPrompt("pr it");
    const h2 = hashPrompt("pr it");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different inputs", () => {
    expect(hashPrompt("pr it")).not.toBe(hashPrompt("ship it"));
  });
});

// ---------------------------------------------------------------------------
// updateFrequencyTable
// ---------------------------------------------------------------------------

describe("updateFrequencyTable", () => {
  it("creates entry on first occurrence", () => {
    const result = updateFrequencyTable({}, "PR it", "sess-1", NOW);
    const key = hashPrompt(normalizePrompt("PR it"));
    expect(result[key]).toEqual({
      count: 1,
      sessions: ["sess-1"],
      last_text: "PR it",
      first_seen: NOW.toISOString(),
      last_seen: NOW.toISOString(),
    });
  });

  it("deduplicates same session", () => {
    let table: PromptFrequencyTable = {};
    table = updateFrequencyTable(table, "PR it", "sess-1", NOW);
    table = updateFrequencyTable(table, "PR it", "sess-1", NOW);
    const key = hashPrompt(normalizePrompt("PR it"));
    expect(table[key]!.count).toBe(2);
    expect(table[key]!.sessions).toEqual(["sess-1"]);
  });

  it("tracks distinct sessions", () => {
    let table: PromptFrequencyTable = {};
    table = updateFrequencyTable(table, "PR it", "sess-1", NOW);
    table = updateFrequencyTable(table, "PR it", "sess-2", NOW);
    const key = hashPrompt(normalizePrompt("PR it"));
    expect(table[key]!.count).toBe(2);
    expect(table[key]!.sessions).toEqual(["sess-1", "sess-2"]);
  });

  it("returns table unchanged for empty text", () => {
    const original: PromptFrequencyTable = {};
    const result = updateFrequencyTable(original, "  ", "sess-1", NOW);
    expect(result).toBe(original);
  });

  it("does not mutate input table", () => {
    const original: PromptFrequencyTable = {};
    updateFrequencyTable(original, "PR it", "sess-1", NOW);
    expect(Object.keys(original)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateGlobalFrequencyTable
// ---------------------------------------------------------------------------

describe("updateGlobalFrequencyTable", () => {
  it("tracks project_ids", () => {
    let table: GlobalPromptFrequencyTable = {};
    table = updateGlobalFrequencyTable(table, "PR it", "sess-1", "proj-1", NOW);
    table = updateGlobalFrequencyTable(table, "PR it", "sess-2", "proj-2", NOW);
    const key = hashPrompt(normalizePrompt("PR it"));
    expect(table[key]!.project_ids).toEqual(["proj-1", "proj-2"]);
  });

  it("deduplicates project_ids", () => {
    let table: GlobalPromptFrequencyTable = {};
    table = updateGlobalFrequencyTable(table, "PR it", "sess-1", "proj-1", NOW);
    table = updateGlobalFrequencyTable(table, "PR it", "sess-2", "proj-1", NOW);
    const key = hashPrompt(normalizePrompt("PR it"));
    expect(table[key]!.project_ids).toEqual(["proj-1"]);
  });
});

// ---------------------------------------------------------------------------
// updateFrequencyTablesFromLines
// ---------------------------------------------------------------------------

describe("updateFrequencyTablesFromLines", () => {
  it("processes user_prompt events with input", () => {
    const lines = [
      line({ event: "user_prompt", input: "PR it" }),
      line({ event: "user_prompt", input: "ship it" }),
    ];
    const { project, global } = updateFrequencyTablesFromLines(lines, {}, {}, NOW);
    expect(Object.keys(project)).toHaveLength(2);
    expect(Object.keys(global)).toHaveLength(2);
  });

  it("skips non-user_prompt events", () => {
    const lines = [
      line({ event: "tool_complete", tool: "bash" }),
      line({ event: "turn_end" }),
    ];
    const { project } = updateFrequencyTablesFromLines(lines, {}, {}, NOW);
    expect(Object.keys(project)).toHaveLength(0);
  });

  it("skips user_prompt with no input", () => {
    const lines = [line({ event: "user_prompt" })];
    const { project } = updateFrequencyTablesFromLines(lines, {}, {}, NOW);
    expect(Object.keys(project)).toHaveLength(0);
  });

  it("skips malformed JSON", () => {
    const lines = ["not json", line({ event: "user_prompt", input: "ok" })];
    const { project } = updateFrequencyTablesFromLines(lines, {}, {}, NOW);
    expect(Object.keys(project)).toHaveLength(1);
  });

  it("skips blank lines", () => {
    const lines = ["", "  ", line({ event: "user_prompt", input: "ok" })];
    const { project } = updateFrequencyTablesFromLines(lines, {}, {}, NOW);
    expect(Object.keys(project)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Load / save round-trips
// ---------------------------------------------------------------------------

describe("project frequency table I/O", () => {
  it("returns empty table when file is absent", () => {
    const base = makeTmpBase();
    expect(loadProjectFrequencyTable("proj-1", base)).toEqual({});
  });

  it("round-trips save and load", () => {
    const base = makeTmpBase();
    const table: PromptFrequencyTable = {
      abc: {
        count: 3,
        sessions: ["s1", "s2"],
        last_text: "PR it",
        first_seen: "2026-01-01T00:00:00Z",
        last_seen: "2026-03-27T00:00:00Z",
      },
    };
    saveProjectFrequencyTable(table, "proj-1", base);
    expect(loadProjectFrequencyTable("proj-1", base)).toEqual(table);
  });
});

describe("global frequency table I/O", () => {
  it("returns empty table when file is absent", () => {
    const base = makeTmpBase();
    expect(loadGlobalFrequencyTable(base)).toEqual({});
  });

  it("round-trips save and load", () => {
    const base = makeTmpBase();
    const table: GlobalPromptFrequencyTable = {
      abc: {
        count: 5,
        sessions: ["s1", "s2", "s3"],
        project_ids: ["p1", "p2"],
        last_text: "ship it",
        first_seen: "2026-01-01T00:00:00Z",
        last_seen: "2026-03-27T00:00:00Z",
      },
    };
    saveGlobalFrequencyTable(table, base);
    expect(loadGlobalFrequencyTable(base)).toEqual(table);
  });
});
