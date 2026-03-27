import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearActiveInstincts, setCurrentActiveInstincts } from "./active-instincts.js";
import { ensureStorageLayout } from "./storage.js";
import {
  handleAgentEnd,
  handleBeforeAgentStart,
  type AgentEndEvent,
  type BeforeAgentStartEvent,
} from "./prompt-observer.js";
import type { ProjectEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(sessionId = "test-session-014") {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
    },
    getContextUsage: () => ({ tokens: 1000, contextWindow: 200000, percent: 0.5 }),
  } as unknown as import("@mariozechner/pi-coding-agent").ExtensionContext;
}

function makePromptEvent(prompt: string): BeforeAgentStartEvent {
  return { type: "before_agent_start", prompt, systemPrompt: "You are a helpful assistant." };
}

function makeAgentEndEvent(): AgentEndEvent {
  return { type: "agent_end" };
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
  id: "test-proj-014",
  name: "test-project-014",
  root: "/tmp/test-project-014",
  remote: "git@github.com:test/test-project-014.git",
  created_at: new Date().toISOString(),
  last_seen: new Date().toISOString(),
};

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "prompt-observer-test-"));
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

// ---------------------------------------------------------------------------
// handleBeforeAgentStart tests
// ---------------------------------------------------------------------------

describe("handleBeforeAgentStart", () => {
  it("records a user_prompt observation with correct fields", () => {
    const ctx = makeCtx("session-prompt-001");
    const event = makePromptEvent("Write a test for the config module");

    handleBeforeAgentStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["event"]).toBe("user_prompt");
    expect(last["session"]).toBe("session-prompt-001");
    expect(last["project_id"]).toBe(PROJECT.id);
    expect(last["project_name"]).toBe(PROJECT.name);
    expect(typeof last["timestamp"]).toBe("string");
    expect(last["timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("stores the prompt text in the input field", () => {
    const ctx = makeCtx();
    const event = makePromptEvent("Refactor the storage module");

    handleBeforeAgentStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["input"]).toBe("Refactor the storage module");
  });

  it("applies secret scrubbing to prompt text", () => {
    const ctx = makeCtx();
    // Use a bearer token pattern that the scrubber recognizes
    const event = makePromptEvent("Call the API with Authorization: Bearer mysupersecrettoken123");

    handleBeforeAgentStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["input"]).not.toContain("mysupersecrettoken123");
    expect(last["input"]).toContain("[REDACTED]");
  });

  it("tags observation with active_instincts when set", () => {
    const ctx = makeCtx();
    setCurrentActiveInstincts(["instinct-a", "instinct-b"]);
    const event = makePromptEvent("Run the tests please");

    handleBeforeAgentStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["active_instincts"]).toEqual(["instinct-a", "instinct-b"]);
  });

  it("omits active_instincts when none are active", () => {
    const ctx = makeCtx();
    clearActiveInstincts();
    const event = makePromptEvent("List all files");

    handleBeforeAgentStart(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["active_instincts"]).toBeUndefined();
  });

});

// ---------------------------------------------------------------------------
// handleAgentEnd tests
// ---------------------------------------------------------------------------

describe("handleAgentEnd", () => {
  it("records an agent_end observation with correct fields", () => {
    const ctx = makeCtx("session-end-001");
    const event = makeAgentEndEvent();

    handleAgentEnd(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["event"]).toBe("agent_end");
    expect(last["session"]).toBe("session-end-001");
    expect(last["project_id"]).toBe(PROJECT.id);
    expect(last["project_name"]).toBe(PROJECT.name);
    expect(typeof last["timestamp"]).toBe("string");
    expect(last["timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("omits active_instincts when none are active", () => {
    const ctx = makeCtx();
    clearActiveInstincts();
    const event = makeAgentEndEvent();

    handleAgentEnd(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["active_instincts"]).toBeUndefined();
  });

  it("tags observation with active_instincts from shared state", () => {
    const ctx = makeCtx();
    setCurrentActiveInstincts(["instinct-z"]);
    const event = makeAgentEndEvent();

    handleAgentEnd(event, ctx, PROJECT, tmpDir);

    const last = lastObs(PROJECT.id, tmpDir);
    expect(last["active_instincts"]).toEqual(["instinct-z"]);
  });

});
