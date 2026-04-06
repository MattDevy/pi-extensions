/**
 * Tool call observation handlers for pi-continuous-learning.
 * Captures tool_execution_start and tool_execution_end events as JSONL observations.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// Local event type definitions (not all pi-coding-agent versions re-export these at top level)
export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

import { getCurrentActiveInstincts } from "./active-instincts.js";
import { appendObservation } from "./observations.js";
import { shouldSkipObservation } from "./observer-guard.js";
import { scrubSecrets } from "./scrubber.js";
import { logError } from "./error-logger.js";
import type { Observation, ProjectEntry } from "./types.js";

export const MAX_TOOL_INPUT_LENGTH = 5000;
export const MAX_TOOL_OUTPUT_LENGTH = 5000;

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function getSessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function buildActiveInstincts(): Pick<Observation, "active_instincts"> {
  const ids = getCurrentActiveInstincts();
  return ids.length > 0 ? { active_instincts: ids } : {};
}

/**
 * Handles tool_execution_start events.
 * Records an observation with event: tool_start, tool name, and scrubbed/truncated input.
 */
export function handleToolStart(
  event: ToolExecutionStartEvent,
  ctx: ExtensionContext,
  project: ProjectEntry,
  baseDir?: string,
): void {
  try {
    if (shouldSkipObservation()) return;

    const raw =
      typeof event.args === "string" ? event.args : JSON.stringify(event.args);
    const input = truncate(scrubSecrets(raw), MAX_TOOL_INPUT_LENGTH);

    const observation: Observation = {
      timestamp: new Date().toISOString(),
      event: "tool_start",
      session: getSessionId(ctx),
      project_id: project.id,
      project_name: project.name,
      tool: event.toolName,
      input,
      ...buildActiveInstincts(),
    };

    appendObservation(observation, project.id, baseDir);
  } catch (err) {
    logError(project.id, "tool-observer:handleToolStart", err, baseDir);
  }
}

/**
 * Handles tool_execution_end events.
 * Records an observation with event: tool_complete, tool name, scrubbed/truncated output, and is_error.
 */
export function handleToolEnd(
  event: ToolExecutionEndEvent,
  ctx: ExtensionContext,
  project: ProjectEntry,
  baseDir?: string,
): void {
  try {
    if (shouldSkipObservation()) return;

    const raw =
      typeof event.result === "string"
        ? event.result
        : JSON.stringify(event.result);
    const output = truncate(scrubSecrets(raw), MAX_TOOL_OUTPUT_LENGTH);

    const observation: Observation = {
      timestamp: new Date().toISOString(),
      event: "tool_complete",
      session: getSessionId(ctx),
      project_id: project.id,
      project_name: project.name,
      tool: event.toolName,
      output,
      is_error: event.isError,
      ...buildActiveInstincts(),
    };

    appendObservation(observation, project.id, baseDir);
  } catch (err) {
    logError(project.id, "tool-observer:handleToolEnd", err, baseDir);
  }
}
