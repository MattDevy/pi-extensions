import { describe, it, expect, vi } from "vitest";
import { formatStatusText, updateStatusBar, clearStatusBar } from "./status-bar.js";
import { createInitialState, createIdleState } from "./state-machine.js";
import type { TddState } from "./types.js";

function makeState(overrides: Partial<TddState> = {}): TddState {
  return { ...createInitialState("Add auth", "s1", "p1"), ...overrides };
}

describe("formatStatusText", () => {
  it("formats red phase with task", () => {
    expect(formatStatusText(makeState({ phase: "red" }))).toBe("TDD: RED - Add auth");
  });

  it("formats green phase with task", () => {
    expect(formatStatusText(makeState({ phase: "green" }))).toBe("TDD: GREEN - Add auth");
  });

  it("formats refactor phase with task", () => {
    expect(formatStatusText(makeState({ phase: "refactor" }))).toBe("TDD: REFACTOR - Add auth");
  });

  it("formats complete phase with task", () => {
    expect(formatStatusText(makeState({ phase: "complete" }))).toBe("TDD: COMPLETE - Add auth");
  });

  it("formats idle phase without task", () => {
    expect(formatStatusText(createIdleState("s1", "p1"))).toBe("TDD: IDLE");
  });

  it("truncates long task descriptions", () => {
    const longTask = "Implement a comprehensive user authentication system with OAuth2";
    const result = formatStatusText(makeState({ task: longTask }));
    expect(result.length).toBeLessThanOrEqual(55);
    expect(result).toContain("...");
  });
});

describe("updateStatusBar", () => {
  it("calls setStatus with formatted text", () => {
    const setStatus = vi.fn();
    const ctx = { ui: { setStatus } };
    const state = makeState({ phase: "red" });
    updateStatusBar(ctx, state);
    expect(setStatus).toHaveBeenCalledWith("pi-red-green", "TDD: RED - Add auth");
  });

  it("does not throw when setStatus is undefined", () => {
    const ctx = { ui: {} };
    const state = makeState();
    expect(() => updateStatusBar(ctx, state)).not.toThrow();
  });

  it("does not throw when setStatus throws", () => {
    const ctx = {
      ui: {
        setStatus: () => {
          throw new Error("not supported");
        },
      },
    };
    const state = makeState();
    expect(() => updateStatusBar(ctx, state)).not.toThrow();
  });
});

describe("clearStatusBar", () => {
  it("calls setStatus with empty string", () => {
    const setStatus = vi.fn();
    const ctx = { ui: { setStatus } };
    clearStatusBar(ctx);
    expect(setStatus).toHaveBeenCalledWith("pi-red-green", undefined);
  });

  it("does not throw when setStatus is undefined", () => {
    const ctx = { ui: {} };
    expect(() => clearStatusBar(ctx)).not.toThrow();
  });
});
