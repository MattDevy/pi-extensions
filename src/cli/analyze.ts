#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

import { loadConfig, DEFAULT_CONFIG } from "../config.js";
import type { InstalledSkill, ProjectEntry } from "../types.js";
import {
  getBaseDir,
  getProjectsRegistryPath,
  getObservationsPath,
  getProjectDir,
  getProjectInstinctsDir,
  getGlobalInstinctsDir,
} from "../storage.js";
import { countObservations } from "../observations.js";
import { runDecayPass } from "../instinct-decay.js";
import { runCleanupPass } from "../instinct-cleanup.js";
import { tailObservationsSince } from "../prompts/analyzer-user.js";
import { buildSingleShotSystemPrompt } from "../prompts/analyzer-system-single-shot.js";
import { buildSingleShotUserPrompt } from "../prompts/analyzer-user-single-shot.js";
import {
  runSingleShot,
  buildInstinctFromChange,
} from "./analyze-single-shot.js";
import {
  loadProjectInstincts,
  loadGlobalInstincts,
  saveInstinct,
} from "../instinct-store.js";
import { readAgentsMd } from "../agents-md.js";
import { homedir } from "node:os";
import { AnalyzeLogger, type ProjectRunStats, type RunSummary } from "./analyze-logger.js";

// ---------------------------------------------------------------------------
// Lockfile guard - ensures only one instance runs at a time
// ---------------------------------------------------------------------------

const LOCKFILE_NAME = "analyze.lock";
const LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes - stale lock threshold

function getLockfilePath(baseDir: string): string {
  return join(baseDir, LOCKFILE_NAME);
}

function acquireLock(baseDir: string): boolean {
  const lockPath = getLockfilePath(baseDir);

  if (existsSync(lockPath)) {
    try {
      const content = readFileSync(lockPath, "utf-8");
      const lock = JSON.parse(content) as { pid: number; started_at: string };
      const age = Date.now() - new Date(lock.started_at).getTime();

      try {
        process.kill(lock.pid, 0); // signal 0 = existence check, no actual signal
        if (age < LOCK_STALE_MS) {
          return false; // Process alive and lock is fresh
        }
        // Process alive but lock is stale - treat as abandoned
      } catch {
        // Process is dead - lock is orphaned, safe to take over
      }
    } catch {
      // Malformed lockfile - remove and proceed
    }
  }

  writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }),
    "utf-8"
  );
  return true;
}

function releaseLock(baseDir: string): void {
  const lockPath = getLockfilePath(baseDir);
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {
    // Best effort - don't crash on cleanup
  }
}

// ---------------------------------------------------------------------------
// Global timeout
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes total

function startGlobalTimeout(timeoutMs: number, logger: AnalyzeLogger): void {
  setTimeout(() => {
    logger.error("Global timeout reached, forcing exit");
    process.exit(2);
  }, timeoutMs).unref();
}

// ---------------------------------------------------------------------------
// Per-project analysis
// ---------------------------------------------------------------------------

interface ProjectMeta {
  last_analyzed_at?: string;
  last_observation_line_count?: number;
}

function loadProjectsRegistry(baseDir: string): Record<string, ProjectEntry> {
  const path = getProjectsRegistryPath(baseDir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, ProjectEntry>;
  } catch {
    return {};
  }
}

function loadProjectMeta(projectId: string, baseDir: string): ProjectMeta {
  const metaPath = join(getProjectDir(projectId, baseDir), "project.json");
  if (!existsSync(metaPath)) return {};
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as ProjectMeta;
  } catch {
    return {};
  }
}

function saveProjectMeta(projectId: string, meta: ProjectMeta, baseDir: string): void {
  const metaPath = join(getProjectDir(projectId, baseDir), "project.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

function hasNewObservations(projectId: string, meta: ProjectMeta, baseDir: string): boolean {
  const obsPath = getObservationsPath(projectId, baseDir);
  if (!existsSync(obsPath)) return false;

  const stat = statSync(obsPath);
  if (meta.last_analyzed_at) {
    const lastAnalyzed = new Date(meta.last_analyzed_at).getTime();
    if (stat.mtimeMs <= lastAnalyzed) return false;
  }

  return true;
}

interface AnalyzeResult {
  readonly ran: boolean;
  readonly stats?: ProjectRunStats;
  readonly skippedReason?: string;
}

async function analyzeProject(
  project: ProjectEntry,
  config: ReturnType<typeof loadConfig>,
  baseDir: string,
  logger: AnalyzeLogger
): Promise<AnalyzeResult> {
  const meta = loadProjectMeta(project.id, baseDir);

  if (!hasNewObservations(project.id, meta, baseDir)) {
    return { ran: false, skippedReason: "no new observations" };
  }

  const obsPath = getObservationsPath(project.id, baseDir);
  const sinceLineCount = meta.last_observation_line_count ?? 0;
  const { lines: newObsLines, totalLineCount, rawLineCount } = tailObservationsSince(
    obsPath,
    sinceLineCount
  );

  if (newObsLines.length === 0) {
    return { ran: false, skippedReason: "no new observation lines after preprocessing" };
  }

  const obsCount = countObservations(project.id, baseDir);
  if (obsCount < config.min_observations_to_analyze) {
    return { ran: false, skippedReason: `below threshold (${obsCount}/${config.min_observations_to_analyze})` };
  }

  const startTime = Date.now();
  logger.projectStart(project.id, project.name, rawLineCount, obsCount);

  runCleanupPass(project.id, config, baseDir);
  runDecayPass(project.id, baseDir);

  // Load current instincts inline - no tool calls needed
  const projectInstincts = loadProjectInstincts(project.id, baseDir);
  const globalInstincts = loadGlobalInstincts(baseDir);
  const allInstincts = [...projectInstincts, ...globalInstincts];

  const agentsMdProject = readAgentsMd(join(project.root, "AGENTS.md"));
  const agentsMdGlobal = readAgentsMd(join(homedir(), ".pi", "agent", "AGENTS.md"));

  let installedSkills: InstalledSkill[] = [];
  try {
    const { loadSkills } = await import("@mariozechner/pi-coding-agent");
    const result = loadSkills({ cwd: project.root });
    installedSkills = result.skills.map((s: { name: string; description: string }) => ({
      name: s.name,
      description: s.description,
    }));
  } catch {
    // Skills loading is best-effort - continue without them
  }

  const userPrompt = buildSingleShotUserPrompt(project, allInstincts, newObsLines, {
    agentsMdProject,
    agentsMdGlobal,
    installedSkills,
  });

  const authStorage = AuthStorage.create();
  const modelId = (config.model || DEFAULT_CONFIG.model) as Parameters<typeof getModel>[1];
  const model = getModel("anthropic", modelId);
  const apiKey = await authStorage.getApiKey("anthropic");

  if (!apiKey) {
    throw new Error("No Anthropic API key configured. Set via auth.json or ANTHROPIC_API_KEY.");
  }

  const context = {
    systemPrompt: buildSingleShotSystemPrompt(),
    messages: [
      { role: "user" as const, content: userPrompt, timestamp: Date.now() },
    ],
  };

  const timeoutMs = (config.timeout_seconds ?? DEFAULT_CONFIG.timeout_seconds) * 1000;
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

  const instinctCounts = { created: 0, updated: 0, deleted: 0 };
  const projectInstinctsDir = getProjectInstinctsDir(project.id, "personal", baseDir);
  const globalInstinctsDir = getGlobalInstinctsDir("personal", baseDir);

  let singleShotMessage;
  try {
    const result = await runSingleShot(context, model, apiKey, abortController.signal);
    singleShotMessage = result.message;

    // Enforce creation rate limit: only the first N create actions per run are applied.
    const maxNewInstincts = config.max_new_instincts_per_run ?? DEFAULT_CONFIG.max_new_instincts_per_run;
    let createsRemaining = maxNewInstincts;

    for (const change of result.changes) {
      if (change.action === "delete") {
        const id = change.id;
        if (!id) continue;
        const dir = change.scope === "global" ? globalInstinctsDir : projectInstinctsDir;
        const filePath = join(dir, `${id}.md`);
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          instinctCounts.deleted++;
        }
      } else if (change.action === "create") {
        if (createsRemaining <= 0) continue; // rate limit reached
        const existing = allInstincts.find((i) => i.id === change.instinct?.id) ?? null;
        const instinct = buildInstinctFromChange(change, existing, project.id, allInstincts);
        if (!instinct) continue;

        const dir = instinct.scope === "global" ? globalInstinctsDir : projectInstinctsDir;
        saveInstinct(instinct, dir);
        instinctCounts.created++;
        createsRemaining--;
      } else {
        // update
        const existing = allInstincts.find((i) => i.id === change.instinct?.id) ?? null;
        const instinct = buildInstinctFromChange(change, existing, project.id, allInstincts);
        if (!instinct) continue;

        const dir = instinct.scope === "global" ? globalInstinctsDir : projectInstinctsDir;
        saveInstinct(instinct, dir);
        instinctCounts.updated++;
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }

  const usage = singleShotMessage!.usage;
  const durationMs = Date.now() - startTime;

  const stats: ProjectRunStats = {
    project_id: project.id,
    project_name: project.name,
    duration_ms: durationMs,
    observations_processed: rawLineCount,
    observations_total: obsCount,
    instincts_created: instinctCounts.created,
    instincts_updated: instinctCounts.updated,
    instincts_deleted: instinctCounts.deleted,
    tokens_input: usage.input,
    tokens_output: usage.output,
    tokens_cache_read: usage.cacheRead,
    tokens_cache_write: usage.cacheWrite,
    tokens_total: usage.totalTokens,
    cost_usd: usage.cost.total,
    model: modelId,
  };

  logger.projectComplete(stats);

  saveProjectMeta(
    project.id,
    { ...meta, last_analyzed_at: new Date().toISOString(), last_observation_line_count: totalLineCount },
    baseDir
  );

  return { ran: true, stats };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const baseDir = getBaseDir();
  const config = loadConfig();
  const logger = new AnalyzeLogger(config.log_path);

  if (!acquireLock(baseDir)) {
    logger.info("Another instance is already running, exiting");
    process.exit(0);
  }

  startGlobalTimeout(DEFAULT_TIMEOUT_MS, logger);

  const runStart = Date.now();

  try {
    const registry = loadProjectsRegistry(baseDir);
    const projects = Object.values(registry);

    if (projects.length === 0) {
      logger.info("No projects registered");
      return;
    }

    logger.runStart(projects.length);

    let processed = 0;
    let skipped = 0;
    let errored = 0;
    const allProjectStats: ProjectRunStats[] = [];

    for (const project of projects) {
      try {
        const result = await analyzeProject(project, config, baseDir, logger);
        if (result.ran && result.stats) {
          processed++;
          allProjectStats.push(result.stats);
        } else {
          skipped++;
          if (result.skippedReason) {
            logger.projectSkipped(project.id, project.name, result.skippedReason);
          }
        }
      } catch (err) {
        errored++;
        logger.projectError(project.id, project.name, err);
      }
    }

    const summary: RunSummary = {
      total_duration_ms: Date.now() - runStart,
      projects_processed: processed,
      projects_skipped: skipped,
      projects_errored: errored,
      projects_total: projects.length,
      total_tokens: allProjectStats.reduce((sum, s) => sum + s.tokens_total, 0),
      total_cost_usd: allProjectStats.reduce((sum, s) => sum + s.cost_usd, 0),
      total_instincts_created: allProjectStats.reduce((sum, s) => sum + s.instincts_created, 0),
      total_instincts_updated: allProjectStats.reduce((sum, s) => sum + s.instincts_updated, 0),
      total_instincts_deleted: allProjectStats.reduce((sum, s) => sum + s.instincts_deleted, 0),
      project_stats: allProjectStats,
    };

    logger.runComplete(summary);
  } finally {
    releaseLock(baseDir);
  }
}

main().catch((err) => {
  releaseLock(getBaseDir());
  const logger = new AnalyzeLogger();
  logger.error("Fatal error", err);
  process.exit(1);
});
