import { describe, it, expect } from "vitest";
import { createInitialState, createIdleState, advancePhase } from "./state-machine.js";
import type { TddState } from "./types.js";

function makeRedState(overrides: Partial<TddState> = {}): TddState {
  return {
    ...createInitialState("Add auth", "sess-1", "proj-1"),
    ...overrides,
  };
}

function makeGreenState(overrides: Partial<TddState> = {}): TddState {
  return {
    ...makeRedState(),
    phase: "green",
    ...overrides,
  };
}

function makeRefactorState(overrides: Partial<TddState> = {}): TddState {
  return {
    ...makeRedState(),
    phase: "refactor",
    ...overrides,
  };
}

function makeCompleteState(overrides: Partial<TddState> = {}): TddState {
  return {
    ...makeRedState(),
    phase: "complete",
    ...overrides,
  };
}

describe("createInitialState", () => {
  it("creates a state in red phase", () => {
    const state = createInitialState("Add auth", "sess-1", "proj-1");
    expect(state.phase).toBe("red");
    expect(state.task).toBe("Add auth");
    expect(state.session_id).toBe("sess-1");
    expect(state.project_id).toBe("proj-1");
    expect(state.test_files).toEqual([]);
    expect(state.impl_files).toEqual([]);
    expect(state.last_test_run).toBeNull();
    expect(state.phase_history).toHaveLength(1);
    expect(state.phase_history[0]?.phase).toBe("red");
    expect(state.current_turn_index).toBe(0);
  });
});

describe("createIdleState", () => {
  it("creates an idle state with no task", () => {
    const state = createIdleState("sess-1", "proj-1");
    expect(state.phase).toBe("idle");
    expect(state.task).toBe("");
    expect(state.phase_history).toEqual([]);
  });
});

describe("advancePhase from RED", () => {
  it("advances to GREEN on tests_fail", () => {
    const result = advancePhase(makeRedState(), "tests_fail");
    expect(result.state.phase).toBe("green");
    expect(result.warning).toBeNull();
  });

  it("stays in RED with warning on tests_error", () => {
    const result = advancePhase(makeRedState(), "tests_error");
    expect(result.state.phase).toBe("red");
    expect(result.warning).toContain("Fix the test error");
  });

  it("stays in RED with warning on tests_pass", () => {
    const result = advancePhase(makeRedState(), "tests_pass");
    expect(result.state.phase).toBe("red");
    expect(result.warning).toContain("Tests should be failing");
  });

  it("advances to GREEN on manual_advance", () => {
    const result = advancePhase(makeRedState(), "manual_advance");
    expect(result.state.phase).toBe("green");
    expect(result.warning).toBeNull();
  });

  it("resets to idle on reset", () => {
    const result = advancePhase(makeRedState(), "reset");
    expect(result.state.phase).toBe("idle");
    expect(result.warning).toBeNull();
  });

  it("appends phase history entry on transition", () => {
    const result = advancePhase(makeRedState(), "tests_fail");
    expect(result.state.phase_history.length).toBeGreaterThan(1);
    const lastEntry = result.state.phase_history[result.state.phase_history.length - 1];
    expect(lastEntry?.phase).toBe("green");
  });
});

describe("advancePhase from GREEN", () => {
  it("advances to REFACTOR on tests_pass", () => {
    const result = advancePhase(makeGreenState(), "tests_pass");
    expect(result.state.phase).toBe("refactor");
    expect(result.warning).toBeNull();
  });

  it("stays in GREEN with warning on tests_fail", () => {
    const result = advancePhase(makeGreenState(), "tests_fail");
    expect(result.state.phase).toBe("green");
    expect(result.warning).toContain("Tests still failing");
  });

  it("stays in GREEN with warning on tests_error", () => {
    const result = advancePhase(makeGreenState(), "tests_error");
    expect(result.state.phase).toBe("green");
    expect(result.warning).toContain("Runtime error");
  });

  it("advances to REFACTOR on manual_advance", () => {
    const result = advancePhase(makeGreenState(), "manual_advance");
    expect(result.state.phase).toBe("refactor");
    expect(result.warning).toBeNull();
  });

  it("resets to idle on reset", () => {
    const result = advancePhase(makeGreenState(), "reset");
    expect(result.state.phase).toBe("idle");
  });
});

describe("advancePhase from REFACTOR", () => {
  it("advances to COMPLETE on tests_pass", () => {
    const result = advancePhase(makeRefactorState(), "tests_pass");
    expect(result.state.phase).toBe("complete");
    expect(result.warning).toBeNull();
  });

  it("stays in REFACTOR with warning on tests_fail", () => {
    const result = advancePhase(makeRefactorState(), "tests_fail");
    expect(result.state.phase).toBe("refactor");
    expect(result.warning).toContain("Refactoring broke tests");
  });

  it("stays in REFACTOR with warning on tests_error", () => {
    const result = advancePhase(makeRefactorState(), "tests_error");
    expect(result.state.phase).toBe("refactor");
    expect(result.warning).toContain("Runtime error");
  });

  it("advances to COMPLETE on manual_advance", () => {
    const result = advancePhase(makeRefactorState(), "manual_advance");
    expect(result.state.phase).toBe("complete");
    expect(result.warning).toBeNull();
  });

  it("resets to idle on reset", () => {
    const result = advancePhase(makeRefactorState(), "reset");
    expect(result.state.phase).toBe("idle");
  });
});

describe("advancePhase from COMPLETE", () => {
  it("stays in COMPLETE with warning on tests_pass", () => {
    const result = advancePhase(makeCompleteState(), "tests_pass");
    expect(result.state.phase).toBe("complete");
    expect(result.warning).toContain("complete");
  });

  it("stays in COMPLETE with warning on manual_advance", () => {
    const result = advancePhase(makeCompleteState(), "manual_advance");
    expect(result.state.phase).toBe("complete");
    expect(result.warning).toContain("already complete");
  });

  it("resets to idle on reset", () => {
    const result = advancePhase(makeCompleteState(), "reset");
    expect(result.state.phase).toBe("idle");
  });
});

describe("advancePhase from IDLE", () => {
  it("stays idle with warning on tests_pass", () => {
    const state = createIdleState("sess-1", "proj-1");
    const result = advancePhase(state, "tests_pass");
    expect(result.state.phase).toBe("idle");
    expect(result.warning).toContain("No active TDD session");
  });

  it("stays idle on reset (no-op)", () => {
    const state = createIdleState("sess-1", "proj-1");
    const result = advancePhase(state, "reset");
    expect(result.state.phase).toBe("idle");
    expect(result.warning).toBeNull();
  });
});

describe("immutability", () => {
  it("does not mutate the original state", () => {
    const original = makeRedState();
    const result = advancePhase(original, "tests_fail");
    expect(original.phase).toBe("red");
    expect(result.state.phase).toBe("green");
  });
});
