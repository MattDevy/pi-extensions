/**
 * Structured logging for the background analyzer CLI.
 * Writes to a configurable log file (default: ~/.pi/continuous-learning/analyzer.log).
 * Each line is a JSON object for easy parsing and grep-ability.
 *
 * Log levels: info, warn, error
 * Never throws - all I/O failures fall back to stderr.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { getBaseDir } from "../storage.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LOG_FILENAME = "analyzer.log";
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB - rotate beyond this

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface ProjectRunStats {
  readonly project_id: string;
  readonly project_name: string;
  readonly duration_ms: number;
  readonly observations_processed: number;
  readonly observations_total: number;
  readonly instincts_created: number;
  readonly instincts_updated: number;
  readonly instincts_deleted: number;
  readonly tokens_input: number;
  readonly tokens_output: number;
  readonly tokens_cache_read: number;
  readonly tokens_cache_write: number;
  readonly tokens_total: number;
  readonly cost_usd: number;
  readonly model: string;
  readonly skipped_reason?: string;
}

export interface RunSummary {
  readonly total_duration_ms: number;
  readonly projects_processed: number;
  readonly projects_skipped: number;
  readonly projects_errored: number;
  readonly projects_total: number;
  readonly total_tokens: number;
  readonly total_cost_usd: number;
  readonly total_instincts_created: number;
  readonly total_instincts_updated: number;
  readonly total_instincts_deleted: number;
  readonly project_stats: readonly ProjectRunStats[];
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export class AnalyzeLogger {
  private readonly logPath: string;

  constructor(logPath?: string) {
    this.logPath = logPath ?? join(getBaseDir(), DEFAULT_LOG_FILENAME);
    this.ensureLogDir();
  }

  getLogPath(): string {
    return this.logPath;
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data);
  }

  error(
    message: string,
    error?: unknown,
    data?: Record<string, unknown>,
  ): void {
    const errorData: Record<string, unknown> = { ...data };
    if (error instanceof Error) {
      errorData.error_message = error.message;
      errorData.error_stack = error.stack;
    } else if (error !== undefined) {
      errorData.error_message = String(error);
    }
    this.write("error", message, errorData);
  }

  /** Log the start of a full analyzer run */
  runStart(projectCount: number): void {
    this.info("Analyzer run started", {
      event: "run_start",
      project_count: projectCount,
      pid: process.pid,
    });
  }

  /** Log that a project was skipped (with reason) */
  projectSkipped(projectId: string, projectName: string, reason: string): void {
    this.info(`Skipped ${projectName}`, {
      event: "project_skipped",
      project_id: projectId,
      project_name: projectName,
      reason,
    });
  }

  /** Log the start of a project analysis */
  projectStart(
    projectId: string,
    projectName: string,
    newObservations: number,
    totalObservations: number,
  ): void {
    this.info(`Processing ${projectName}`, {
      event: "project_start",
      project_id: projectId,
      project_name: projectName,
      new_observations: newObservations,
      total_observations: totalObservations,
    });
  }

  /** Log per-project results after analysis completes */
  projectComplete(stats: ProjectRunStats): void {
    const durationSec = (stats.duration_ms / 1000).toFixed(1);
    const costFormatted = stats.cost_usd.toFixed(4);
    this.info(
      `Completed ${stats.project_name} in ${durationSec}s - ` +
        `tokens: ${stats.tokens_total}, cost: $${costFormatted}, ` +
        `instincts: +${stats.instincts_created} ~${stats.instincts_updated} -${stats.instincts_deleted}`,
      { event: "project_complete", ...stats },
    );
  }

  /** Log a project that errored during analysis */
  projectError(projectId: string, projectName: string, error: unknown): void {
    this.error(`Error processing ${projectName}`, error, {
      event: "project_error",
      project_id: projectId,
      project_name: projectName,
    });
  }

  /** Log the full run summary */
  runComplete(summary: RunSummary): void {
    const durationSec = (summary.total_duration_ms / 1000).toFixed(1);
    const costFormatted = summary.total_cost_usd.toFixed(4);
    this.info(
      `Run complete in ${durationSec}s - ` +
        `${summary.projects_processed}/${summary.projects_total} projects processed, ` +
        `${summary.projects_skipped} skipped, ${summary.projects_errored} errored - ` +
        `tokens: ${summary.total_tokens}, cost: $${costFormatted}, ` +
        `instincts: +${summary.total_instincts_created} ~${summary.total_instincts_updated} -${summary.total_instincts_deleted}`,
      { event: "run_complete", ...summary },
    );
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private ensureLogDir(): void {
    try {
      mkdirSync(dirname(this.logPath), { recursive: true });
    } catch {
      // Best effort
    }
  }

  private write(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    };

    const line = JSON.stringify(entry) + "\n";

    try {
      this.rotateIfNeeded();
      appendFileSync(this.logPath, line, "utf-8");
    } catch {
      // Fall back to stderr - never lose log entries entirely
      process.stderr.write(`[analyze] ${line}`);
    }
  }

  private rotateIfNeeded(): void {
    try {
      const stat = statSync(this.logPath);
      if (stat.size > MAX_LOG_SIZE_BYTES) {
        renameSync(this.logPath, this.logPath + ".old");
      }
    } catch {
      // File doesn't exist yet or stat failed - fine
    }
  }
}
