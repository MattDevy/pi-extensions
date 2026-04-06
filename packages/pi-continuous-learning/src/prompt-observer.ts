/**
 * User prompt and agent end observation handlers for pi-continuous-learning.
 * Captures before_agent_start (user_prompt) and agent_end events as JSONL observations.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// Local event type definitions (not all pi-coding-agent versions re-export these at top level)
export interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
  systemPrompt: string;
}

export interface AgentEndEvent {
  type: "agent_end";
}

import { getCurrentActiveInstincts } from "./active-instincts.js";
import { appendObservation } from "./observations.js";
import { shouldSkipObservation } from "./observer-guard.js";
import { scrubSecrets } from "./scrubber.js";
import { logError } from "./error-logger.js";
import type { Observation, ProjectEntry } from "./types.js";

function getSessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function buildActiveInstincts(): Pick<Observation, "active_instincts"> {
  const ids = getCurrentActiveInstincts();
  return ids.length > 0 ? { active_instincts: ids } : {};
}

/**
 * Handles before_agent_start events.
 * Records an observation with event: user_prompt and scrubbed prompt text.
 */
export function handleBeforeAgentStart(
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext,
  project: ProjectEntry,
  baseDir?: string,
): void {
  try {
    if (shouldSkipObservation()) return;

    const input = scrubSecrets(event.prompt);

    const observation: Observation = {
      timestamp: new Date().toISOString(),
      event: "user_prompt",
      session: getSessionId(ctx),
      project_id: project.id,
      project_name: project.name,
      input,
      ...buildActiveInstincts(),
    };

    appendObservation(observation, project.id, baseDir);
  } catch (err) {
    logError(
      project.id,
      "prompt-observer:handleBeforeAgentStart",
      err,
      baseDir,
    );
  }
}

/**
 * Handles agent_end events.
 * Records an observation with event: agent_end.
 */
export function handleAgentEnd(
  _event: AgentEndEvent,
  ctx: ExtensionContext,
  project: ProjectEntry,
  baseDir?: string,
): void {
  try {
    if (shouldSkipObservation()) return;

    const contextUsage = ctx.getContextUsage();
    const tokensUsed = contextUsage?.tokens ?? undefined;

    const observation: Observation = {
      timestamp: new Date().toISOString(),
      event: "agent_end",
      session: getSessionId(ctx),
      project_id: project.id,
      project_name: project.name,
      ...(tokensUsed != null ? { tokens_used: tokensUsed } : {}),
      ...buildActiveInstincts(),
    };

    appendObservation(observation, project.id, baseDir);
  } catch (err) {
    logError(project.id, "prompt-observer:handleAgentEnd", err, baseDir);
  }
}
