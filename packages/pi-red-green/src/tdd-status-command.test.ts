import { describe, it, expect, vi } from "vitest";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { handleTddStatusCommand } from "./tdd-status-command.js";
import { createInitialState, createIdleState } from "./state-machine.js";
import type { TddState, TddConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./config.js";
import type { StateRef } from "./tdd-command.js";

function makeMockCtx(): ExtensionCommandContext {
  return {
    ui: {
      notify: vi.fn(),
    },
    cwd: "/tmp",
  } as unknown as ExtensionCommandContext;
}

function makeStateRef(initial: TddState | null = null): StateRef {
  return {
    get: () => initial,
    set: vi.fn(),
    getConfig: (): TddConfig | null => DEFAULT_CONFIG,
  };
}

describe("handleTddStatusCommand", () => {
  it("shows not-active message when idle", async () => {
    const ctx = makeMockCtx();
    await handleTddStatusCommand("", ctx, makeStateRef(createIdleState("s1", "p1")));
    expect(vi.mocked(ctx.ui.notify)).toHaveBeenCalledWith(
      expect.stringContaining("not active"),
      "info",
    );
  });

  it("shows phase and task for active TDD", async () => {
    const ctx = makeMockCtx();
    const state = createInitialState("Add auth", "s1", "p1");
    await handleTddStatusCommand("", ctx, makeStateRef(state));
    const output = vi.mocked(ctx.ui.notify).mock.calls[0]?.[0] as string;
    expect(output).toContain("RED");
    expect(output).toContain("Add auth");
  });

  it("shows test run results when available", async () => {
    const ctx = makeMockCtx();
    const state: TddState = {
      ...createInitialState("Add auth", "s1", "p1"),
      last_test_run: {
        timestamp: "2026-01-01T00:00:00Z",
        turn_index: 2,
        passed: 3,
        failed: 1,
        errors: 0,
        exit_code: 1,
      },
    };
    await handleTddStatusCommand("", ctx, makeStateRef(state));
    const output = vi.mocked(ctx.ui.notify).mock.calls[0]?.[0] as string;
    expect(output).toContain("Passed: 3");
    expect(output).toContain("Failed: 1");
  });

  it("shows STALE indicator for stale test runs", async () => {
    const ctx = makeMockCtx();
    const state: TddState = {
      ...createInitialState("Add auth", "s1", "p1"),
      current_turn_index: 5,
      last_test_run: {
        timestamp: "2026-01-01T00:00:00Z",
        turn_index: 2,
        passed: 3,
        failed: 0,
        errors: 0,
        exit_code: 0,
      },
    };
    await handleTddStatusCommand("", ctx, makeStateRef(state));
    const output = vi.mocked(ctx.ui.notify).mock.calls[0]?.[0] as string;
    expect(output).toContain("STALE");
  });

  it("shows file lists", async () => {
    const ctx = makeMockCtx();
    const state: TddState = {
      ...createInitialState("Add auth", "s1", "p1"),
      test_files: ["auth.test.ts"],
      impl_files: ["auth.ts"],
    };
    await handleTddStatusCommand("", ctx, makeStateRef(state));
    const output = vi.mocked(ctx.ui.notify).mock.calls[0]?.[0] as string;
    expect(output).toContain("auth.test.ts");
    expect(output).toContain("auth.ts");
  });

  it("shows phase history", async () => {
    const ctx = makeMockCtx();
    const state: TddState = {
      ...createInitialState("Add auth", "s1", "p1"),
      phase_history: [
        { phase: "red", entered_at: "2026-01-01T00:00:00Z" },
        { phase: "green", entered_at: "2026-01-01T00:10:00Z" },
      ],
    };
    await handleTddStatusCommand("", ctx, makeStateRef(state));
    const output = vi.mocked(ctx.ui.notify).mock.calls[0]?.[0] as string;
    expect(output).toContain("Phase history");
    expect(output).toContain("RED");
    expect(output).toContain("GREEN");
  });
});
