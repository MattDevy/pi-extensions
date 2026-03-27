import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearActiveInstincts, setCurrentActiveInstincts } from "./active-instincts.js";
import { ensureStorageLayout } from "./storage.js";
import {
  handleTurnStart,
  handleTurnEnd,
  handleUserBash,
  handleSessionCompact,
  handleModelSelect,
  type TurnStartEvent,
  type TurnEndEvent,
  type UserBashEvent,
  type SessionCompactEvent,
  type ModelSelectEvent,
} from "./session-observer.js";
import type { ProjectEntry } from "./types.js";

function makeCtx(sessionId = "test-session-020") {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
    },
    getContextUsage: () => ({ tokens: 5000, contextWindow: 200000, percent: 2.5 }),
  } as unknown as import("@mariozechner/pi-coding-agent").ExtensionContext;
}

function readObservations(projectId: string, baseDir: string): Record<string, unknown>[] {
  const filePath = join(baseDir, "projects", projectId, "observations.jsonl");
  const raw = readFileSync(filePath, "utf-8").trim();
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function lastObs(projectId: string, baseDir: string): Record<string, unknown> {
  const obs = readObservations(projectId, baseDir);
  const last = obs[obs.length - 1];
  if (last === undefined) throw new Error("No observations found");
  return last;
}

const PROJECT: ProjectEntry = {
  id: "test-proj-020",
  name: "test-project-020",
  root: "/tmp/test-project-020",
  remote: "git@github.com:test/test-project-020.git",
  created_at: new Date().toISOString(),
  last_seen: new Date().toISOString(),
};

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "session-observer-test-"));
  ensureStorageLayout(PROJECT, tmpDir);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearActiveInstincts();
});

afterEach(() => {
  clearActiveInstincts();
});

describe("handleTurnStart", () => {
  it("records a turn_start observation with turn_index", () => {
    const event: TurnStartEvent = { type: "turn_start", turnIndex: 3, timestamp: Date.now() };
    handleTurnStart(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["event"]).toBe("turn_start");
    expect(last["turn_index"]).toBe(3);
    expect(last["session"]).toBe("test-session-020");
    expect(last["project_id"]).toBe(PROJECT.id);
  });

  it("includes active_instincts when set", () => {
    setCurrentActiveInstincts(["inst-a"]);
    const event: TurnStartEvent = { type: "turn_start", turnIndex: 0, timestamp: Date.now() };
    handleTurnStart(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["active_instincts"]).toEqual(["inst-a"]);
  });
});

describe("handleTurnEnd", () => {
  it("records a turn_end observation with tool_count and error_count", () => {
    const event: TurnEndEvent = {
      type: "turn_end",
      turnIndex: 2,
      message: {},
      toolResults: [{}, {}, { isError: true }],
    };
    handleTurnEnd(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["event"]).toBe("turn_end");
    expect(last["turn_index"]).toBe(2);
    expect(last["tool_count"]).toBe(3);
    expect(last["error_count"]).toBe(1);
  });

  it("includes tokens_used from context usage", () => {
    const event: TurnEndEvent = {
      type: "turn_end",
      turnIndex: 0,
      message: {},
      toolResults: [],
    };
    handleTurnEnd(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["tokens_used"]).toBe(5000);
  });

  it("handles empty toolResults", () => {
    const event: TurnEndEvent = {
      type: "turn_end",
      turnIndex: 1,
      message: {},
      toolResults: [],
    };
    handleTurnEnd(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["tool_count"]).toBe(0);
    expect(last["error_count"]).toBe(0);
  });
});

describe("handleUserBash", () => {
  it("records a user_bash observation with scrubbed command", () => {
    const event: UserBashEvent = {
      type: "user_bash",
      command: "npm test",
      excludeFromContext: false,
      cwd: "/home/user/project",
    };
    handleUserBash(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["event"]).toBe("user_bash");
    expect(last["command"]).toBe("npm test");
    expect(last["cwd"]).toBe("/home/user/project");
  });

  it("scrubs secrets from commands", () => {
    const event: UserBashEvent = {
      type: "user_bash",
      command: "curl -H 'Authorization: Bearer sk-secret123' https://api.example.com",
      excludeFromContext: false,
      cwd: "/tmp",
    };
    handleUserBash(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["command"]).not.toContain("sk-secret123");
    expect(last["command"]).toContain("[REDACTED]");
  });
});

describe("handleSessionCompact", () => {
  it("records a session_compact observation", () => {
    const event: SessionCompactEvent = {
      type: "session_compact",
      compactionEntry: {},
      fromExtension: false,
    };
    handleSessionCompact(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["event"]).toBe("session_compact");
    expect(last["from_extension"]).toBe(false);
  });

  it("records from_extension flag when compaction is extension-triggered", () => {
    const event: SessionCompactEvent = {
      type: "session_compact",
      compactionEntry: {},
      fromExtension: true,
    };
    handleSessionCompact(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["from_extension"]).toBe(true);
  });
});

describe("handleModelSelect", () => {
  it("records a model_select observation with model info", () => {
    const event: ModelSelectEvent = {
      type: "model_select",
      model: { id: "claude-sonnet-4-6" },
      previousModel: { id: "claude-haiku-4-5" },
      source: "set",
    };
    handleModelSelect(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["event"]).toBe("model_select");
    expect(last["model"]).toBe("claude-sonnet-4-6");
    expect(last["previous_model"]).toBe("claude-haiku-4-5");
    expect(last["model_change_source"]).toBe("set");
  });

  it("handles undefined previousModel", () => {
    const event: ModelSelectEvent = {
      type: "model_select",
      model: { id: "claude-opus-4-6" },
      previousModel: undefined,
      source: "restore",
    };
    handleModelSelect(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["model"]).toBe("claude-opus-4-6");
    expect(last["previous_model"]).toBeUndefined();
    expect(last["model_change_source"]).toBe("restore");
  });

  it("falls back to name when id is missing", () => {
    const event: ModelSelectEvent = {
      type: "model_select",
      model: { name: "Custom Model" },
      previousModel: undefined,
      source: "cycle",
    };
    handleModelSelect(event, makeCtx(), PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["model"]).toBe("Custom Model");
  });
});
