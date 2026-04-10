import type { TddState, TddConfig, EnforcementLevel } from "./types.js";
import { getRedPhasePrompt } from "./prompts/red-phase.js";
import { getGreenPhasePrompt } from "./prompts/green-phase.js";
import { getRefactorPhasePrompt } from "./prompts/refactor-phase.js";
import { getNudgePrompt } from "./prompts/nudge.js";
import { getStaleTestWarning, getOrderingWarning } from "./prompts/warnings.js";

export function buildTddInjectionBlock(
  state: TddState,
  config: TddConfig,
): string | null {
  if (config.injection_mode === "off") return null;

  if (state.phase === "idle") {
    if (config.injection_mode === "active-only") return null;
    return `\n\n${getNudgePrompt()}`;
  }

  const parts: string[] = [];

  const phasePrompt = getPhasePrompt(state);
  if (phasePrompt) parts.push(phasePrompt);

  if (isTestRunStale(state)) {
    parts.push(getStaleTestWarning());
  }

  const orderingWarning = getFileOrderingWarning(state, config.ordering_enforcement);
  if (orderingWarning) parts.push(orderingWarning);

  if (parts.length === 0) return null;
  return "\n\n" + parts.join("\n\n");
}

function getPhasePrompt(state: TddState): string | null {
  switch (state.phase) {
    case "red":
      return getRedPhasePrompt(state.task);
    case "green":
      return getGreenPhasePrompt(state.task, state.last_test_run?.failed ?? 0);
    case "refactor":
      return getRefactorPhasePrompt(state.task);
    case "complete":
      return null;
    case "idle":
      return null;
  }
}

export function isTestRunStale(state: TddState): boolean {
  if (!state.last_test_run) return false;
  return state.last_test_run.turn_index < state.current_turn_index;
}

function getFileOrderingWarning(
  state: TddState,
  enforcement: EnforcementLevel,
): string | null {
  if (enforcement === "off") return null;
  if (state.phase !== "red") return null;

  if (state.impl_files.length > 0 && state.test_files.length === 0) {
    return getOrderingWarning(enforcement);
  }

  return null;
}

export interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
  systemPrompt: string;
}

export interface InjectionResult {
  systemPrompt: string;
}

export function handleBeforeAgentStart(
  event: BeforeAgentStartEvent,
  state: TddState,
  config: TddConfig,
): InjectionResult | undefined {
  const block = buildTddInjectionBlock(state, config);
  if (!block) return undefined;
  return { systemPrompt: event.systemPrompt + block };
}
