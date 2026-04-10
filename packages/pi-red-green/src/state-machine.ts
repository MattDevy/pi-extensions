import type {
  TddPhase,
  TddState,
  PhaseTransitionTrigger,
  PhaseTransitionResult,
  PhaseHistoryEntry,
} from "./types.js";

export function createInitialState(
  task: string,
  sessionId: string,
  projectId: string,
): TddState {
  const now = new Date().toISOString();
  return {
    phase: "red",
    task,
    started_at: now,
    session_id: sessionId,
    project_id: projectId,
    test_files: [],
    impl_files: [],
    last_test_run: null,
    phase_history: [{ phase: "red", entered_at: now }],
    current_turn_index: 0,
  };
}

export function createIdleState(
  sessionId: string,
  projectId: string,
): TddState {
  return {
    phase: "idle",
    task: "",
    started_at: "",
    session_id: sessionId,
    project_id: projectId,
    test_files: [],
    impl_files: [],
    last_test_run: null,
    phase_history: [],
    current_turn_index: 0,
  };
}

function addPhaseEntry(
  history: readonly PhaseHistoryEntry[],
  phase: TddPhase,
): readonly PhaseHistoryEntry[] {
  return [...history, { phase, entered_at: new Date().toISOString() }];
}

function transitionFromRed(
  state: TddState,
  trigger: PhaseTransitionTrigger,
): PhaseTransitionResult {
  switch (trigger) {
    case "tests_fail":
      return {
        state: { ...state, phase: "green", phase_history: addPhaseEntry(state.phase_history, "green") },
        warning: null,
      };
    case "tests_error":
      return {
        state,
        warning: "Fix the test error (typo? missing import?). Don't write implementation yet.",
      };
    case "tests_pass":
      return {
        state,
        warning: "Tests should be failing. You're testing existing behavior, not new behavior. Fix the test to assert the new, unimplemented behavior.",
      };
    case "manual_advance":
      return {
        state: { ...state, phase: "green", phase_history: addPhaseEntry(state.phase_history, "green") },
        warning: null,
      };
    case "reset":
      return {
        state: createIdleState(state.session_id, state.project_id),
        warning: null,
      };
  }
}

function transitionFromGreen(
  state: TddState,
  trigger: PhaseTransitionTrigger,
): PhaseTransitionResult {
  switch (trigger) {
    case "tests_pass":
      return {
        state: { ...state, phase: "refactor", phase_history: addPhaseEntry(state.phase_history, "refactor") },
        warning: null,
      };
    case "tests_fail":
      return {
        state,
        warning: "Tests still failing. Continue implementing.",
      };
    case "tests_error":
      return {
        state,
        warning: "Runtime error in implementation. Fix it.",
      };
    case "manual_advance":
      return {
        state: { ...state, phase: "refactor", phase_history: addPhaseEntry(state.phase_history, "refactor") },
        warning: null,
      };
    case "reset":
      return {
        state: createIdleState(state.session_id, state.project_id),
        warning: null,
      };
  }
}

function transitionFromRefactor(
  state: TddState,
  trigger: PhaseTransitionTrigger,
): PhaseTransitionResult {
  switch (trigger) {
    case "tests_pass":
      return {
        state: { ...state, phase: "complete", phase_history: addPhaseEntry(state.phase_history, "complete") },
        warning: null,
      };
    case "tests_fail":
      return {
        state,
        warning: "Refactoring broke tests. Revert the last change.",
      };
    case "tests_error":
      return {
        state,
        warning: "Runtime error after refactoring. Revert the last change.",
      };
    case "manual_advance":
      return {
        state: { ...state, phase: "complete", phase_history: addPhaseEntry(state.phase_history, "complete") },
        warning: null,
      };
    case "reset":
      return {
        state: createIdleState(state.session_id, state.project_id),
        warning: null,
      };
  }
}

function transitionFromComplete(
  state: TddState,
  trigger: PhaseTransitionTrigger,
): PhaseTransitionResult {
  switch (trigger) {
    case "reset":
      return {
        state: createIdleState(state.session_id, state.project_id),
        warning: null,
      };
    case "manual_advance":
      return {
        state,
        warning: "TDD cycle is already complete. Use /tdd to start a new task or /tdd off to deactivate.",
      };
    default:
      return {
        state,
        warning: "TDD cycle is complete. Start a new task with /tdd.",
      };
  }
}

function transitionFromIdle(
  state: TddState,
  trigger: PhaseTransitionTrigger,
): PhaseTransitionResult {
  if (trigger === "reset") {
    return { state, warning: null };
  }
  return {
    state,
    warning: "No active TDD session. Use /tdd to start one.",
  };
}

export function advancePhase(
  state: TddState,
  trigger: PhaseTransitionTrigger,
): PhaseTransitionResult {
  switch (state.phase) {
    case "idle":
      return transitionFromIdle(state, trigger);
    case "red":
      return transitionFromRed(state, trigger);
    case "green":
      return transitionFromGreen(state, trigger);
    case "refactor":
      return transitionFromRefactor(state, trigger);
    case "complete":
      return transitionFromComplete(state, trigger);
  }
}
