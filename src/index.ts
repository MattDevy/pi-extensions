/**
 * Pi Continuous Learning Extension - Entry Point
 *
 * Wires together all modules: event handlers, commands, and the analyzer timer.
 * Observes coding sessions, records events, and uses a background Haiku process
 * to distill observations into reusable instincts.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { loadSkills } from "@mariozechner/pi-coding-agent";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "./config.js";
import { detectProject } from "./project.js";
import {
  ensureStorageLayout,
  getObservationsPath,
  getProjectInstinctsDir,
} from "./storage.js";
import { cleanOldArchives } from "./observations.js";
import { buildAnalyzerSystemPrompt } from "./prompts/analyzer-system.js";
import { buildAnalyzerUserPrompt } from "./prompts/analyzer-user.js";
import { startAnalyzerTimer, stopAnalyzerTimer } from "./analyzer-timer.js";
import { runAnalysis, shutdownAnalyzer } from "./analyzer-runner.js";
import { handleToolStart, handleToolEnd } from "./tool-observer.js";
import { handleBeforeAgentStart, handleAgentEnd } from "./prompt-observer.js";
import {
  handleBeforeAgentStartInjection,
  handleAgentEndClearInstincts,
} from "./instinct-injector.js";
import { handleInstinctStatus, COMMAND_NAME as STATUS_CMD } from "./instinct-status.js";
import { handleInstinctExport, COMMAND_NAME as EXPORT_CMD } from "./instinct-export.js";
import { handleInstinctImport, COMMAND_NAME as IMPORT_CMD } from "./instinct-import.js";
import { handleInstinctPromote, COMMAND_NAME as PROMOTE_CMD } from "./instinct-promote.js";
import { handleInstinctEvolve, COMMAND_NAME as EVOLVE_CMD } from "./instinct-evolve.js";
import { handleInstinctProjects, COMMAND_NAME as PROJECTS_CMD } from "./instinct-projects.js";
import { logError } from "./error-logger.js";
import type { Config, InstalledSkill, ProjectEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Writes the static analyzer system prompt to a temp file and returns its path. */
function writeSystemPromptFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-cl-"));
  const filePath = join(dir, "system-prompt.txt");
  writeFileSync(filePath, buildAnalyzerSystemPrompt(), "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

/**
 * Pi Continuous Learning Extension entry point.
 * Registers all event handlers and slash commands with the Pi ExtensionAPI.
 */
export default function (pi: ExtensionAPI): void {
  // Mutable session state - populated on session_start
  let config: Config | null = null;
  let project: ProjectEntry | null = null;
  let systemPromptFile: string | null = null;
  let installedSkills: InstalledSkill[] = [];

  // -------------------------------------------------------------------------
  // session_start: bootstrap all stateful components
  // -------------------------------------------------------------------------
  pi.on("session_start", async (_event, ctx) => {
    try {
      config = loadConfig();
      project = await detectProject(pi, ctx.cwd);
      ensureStorageLayout(project);
      cleanOldArchives(project.id);
      systemPromptFile = writeSystemPromptFile();

      // TODO: Verify actual Pi SDK API for getting installed skills; currently using loadSkills()
      try {
        const result = loadSkills({ cwd: ctx.cwd });
        installedSkills = result.skills.map((s) => ({ name: s.name, description: s.description }));
      } catch {
        installedSkills = [];
      }

      const capturedProject = project;
      const capturedConfig = config;
      const capturedPromptFile = systemPromptFile;
      const capturedCwd = ctx.cwd;

      startAnalyzerTimer(capturedConfig, capturedProject.id, async () => {
        const obsPath = getObservationsPath(capturedProject.id);
        const instinctsDir = getProjectInstinctsDir(capturedProject.id, "personal");
        const capturedSkills = installedSkills;
        const userPrompt = buildAnalyzerUserPrompt(obsPath, instinctsDir, capturedProject, {
          installedSkills: capturedSkills,
        });
        await runAnalysis({
          systemPromptFile: capturedPromptFile,
          userPrompt,
          cwd: capturedCwd,
          timeoutSeconds: capturedConfig.timeout_seconds,
          model: capturedConfig.model,
          projectId: capturedProject.id,
        });
      });
    } catch (err) {
      logError(project?.id ?? null, "session_start", err);
    }
  });

  // -------------------------------------------------------------------------
  // session_shutdown: stop timer, kill subprocess
  // appendObservation uses appendFileSync - writes are already flushed
  // -------------------------------------------------------------------------
  pi.on("session_shutdown", (_event, _ctx) => {
    try {
      stopAnalyzerTimer();
      shutdownAnalyzer();
    } catch (err) {
      logError(project?.id ?? null, "session_shutdown", err);
    }
  });

  // -------------------------------------------------------------------------
  // before_agent_start: observe prompt + inject instincts
  // -------------------------------------------------------------------------
  pi.on("before_agent_start", (event, ctx) => {
    try {
      if (!project || !config) return;
      handleBeforeAgentStart(event, ctx, project);
      return handleBeforeAgentStartInjection(event, ctx, config, project.id) ?? undefined;
    } catch (err) {
      logError(project?.id ?? null, "before_agent_start", err);
    }
  });

  // -------------------------------------------------------------------------
  // agent_start: no-op (event type required by acceptance criteria)
  // -------------------------------------------------------------------------
  pi.on("agent_start", (_event, _ctx) => {});

  // -------------------------------------------------------------------------
  // agent_end: observe completion + clear active instincts
  // -------------------------------------------------------------------------
  pi.on("agent_end", (event, ctx) => {
    try {
      if (!project) return;
      handleAgentEnd(event, ctx, project);
      handleAgentEndClearInstincts(event, ctx);
    } catch (err) {
      logError(project?.id ?? null, "agent_end", err);
    }
  });

  // -------------------------------------------------------------------------
  // tool_execution_start: observe tool input
  // -------------------------------------------------------------------------
  pi.on("tool_execution_start", (event, ctx) => {
    try {
      if (!project) return;
      handleToolStart(event, ctx, project);
    } catch (err) {
      logError(project?.id ?? null, "tool_execution_start", err);
    }
  });

  // -------------------------------------------------------------------------
  // tool_execution_end: observe tool output
  // -------------------------------------------------------------------------
  pi.on("tool_execution_end", (event, ctx) => {
    try {
      if (!project) return;
      handleToolEnd(event, ctx, project);
    } catch (err) {
      logError(project?.id ?? null, "tool_execution_end", err);
    }
  });

  // -------------------------------------------------------------------------
  // Slash commands
  // -------------------------------------------------------------------------
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
    description: "Suggest instinct consolidations and promotions",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctEvolve(
        args,
        ctx,
        project?.id,
        undefined,
        project?.root ?? null,
        installedSkills
      ),
  });

  pi.registerCommand(PROJECTS_CMD, {
    description: "List all known projects and their instinct counts",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleInstinctProjects(args, ctx),
  });
}
