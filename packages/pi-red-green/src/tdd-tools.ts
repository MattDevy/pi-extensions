import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type StateRef, recordCycle } from "./tdd-command.js";
import { advancePhase, createIdleState } from "./state-machine.js";
import { saveState, clearState } from "./storage.js";
import { isTestRunStale } from "./tdd-injector.js";

const StatusParams = Type.Object({});

const AdvanceParams = Type.Object({
  reason: Type.Optional(
    Type.String({ description: "Why you are manually advancing the phase" }),
  ),
});

const ResetParams = Type.Object({
  reason: Type.Optional(
    Type.String({ description: "Why you are resetting the TDD state" }),
  ),
});

function createStatusTool(stateRef: StateRef) {
  return {
    name: "tdd_status" as const,
    label: "TDD Status",
    description: "Returns the current TDD phase, task, file history, test results, and staleness",
    promptSnippet: "Check the current TDD state and phase",
    parameters: StatusParams,
    async execute(
      _toolCallId: string,
      _params: Record<string, never>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      const state = stateRef.get();
      if (!state || state.phase === "idle") {
        return {
          content: [{ type: "text" as const, text: "TDD is not active." }],
          details: { phase: "idle" },
        };
      }

      const stale = isTestRunStale(state);
      const summary = [
        `Phase: ${state.phase}`,
        `Task: ${state.task}`,
        `Test files: ${state.test_files.join(", ") || "(none)"}`,
        `Impl files: ${state.impl_files.join(", ") || "(none)"}`,
        state.last_test_run
          ? `Last run: ${state.last_test_run.passed} passed, ${state.last_test_run.failed} failed, ${state.last_test_run.errors} errors${stale ? " (STALE)" : ""}`
          : "Last run: (none)",
      ].join("\n");

      return {
        content: [{ type: "text" as const, text: summary }],
        details: { ...state, is_stale: stale },
      };
    },
  };
}

function createAdvanceTool(stateRef: StateRef) {
  return {
    name: "tdd_advance" as const,
    label: "TDD Advance",
    description: "Manually advance to the next TDD phase (escape hatch when auto-detection misses)",
    promptSnippet: "Manually advance the TDD phase when auto-detection doesn't trigger",
    parameters: AdvanceParams,
    async execute(
      _toolCallId: string,
      _params: { reason?: string },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      const state = stateRef.get();
      if (!state || state.phase === "idle") {
        throw new Error("No active TDD session. Use /tdd to start one.");
      }

      const result = advancePhase(state, "manual_advance");
      stateRef.set(result.state);
      saveState(result.state);

      const text = result.warning
        ? result.warning
        : `Advanced to ${result.state.phase.toUpperCase()}`;

      return {
        content: [{ type: "text" as const, text }],
        details: { phase: result.state.phase, warning: result.warning },
      };
    },
  };
}

function createResetTool(stateRef: StateRef) {
  return {
    name: "tdd_reset" as const,
    label: "TDD Reset",
    description: "Reset TDD state to idle, optionally recording the partial cycle",
    promptSnippet: "Reset the TDD session to idle state",
    parameters: ResetParams,
    async execute(
      _toolCallId: string,
      _params: { reason?: string },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      const state = stateRef.get();
      if (!state || state.phase === "idle") {
        return {
          content: [{ type: "text" as const, text: "TDD is already idle." }],
          details: { phase: "idle" },
        };
      }

      recordCycle(state);

      const idleState = createIdleState(state.session_id, state.project_id);
      stateRef.set(idleState);
      clearState();

      return {
        content: [{ type: "text" as const, text: "TDD reset to idle." }],
        details: { phase: "idle" as string },
      };
    },
  };
}

export function registerTddTools(
  pi: ExtensionAPI,
  stateRef: StateRef,
): void {
  const guidelines = [
    "Use TDD tools to check, advance, or reset the current TDD session state.",
  ];

  pi.registerTool({
    ...createStatusTool(stateRef),
    promptGuidelines: guidelines,
  });
  pi.registerTool({
    ...createAdvanceTool(stateRef),
    promptGuidelines: guidelines,
  });
  pi.registerTool({
    ...createResetTool(stateRef),
    promptGuidelines: guidelines,
  });
}
