import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerTddTools } from "./tdd-tools.js";
import { createInitialState, createIdleState } from "./state-machine.js";
import { ensureStorageLayout } from "./storage.js";
import type { TddState, TddConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./config.js";
import type { StateRef } from "./tdd-command.js";

const tmpBase = mkdtempSync(join(tmpdir(), "rg-tools-test-"));

beforeAll(() => {
  ensureStorageLayout();
});

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

function makeStateRef(initial: TddState | null = null): StateRef & { current: TddState | null } {
  const ref = {
    current: initial,
    get: () => ref.current,
    set: (s: TddState) => {
      ref.current = s;
    },
    getConfig: (): TddConfig | null => DEFAULT_CONFIG,
  };
  return ref;
}

type ToolDef = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{ content: { type: string; text: string }[]; details?: unknown }>;
};

function registerAndCapture(stateRef: StateRef): Map<string, ToolDef> {
  const tools = new Map<string, ToolDef>();
  const mockPi = {
    registerTool: vi.fn((def: ToolDef) => {
      tools.set(def.name, def);
    }),
  } as unknown as ExtensionAPI;
  registerTddTools(mockPi, stateRef);
  return tools;
}

describe("tdd_status tool", () => {
  it("returns idle message when no active session", async () => {
    const ref = makeStateRef(createIdleState("s1", "p1"));
    const tools = registerAndCapture(ref);
    const tool = tools.get("tdd_status")!;
    const result = await tool.execute("c1", {}, undefined, null, null);
    expect(result.content[0]?.text).toContain("not active");
  });

  it("returns phase and task for active session", async () => {
    const state = createInitialState("Add auth", "s1", "p1");
    const ref = makeStateRef(state);
    const tools = registerAndCapture(ref);
    const tool = tools.get("tdd_status")!;
    const result = await tool.execute("c1", {}, undefined, null, null);
    expect(result.content[0]?.text).toContain("red");
    expect(result.content[0]?.text).toContain("Add auth");
  });
});

describe("tdd_advance tool", () => {
  beforeEach(() => {
    ensureStorageLayout(tmpBase);
  });

  it("throws when no active session", async () => {
    const ref = makeStateRef(createIdleState("s1", "p1"));
    const tools = registerAndCapture(ref);
    const tool = tools.get("tdd_advance")!;
    await expect(tool.execute("c1", {}, undefined, null, null)).rejects.toThrow(
      "No active TDD session",
    );
  });

  it("advances from red to green", async () => {
    const state = createInitialState("Add auth", "s1", "p1");
    const ref = makeStateRef(state);
    const tools = registerAndCapture(ref);
    const tool = tools.get("tdd_advance")!;
    const result = await tool.execute("c1", {}, undefined, null, null);
    expect(result.content[0]?.text).toContain("GREEN");
    expect(ref.current?.phase).toBe("green");
  });

  it("advances from green to refactor", async () => {
    const state: TddState = { ...createInitialState("task", "s1", "p1"), phase: "green" };
    const ref = makeStateRef(state);
    const tools = registerAndCapture(ref);
    const tool = tools.get("tdd_advance")!;
    await tool.execute("c1", {}, undefined, null, null);
    expect(ref.current?.phase).toBe("refactor");
  });

  it("warns when already complete", async () => {
    const state: TddState = { ...createInitialState("task", "s1", "p1"), phase: "complete" };
    const ref = makeStateRef(state);
    const tools = registerAndCapture(ref);
    const tool = tools.get("tdd_advance")!;
    const result = await tool.execute("c1", {}, undefined, null, null);
    expect(result.content[0]?.text).toContain("already complete");
    expect(ref.current?.phase).toBe("complete");
  });
});

describe("tdd_reset tool", () => {
  beforeEach(() => {
    ensureStorageLayout(tmpBase);
  });

  it("returns idle message when already idle", async () => {
    const ref = makeStateRef(createIdleState("s1", "p1"));
    const tools = registerAndCapture(ref);
    const tool = tools.get("tdd_reset")!;
    const result = await tool.execute("c1", {}, undefined, null, null);
    expect(result.content[0]?.text).toContain("already idle");
  });

  it("resets active session to idle", async () => {
    const state = createInitialState("Add auth", "s1", "p1");
    const ref = makeStateRef(state);
    const tools = registerAndCapture(ref);
    const tool = tools.get("tdd_reset")!;
    const result = await tool.execute("c1", {}, undefined, null, null);
    expect(result.content[0]?.text).toContain("reset to idle");
    expect(ref.current?.phase).toBe("idle");
  });
});

describe("registerTddTools", () => {
  it("registers 3 tools", () => {
    const ref = makeStateRef();
    const mockPi = {
      registerTool: vi.fn(),
    } as unknown as ExtensionAPI;
    registerTddTools(mockPi, ref);
    expect(vi.mocked(mockPi.registerTool)).toHaveBeenCalledTimes(3);
  });
});
