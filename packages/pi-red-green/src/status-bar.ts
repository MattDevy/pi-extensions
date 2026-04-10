import type { TddState, TddPhase } from "./types.js";

interface UiContext {
  ui: {
    setStatus?: (key: string, text: string | undefined) => void;
  };
}

const PHASE_LABELS: Record<TddPhase, string> = {
  idle: "IDLE",
  red: "RED",
  green: "GREEN",
  refactor: "REFACTOR",
  complete: "COMPLETE",
};

export function formatStatusText(state: TddState): string {
  const label = PHASE_LABELS[state.phase];
  if (state.phase === "idle" || !state.task) {
    return `TDD: ${label}`;
  }
  const truncatedTask =
    state.task.length > 40 ? state.task.slice(0, 37) + "..." : state.task;
  return `TDD: ${label} - ${truncatedTask}`;
}

export function updateStatusBar(ctx: UiContext, state: TddState): void {
  try {
    ctx.ui.setStatus?.("pi-red-green", formatStatusText(state));
  } catch {
    // Graceful fallback: setStatus may not be supported
  }
}

export function clearStatusBar(ctx: UiContext): void {
  try {
    ctx.ui.setStatus?.("pi-red-green", undefined);
  } catch {
    // Graceful fallback
  }
}
