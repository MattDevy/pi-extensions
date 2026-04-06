/**
 * Pi Continuous Learning Extension - Entry Point
 *
 * Observes coding sessions, records events as observations, and injects
 * learned instincts into the agent's system prompt. Background analysis
 * runs via a separate standalone script (src/cli/analyze.ts).
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { loadSkills } from "@mariozechner/pi-coding-agent";

import { loadConfig } from "./config.js";
import { detectProject } from "./project.js";
import { ensureStorageLayout } from "./storage.js";
import { cleanOldArchives } from "./observations.js";
import { handleToolStart, handleToolEnd } from "./tool-observer.js";
import { handleBeforeAgentStart, handleAgentEnd } from "./prompt-observer.js";
import {
  handleTurnStart,
  handleTurnEnd,
  handleUserBash,
  handleSessionCompact,
  handleModelSelect,
} from "./session-observer.js";
import {
  handleBeforeAgentStartInjection,
  handleAgentEndClearInstincts,
} from "./instinct-injector.js";
import {
  handleInstinctStatus,
  COMMAND_NAME as STATUS_CMD,
} from "./instinct-status.js";
import {
  handleInstinctExport,
  COMMAND_NAME as EXPORT_CMD,
} from "./instinct-export.js";
import {
  handleInstinctImport,
  COMMAND_NAME as IMPORT_CMD,
} from "./instinct-import.js";
import {
  handleInstinctPromote,
  COMMAND_NAME as PROMOTE_CMD,
} from "./instinct-promote.js";
import {
  handleInstinctEvolve,
  COMMAND_NAME as EVOLVE_CMD,
} from "./instinct-evolve.js";
import {
  handleInstinctProjects,
  COMMAND_NAME as PROJECTS_CMD,
} from "./instinct-projects.js";
import {
  handleInstinctGraduate,
  COMMAND_NAME as GRADUATE_CMD,
} from "./instinct-graduate.js";
import {
  handleInstinctDream,
  COMMAND_NAME as DREAM_CMD,
} from "./instinct-dream.js";
import { registerAllTools } from "./instinct-tools.js";
import { logError } from "./error-logger.js";
import { checkAnalysisNotifications } from "./analysis-notification.js";
import type { Config, InstalledSkill, ProjectEntry } from "./types.js";

export default function (pi: ExtensionAPI): void {
  let config: Config | null = null;
  let project: ProjectEntry | null = null;
  let installedSkills: InstalledSkill[] = [];

  pi.on("session_start", async (_event, ctx) => {
    try {
      config = loadConfig();
      project = await detectProject(pi, ctx.cwd);
      ensureStorageLayout(project);
      cleanOldArchives(project.id);

      try {
        const result = loadSkills({ cwd: ctx.cwd });
        installedSkills = result.skills.map((s) => ({
          name: s.name,
          description: s.description,
        }));
      } catch {
        installedSkills = [];
      }

      registerAllTools(pi, project.id, project.name);
    } catch (err) {
      logError(project?.id ?? null, "session_start", err);
    }
  });

  pi.on("session_shutdown", (_event, _ctx) => {
    // No cleanup needed — analyzer runs as external process
  });

  pi.on("before_agent_start", (event, ctx) => {
    try {
      if (!project || !config) return;
      handleBeforeAgentStart(event, ctx, project);
      checkAnalysisNotifications(ctx, project.id);
      return (
        handleBeforeAgentStartInjection(event, ctx, config, project.id) ??
        undefined
      );
    } catch (err) {
      logError(project?.id ?? null, "before_agent_start", err);
    }
  });

  pi.on("agent_start", (_event, _ctx) => {});

  pi.on("agent_end", (event, ctx) => {
    try {
      if (!project) return;
      handleAgentEnd(event, ctx, project);
      handleAgentEndClearInstincts(event, ctx);
    } catch (err) {
      logError(project?.id ?? null, "agent_end", err);
    }
  });

  pi.on("tool_execution_start", (event, ctx) => {
    try {
      if (!project) return;
      handleToolStart(event, ctx, project);
    } catch (err) {
      logError(project?.id ?? null, "tool_execution_start", err);
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    try {
      if (!project) return;
      handleToolEnd(event, ctx, project);
    } catch (err) {
      logError(project?.id ?? null, "tool_execution_end", err);
    }
  });

  pi.on("turn_start", (event, ctx) => {
    try {
      if (!project) return;
      handleTurnStart(event, ctx, project);
    } catch (err) {
      logError(project?.id ?? null, "turn_start", err);
    }
  });

  pi.on("turn_end", (event, ctx) => {
    try {
      if (!project) return;
      handleTurnEnd(event, ctx, project);
    } catch (err) {
      logError(project?.id ?? null, "turn_end", err);
    }
  });

  pi.on("user_bash", (event, ctx) => {
    try {
      if (!project) return;
      handleUserBash(event, ctx, project);
    } catch (err) {
      logError(project?.id ?? null, "user_bash", err);
    }
  });

  pi.on("session_compact", (event, ctx) => {
    try {
      if (!project) return;
      handleSessionCompact(event, ctx, project);
    } catch (err) {
      logError(project?.id ?? null, "session_compact", err);
    }
  });

  pi.on("model_select", (event, ctx) => {
    try {
      if (!project) return;
      handleModelSelect(event, ctx, project);
    } catch (err) {
      logError(project?.id ?? null, "model_select", err);
    }
  });

  pi.registerCommand(STATUS_CMD, {
    description: "Show all instincts grouped by domain with confidence scores",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctStatus(args, ctx, project?.id),
  });

  pi.registerCommand(EXPORT_CMD, {
    description: "Export instincts to a JSON file",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctExport(args, ctx, project?.id),
  });

  pi.registerCommand(IMPORT_CMD, {
    description: "Import instincts from a JSON file",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctImport(args, ctx, project?.id),
  });

  pi.registerCommand(PROMOTE_CMD, {
    description: "Promote project instincts to global scope",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctPromote(args, ctx, project?.id),
  });

  pi.registerCommand(EVOLVE_CMD, {
    description: "Analyze instincts and suggest improvements (LLM-powered)",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctEvolve(
        args,
        ctx,
        pi,
        project?.id,
        undefined,
        project?.root ?? null,
        installedSkills,
      ),
  });

  pi.registerCommand(PROJECTS_CMD, {
    description: "List all known projects and their instinct counts",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctProjects(args, ctx),
  });

  pi.registerCommand(GRADUATE_CMD, {
    description: "Graduate mature instincts to AGENTS.md, skills, or commands",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctGraduate(
        args,
        ctx,
        pi,
        project?.id,
        undefined,
        project?.root ?? null,
      ),
  });

  pi.registerCommand(DREAM_CMD, {
    description:
      "Holistic consolidation review of all instincts (merge, deduplicate, resolve contradictions)",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctDream(
        args,
        ctx,
        pi,
        project?.id,
        undefined,
        project?.root ?? null,
        installedSkills,
      ),
  });
}
