import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getCurrentActiveInstincts } from "./active-instincts.js";
import { appendObservation } from "./observations.js";
import { scrubSecrets } from "./scrubber.js";
import { logError } from "./error-logger.js";
import type { Observation, ProjectEntry } from "./types.js";

export interface TurnStartEvent {
  type: "turn_start";
  turnIndex: number;
  timestamp: number;
}

export interface TurnEndEvent {
  type: "turn_end";
  turnIndex: number;
  message: unknown;
  toolResults: unknown[];
}

export interface UserBashEvent {
  type: "user_bash";
  command: string;
  excludeFromContext: boolean;
  cwd: string;
}

export interface SessionCompactEvent {
  type: "session_compact";
  compactionEntry: unknown;
  fromExtension: boolean;
}

export interface ModelSelectEvent {
  type: "model_select";
  model: { id?: string; name?: string };
  previousModel: { id?: string; name?: string } | undefined;
  source: "set" | "cycle" | "restore";
}

function getSessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

function buildActiveInstincts(): Pick<Observation, "active_instincts"> {
  const ids = getCurrentActiveInstincts();
  return ids.length > 0 ? { active_instincts: ids } : {};
}

export function handleTurnStart(
  event: TurnStartEvent,
  ctx: ExtensionContext,
  project: ProjectEntry,
  baseDir?: string,
): void {
  try {
    const observation: Observation = {
      timestamp: new Date().toISOString(),
      event: "turn_start",
      session: getSessionId(ctx),
      project_id: project.id,
      project_name: project.name,
      turn_index: event.turnIndex,
      ...buildActiveInstincts(),
    };

    appendObservation(observation, project.id, baseDir);
  } catch (err) {
    logError(project.id, "session-observer:handleTurnStart", err, baseDir);
  }
}

export function handleTurnEnd(
  event: TurnEndEvent,
  ctx: ExtensionContext,
  project: ProjectEntry,
  baseDir?: string,
): void {
  try {
    const toolCount = event.toolResults?.length ?? 0;
    const errorCount = Array.isArray(event.toolResults)
      ? event.toolResults.filter((r: unknown) => {
          if (r && typeof r === "object" && "isError" in r) {
            return (r as { isError: boolean }).isError;
          }
          return false;
        }).length
      : 0;

    const contextUsage = ctx.getContextUsage();
    const tokensUsed = contextUsage?.tokens ?? undefined;

    const observation: Observation = {
      timestamp: new Date().toISOString(),
      event: "turn_end",
      session: getSessionId(ctx),
      project_id: project.id,
      project_name: project.name,
      turn_index: event.turnIndex,
      tool_count: toolCount,
      error_count: errorCount,
      ...(tokensUsed != null ? { tokens_used: tokensUsed } : {}),
      ...buildActiveInstincts(),
    };

    appendObservation(observation, project.id, baseDir);
  } catch (err) {
    logError(project.id, "session-observer:handleTurnEnd", err, baseDir);
  }
}

export function handleUserBash(
  event: UserBashEvent,
  ctx: ExtensionContext,
  project: ProjectEntry,
  baseDir?: string,
): void {
  try {
    const observation: Observation = {
      timestamp: new Date().toISOString(),
      event: "user_bash",
      session: getSessionId(ctx),
      project_id: project.id,
      project_name: project.name,
      command: scrubSecrets(event.command),
      cwd: event.cwd,
      ...buildActiveInstincts(),
    };

    appendObservation(observation, project.id, baseDir);
  } catch (err) {
    logError(project.id, "session-observer:handleUserBash", err, baseDir);
  }
}

export function handleSessionCompact(
  event: SessionCompactEvent,
  ctx: ExtensionContext,
  project: ProjectEntry,
  baseDir?: string,
): void {
  try {
    const observation: Observation = {
      timestamp: new Date().toISOString(),
      event: "session_compact",
      session: getSessionId(ctx),
      project_id: project.id,
      project_name: project.name,
      from_extension: event.fromExtension,
      ...buildActiveInstincts(),
    };

    appendObservation(observation, project.id, baseDir);
  } catch (err) {
    logError(project.id, "session-observer:handleSessionCompact", err, baseDir);
  }
}

export function handleModelSelect(
  event: ModelSelectEvent,
  ctx: ExtensionContext,
  project: ProjectEntry,
  baseDir?: string,
): void {
  try {
    const modelName = event.model?.id ?? event.model?.name ?? "unknown";
    const previousModelName =
      event.previousModel?.id ?? event.previousModel?.name;

    const observation: Observation = {
      timestamp: new Date().toISOString(),
      event: "model_select",
      session: getSessionId(ctx),
      project_id: project.id,
      project_name: project.name,
      model: modelName,
      ...(previousModelName ? { previous_model: previousModelName } : {}),
      model_change_source: event.source,
    };

    appendObservation(observation, project.id, baseDir);
  } catch (err) {
    logError(project.id, "session-observer:handleModelSelect", err, baseDir);
  }
}
