import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { createInitialState, createIdleState } from "./state-machine.js";
import { saveState, clearState, appendCycleRecord } from "./storage.js";
import { updateStatusBar, clearStatusBar, formatStatusText } from "./status-bar.js";
import type { TddState, TddConfig, TddCycleRecord } from "./types.js";

export const COMMAND_NAME = "tdd";

export interface StateRef {
  get: () => TddState | null;
  set: (s: TddState) => void;
  getConfig: () => TddConfig | null;
}

export async function handleTddCommand(
  args: string,
  ctx: ExtensionCommandContext,
  stateRef: StateRef,
): Promise<void> {
  const trimmed = args.trim();

  if (trimmed === "") {
    return showStatus(ctx, stateRef);
  }

  if (trimmed.toLowerCase() === "off") {
    return deactivate(ctx, stateRef);
  }

  return activate(trimmed, ctx, stateRef);
}

function showStatus(ctx: ExtensionCommandContext, stateRef: StateRef): void {
  const state = stateRef.get();
  if (!state || state.phase === "idle") {
    ctx.ui.notify("TDD is not active. Use /tdd <task description> to start.", "info");
    return;
  }
  ctx.ui.notify(formatStatusText(state), "info");
}

function activate(
  task: string,
  ctx: ExtensionCommandContext,
  stateRef: StateRef,
): void {
  const currentState = stateRef.get();

  // If already active, record the previous cycle before starting new
  if (currentState && currentState.phase !== "idle") {
    recordCycle(currentState);
  }

  const sessionId = currentState?.session_id ?? "";
  const projectId = currentState?.project_id ?? "";
  const newState = createInitialState(task, sessionId, projectId);
  stateRef.set(newState);
  saveState(newState);
  updateStatusBar(ctx, newState);
  ctx.ui.notify(`TDD activated: ${task}\nPhase: RED -- Send a message to begin. The agent will be guided to write tests first.`, "info");
}

function deactivate(ctx: ExtensionCommandContext, stateRef: StateRef): void {
  const state = stateRef.get();

  if (!state || state.phase === "idle") {
    ctx.ui.notify("TDD is not active.", "info");
    return;
  }

  recordCycle(state);
  const idleState = createIdleState(state.session_id, state.project_id);
  stateRef.set(idleState);
  clearState();
  clearStatusBar(ctx);
  ctx.ui.notify("TDD deactivated.", "info");
}

export function recordCycle(state: TddState): void {
  const record: TddCycleRecord = {
    task: state.task,
    session_id: state.session_id,
    project_id: state.project_id,
    started_at: state.started_at,
    completed_at: new Date().toISOString(),
    final_phase: state.phase,
    test_files: state.test_files,
    impl_files: state.impl_files,
    phase_history: state.phase_history,
  };
  appendCycleRecord(record);
}
