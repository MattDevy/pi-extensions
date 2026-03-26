import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearActiveInstincts, setCurrentActiveInstincts } from "./active-instincts.js";
import { setAnalyzerRunning } from "./observer-guard.js";
import { ensureStorageLayout } from "./storage.js";
import {
  handleToolEnd,
  handleToolStart,
  MAX_TOOL_INPUT_LENGTH,
  MAX_TOOL_OUTPUT_LENGTH,
  type ToolExecutionEndEvent,
  type ToolExecutionStartEvent,
} from "./tool-observer.js";
import type { ProjectEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(sessionId = "test-session-001") {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
    },
  } as unknown as import("@mariozechner/pi-coding-agent").ExtensionContext;
}

function makeStartEvent(toolName: string, args: unknown): ToolExecutionStartEvent {
  return { type: "tool_execution_start", toolCallId: "call-1", toolName, args };
}

function makeEndEvent(toolName: string, result: unknown, isError = false): ToolExecutionEndEvent {
  return { type: "tool_execution_end", toolCallId: "call-1", toolName, result, isError };
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const PROJECT: ProjectEntry = {
  id: "test-proj-002",
  name: "test-project",
  root: "/tmp/test-project",
  remote: "git@github.com:test/test-project.git",
  created_at: new Date().toISOString(),
  last_seen: new Date().toISOString(),
};

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tool-observer-test-"));
  ensureStorageLayout(PROJECT, tmpDir);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearActiveInstincts();
  setAnalyzerRunning(false);
});

afterEach(() => {
  clearActiveInstincts();
  setAnalyzerRunning(false);
});

// ---------------------------------------------------------------------------
// handleToolStart tests
// ---------------------------------------------------------------------------

describe("handleToolStart", () => {
  it("records a tool_start observation with correct fields", () => {
    const ctx = makeCtx("session-abc");
    const event = makeStartEvent("bash", { command: "ls -la" });

    handleToolStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["event"]).toBe("tool_start");
    expect(last["tool"]).toBe("bash");
    expect(last["session"]).toBe("session-abc");
    expect(last["project_id"]).toBe(PROJECT.id);
    expect(last["project_name"]).toBe(PROJECT.name);
    expect(typeof last["timestamp"]).toBe("string");
    expect(last["timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("includes input as JSON-stringified args", () => {
    const ctx = makeCtx();
    const event = makeStartEvent("bash", { command: "echo hello" });

    handleToolStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["input"]).toContain("echo hello");
  });

  it("truncates input to MAX_TOOL_INPUT_LENGTH characters", () => {
    const ctx = makeCtx();
    const longArg = "x".repeat(MAX_TOOL_INPUT_LENGTH + 100);
    const event = makeStartEvent("read", { path: longArg });

    handleToolStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect((last["input"] as string).length).toBeLessThanOrEqual(MAX_TOOL_INPUT_LENGTH);
  });

  it("applies secret scrubbing to input", () => {
    const ctx = makeCtx();
    const event = makeStartEvent("bash", {
      command: "curl -H 'Authorization: Bearer sk-secret123'",
    });

    handleToolStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["input"]).not.toContain("sk-secret123");
    expect(last["input"]).toContain("[REDACTED]");
  });

  it("tags observation with active_instincts when set", () => {
    const ctx = makeCtx();
    setCurrentActiveInstincts(["instinct-a", "instinct-b"]);
    const event = makeStartEvent("read", { path: "/some/file.ts" });

    handleToolStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["active_instincts"]).toEqual(["instinct-a", "instinct-b"]);
  });

  it("omits active_instincts when none are active", () => {
    const ctx = makeCtx();
    clearActiveInstincts();
    const event = makeStartEvent("ls", { path: "." });

    handleToolStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["active_instincts"]).toBeUndefined();
  });

  it("skips recording when analyzer is running (self-observation guard)", () => {
    const ctx = makeCtx();
    setAnalyzerRunning(true);

    const before = readObservations(PROJECT.id, tmpDir).length;
    const event = makeStartEvent("write", { path: "out.txt", content: "data" });
    handleToolStart(event, ctx, PROJECT, tmpDir);
    const after = readObservations(PROJECT.id, tmpDir).length;

    expect(after).toBe(before);
  });

  it("passes through string args without double-stringifying", () => {
    const ctx = makeCtx();
    const event = makeStartEvent("bash", "plain string arg");

    handleToolStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["input"]).toBe("plain string arg");
  });
});

// ---------------------------------------------------------------------------
// handleToolEnd tests
// ---------------------------------------------------------------------------

describe("handleToolEnd", () => {
  it("records a tool_complete observation with correct fields", () => {
    const ctx = makeCtx("session-xyz");
    const event = makeEndEvent("bash", { output: "hello" }, false);

    handleToolEnd(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["event"]).toBe("tool_complete");
    expect(last["tool"]).toBe("bash");
    expect(last["session"]).toBe("session-xyz");
    expect(last["project_id"]).toBe(PROJECT.id);
    expect(last["project_name"]).toBe(PROJECT.name);
    expect(last["is_error"]).toBe(false);
    expect(typeof last["timestamp"]).toBe("string");
  });

  it("records is_error: true for error results", () => {
    const ctx = makeCtx();
    const event = makeEndEvent("bash", "command not found", true);

    handleToolEnd(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["is_error"]).toBe(true);
    expect(last["event"]).toBe("tool_complete");
  });

  it("truncates output to MAX_TOOL_OUTPUT_LENGTH characters", () => {
    const ctx = makeCtx();
    const longResult = "y".repeat(MAX_TOOL_OUTPUT_LENGTH + 200);
    const event = makeEndEvent("read", longResult);

    handleToolEnd(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect((last["output"] as string).length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_LENGTH);
  });

  it("applies secret scrubbing to output", () => {
    const ctx = makeCtx();
    const event = makeEndEvent("read", "password=supersecretpassword123");

    handleToolEnd(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["output"]).not.toContain("supersecretpassword123");
    expect(last["output"]).toContain("[REDACTED]");
  });

  it("tags observation with active_instincts from shared state", () => {
    const ctx = makeCtx();
    setCurrentActiveInstincts(["instinct-x"]);
    const event = makeEndEvent("edit", { applied: true });

    handleToolEnd(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["active_instincts"]).toEqual(["instinct-x"]);
  });

  it("skips recording when analyzer is running (self-observation guard)", () => {
    const ctx = makeCtx();
    setAnalyzerRunning(true);

    const before = readObservations(PROJECT.id, tmpDir).length;
    const event = makeEndEvent("write", "done");
    handleToolEnd(event, ctx, PROJECT, tmpDir);
    const after = readObservations(PROJECT.id, tmpDir).length;

    expect(after).toBe(before);
  });

  it("passes through string result without double-stringifying", () => {
    const ctx = makeCtx();
    const event = makeEndEvent("bash", "plain output string");

    handleToolEnd(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["output"]).toBe("plain output string");
  });
});
