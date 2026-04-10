import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { handleTddCommand, type StateRef } from "./tdd-command.js";
import { createInitialState, createIdleState } from "./state-machine.js";
import type { TddState, TddConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./config.js";
import { ensureStorageLayout } from "./storage.js";

// Ensure the real storage dir exists for tests that write to default paths
beforeAll(() => {
  ensureStorageLayout();
});

const tmpBase = mkdtempSync(join(tmpdir(), "rg-cmd-test-"));

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

function makeMockCtx(): ExtensionCommandContext {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
    cwd: tmpBase,
  } as unknown as ExtensionCommandContext;
}

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

describe("handleTddCommand", () => {
  beforeEach(() => {
    ensureStorageLayout(tmpBase);
  });

  it("shows status when no args and TDD is inactive", async () => {
    const ctx = makeMockCtx();
    const ref = makeStateRef(createIdleState("s1", "p1"));
    await handleTddCommand("", ctx, ref);
    expect(vi.mocked(ctx.ui.notify)).toHaveBeenCalledWith(
      expect.stringContaining("not active"),
      "info",
    );
  });

  it("shows status when no args and TDD is active", async () => {
    const ctx = makeMockCtx();
    const state = createInitialState("Add auth", "s1", "p1");
    const ref = makeStateRef(state);
    await handleTddCommand("", ctx, ref);
    expect(vi.mocked(ctx.ui.notify)).toHaveBeenCalledWith(
      expect.stringContaining("TDD:"),
      "info",
    );
  });

  it("activates TDD with a task description (no pi)", async () => {
    const ctx = makeMockCtx();
    const ref = makeStateRef(createIdleState("s1", "p1"));
    await handleTddCommand("Add user auth", ctx, ref);
    expect(ref.current?.phase).toBe("red");
    expect(ref.current?.task).toBe("Add user auth");
    expect(vi.mocked(ctx.ui.notify)).toHaveBeenCalledWith(
      expect.stringContaining("TDD activated"),
      "info",
    );
  });

  it("activates TDD and sends user message when pi is provided", async () => {
    const ctx = makeMockCtx();
    const ref = makeStateRef(createIdleState("s1", "p1"));
    const mockPi = { sendUserMessage: vi.fn() } as unknown as ExtensionAPI;
    await handleTddCommand("Add user auth", ctx, ref, mockPi);
    expect(ref.current?.phase).toBe("red");
    expect(vi.mocked(mockPi.sendUserMessage)).toHaveBeenCalledWith(
      expect.stringContaining("Add user auth"),
      { deliverAs: "followUp" },
    );
    expect(vi.mocked(ctx.ui.notify)).not.toHaveBeenCalled();
  });

  it("deactivates TDD with 'off'", async () => {
    const ctx = makeMockCtx();
    const state = createInitialState("Add auth", "s1", "p1");
    const ref = makeStateRef(state);
    await handleTddCommand("off", ctx, ref);
    expect(ref.current?.phase).toBe("idle");
    expect(vi.mocked(ctx.ui.notify)).toHaveBeenCalledWith(
      expect.stringContaining("deactivated"),
      "info",
    );
  });

  it("deactivate is case-insensitive", async () => {
    const ctx = makeMockCtx();
    const state = createInitialState("Add auth", "s1", "p1");
    const ref = makeStateRef(state);
    await handleTddCommand("OFF", ctx, ref);
    expect(ref.current?.phase).toBe("idle");
  });

  it("deactivate when already inactive shows message", async () => {
    const ctx = makeMockCtx();
    const ref = makeStateRef(createIdleState("s1", "p1"));
    await handleTddCommand("off", ctx, ref);
    expect(vi.mocked(ctx.ui.notify)).toHaveBeenCalledWith(
      expect.stringContaining("not active"),
      "info",
    );
  });

  it("activating while already active replaces the task", async () => {
    const ctx = makeMockCtx();
    const state = createInitialState("Old task", "s1", "p1");
    const ref = makeStateRef(state);
    await handleTddCommand("New task", ctx, ref);
    expect(ref.current?.task).toBe("New task");
    expect(ref.current?.phase).toBe("red");
  });
});
