import { describe, it, expect } from "vitest";
import { buildTddInjectionBlock, handleBeforeAgentStart, isTestRunStale } from "./tdd-injector.js";
import { createInitialState, createIdleState } from "./state-machine.js";
import { DEFAULT_CONFIG } from "./config.js";
import type { TddState, TddConfig } from "./types.js";

function makeConfig(overrides: Partial<TddConfig> = {}): TddConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

function makeState(overrides: Partial<TddState> = {}): TddState {
  return { ...createInitialState("Add auth", "s1", "p1"), ...overrides };
}

describe("buildTddInjectionBlock", () => {
  it("returns null when injection_mode is off", () => {
    const config = makeConfig({ injection_mode: "off" });
    const state = makeState();
    expect(buildTddInjectionBlock(state, config)).toBeNull();
  });

  it("returns null for idle state in active-only mode", () => {
    const config = makeConfig({ injection_mode: "active-only" });
    const state = createIdleState("s1", "p1");
    expect(buildTddInjectionBlock(state, config)).toBeNull();
  });

  it("returns nudge prompt for idle state in nudge mode", () => {
    const config = makeConfig({ injection_mode: "nudge" });
    const state = createIdleState("s1", "p1");
    const result = buildTddInjectionBlock(state, config);
    expect(result).toContain("Consider writing tests first");
  });

  it("returns nudge prompt for idle state in always mode", () => {
    const config = makeConfig({ injection_mode: "always" });
    const state = createIdleState("s1", "p1");
    const result = buildTddInjectionBlock(state, config);
    expect(result).toContain("Consider writing tests first");
  });

  it("returns RED phase prompt for red state", () => {
    const config = makeConfig();
    const state = makeState({ phase: "red" });
    const result = buildTddInjectionBlock(state, config);
    expect(result).toContain("RED Phase");
    expect(result).toContain("Add auth");
    expect(result).toContain("Rationalization Prevention");
  });

  it("returns GREEN phase prompt for green state", () => {
    const config = makeConfig();
    const state = makeState({ phase: "green" });
    const result = buildTddInjectionBlock(state, config);
    expect(result).toContain("GREEN Phase");
    expect(result).toContain("SIMPLEST code");
  });

  it("returns REFACTOR phase prompt for refactor state", () => {
    const config = makeConfig();
    const state = makeState({ phase: "refactor" });
    const result = buildTddInjectionBlock(state, config);
    expect(result).toContain("REFACTOR Phase");
    expect(result).toContain("Keep tests green");
  });

  it("returns null for complete state", () => {
    const config = makeConfig();
    const state = makeState({ phase: "complete" });
    expect(buildTddInjectionBlock(state, config)).toBeNull();
  });

  it("includes staleness warning when test run is from previous turn", () => {
    const config = makeConfig();
    const state = makeState({
      phase: "green",
      current_turn_index: 5,
      last_test_run: {
        timestamp: "2026-01-01T00:00:00Z",
        turn_index: 3,
        passed: 0,
        failed: 2,
        errors: 0,
        exit_code: 1,
      },
    });
    const result = buildTddInjectionBlock(state, config);
    expect(result).toContain("Stale test results");
  });

  it("does not include staleness warning for current turn", () => {
    const config = makeConfig();
    const state = makeState({
      phase: "green",
      current_turn_index: 3,
      last_test_run: {
        timestamp: "2026-01-01T00:00:00Z",
        turn_index: 3,
        passed: 0,
        failed: 2,
        errors: 0,
        exit_code: 1,
      },
    });
    const result = buildTddInjectionBlock(state, config);
    expect(result).not.toContain("Stale test results");
  });

  it("includes ordering warning when impl files exist before test files in red phase", () => {
    const config = makeConfig({ ordering_enforcement: "warn" });
    const state = makeState({
      phase: "red",
      test_files: [],
      impl_files: ["src/auth.ts"],
    });
    const result = buildTddInjectionBlock(state, config);
    expect(result).toContain("TDD Warning");
  });

  it("includes strict ordering warning in strict mode", () => {
    const config = makeConfig({ ordering_enforcement: "strict" });
    const state = makeState({
      phase: "red",
      test_files: [],
      impl_files: ["src/auth.ts"],
    });
    const result = buildTddInjectionBlock(state, config);
    expect(result).toContain("TDD Violation");
    expect(result).toContain("Delete the implementation");
  });

  it("does not include ordering warning when ordering_enforcement is off", () => {
    const config = makeConfig({ ordering_enforcement: "off" });
    const state = makeState({
      phase: "red",
      test_files: [],
      impl_files: ["src/auth.ts"],
    });
    const result = buildTddInjectionBlock(state, config);
    expect(result).not.toContain("TDD Warning");
    expect(result).not.toContain("TDD Violation");
  });

  it("does not include ordering warning in green phase", () => {
    const config = makeConfig({ ordering_enforcement: "warn" });
    const state = makeState({
      phase: "green",
      test_files: [],
      impl_files: ["src/auth.ts"],
    });
    const result = buildTddInjectionBlock(state, config);
    expect(result).not.toContain("TDD Warning");
  });
});

describe("isTestRunStale", () => {
  it("returns false when no test run exists", () => {
    const state = makeState({ last_test_run: null });
    expect(isTestRunStale(state)).toBe(false);
  });

  it("returns true when test run is from a previous turn", () => {
    const state = makeState({
      current_turn_index: 5,
      last_test_run: { timestamp: "", turn_index: 3, passed: 0, failed: 0, errors: 0, exit_code: 0 },
    });
    expect(isTestRunStale(state)).toBe(true);
  });

  it("returns false when test run is from the current turn", () => {
    const state = makeState({
      current_turn_index: 3,
      last_test_run: { timestamp: "", turn_index: 3, passed: 0, failed: 0, errors: 0, exit_code: 0 },
    });
    expect(isTestRunStale(state)).toBe(false);
  });
});

describe("handleBeforeAgentStart", () => {
  it("returns modified systemPrompt when injection applies", () => {
    const event = { type: "before_agent_start" as const, prompt: "do stuff", systemPrompt: "base prompt" };
    const state = makeState({ phase: "red" });
    const config = makeConfig();
    const result = handleBeforeAgentStart(event, state, config);
    expect(result).toBeDefined();
    expect(result!.systemPrompt).toContain("base prompt");
    expect(result!.systemPrompt).toContain("RED Phase");
  });

  it("returns undefined when no injection needed", () => {
    const event = { type: "before_agent_start" as const, prompt: "do stuff", systemPrompt: "base prompt" };
    const state = createIdleState("s1", "p1");
    const config = makeConfig({ injection_mode: "active-only" });
    const result = handleBeforeAgentStart(event, state, config);
    expect(result).toBeUndefined();
  });
});
