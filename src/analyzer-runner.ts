/**
 * Manages analyzer subprocess lifecycle: timeout, shutdown, re-entrancy guard,
 * and cooldown enforcement.
 *
 * US-019: Analyzer Timeout and Process Management
 */

import { type ChildProcess } from "node:child_process";
import { DEFAULT_CONFIG } from "./config.js";
import { setAnalyzerRunning } from "./observer-guard.js";
import { spawnAnalyzer } from "./analyzer-spawn.js";
import { parseAnalyzerStream } from "./analyzer-stream.js";
import type { AnalysisResult } from "./analyzer-stream.js";
import { runDecayPass } from "./instinct-decay.js";
import { logWarning, logError, logInfo } from "./error-logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum milliseconds between consecutive analysis runs. */
export const ANALYSIS_COOLDOWN_MS = 60 * 1000;

/** Signal used to terminate hung subprocess. */
const KILL_SIGNAL = "SIGTERM";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _isRunning = false;
let _lastRunTime: number | null = null;
let _currentProcess: ChildProcess | null = null;
let _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// State accessors (exported for testing and US-020)
// ---------------------------------------------------------------------------

/** Returns true when an analysis is currently in progress. */
export function isAnalysisRunning(): boolean {
  return _isRunning;
}

/** Returns the timestamp (ms) of the last completed analysis run, or null. */
export function getLastRunTime(): number | null {
  return _lastRunTime;
}

/**
 * Resets all module state to initial values.
 * Exported for test isolation only - do not call from production code.
 */
export function resetAnalyzerState(): void {
  _isRunning = false;
  _lastRunTime = null;
  _currentProcess = null;
  if (_timeoutHandle !== null) {
    clearTimeout(_timeoutHandle);
    _timeoutHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Shutdown (session_shutdown handler)
// ---------------------------------------------------------------------------

/**
 * Kills any running analyzer subprocess immediately.
 * Called by the session_shutdown event handler.
 */
export function shutdownAnalyzer(): void {
  if (_currentProcess !== null) {
    _currentProcess.kill(KILL_SIGNAL);
    _currentProcess = null;
  }
  if (_timeoutHandle !== null) {
    clearTimeout(_timeoutHandle);
    _timeoutHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearRunState(): void {
  _isRunning = false;
  setAnalyzerRunning(false);
  _currentProcess = null;
  if (_timeoutHandle !== null) {
    clearTimeout(_timeoutHandle);
    _timeoutHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Run params / result
// ---------------------------------------------------------------------------

export interface RunAnalysisParams {
  systemPromptFile: string;
  userPrompt: string;
  cwd: string;
  timeoutSeconds?: number;
  model?: string;
  /** Project ID for passive decay pass before analysis. Omit to skip project decay. */
  projectId?: string | null;
  /** Base storage directory override (for tests). */
  baseDir?: string;
}

export type SkipReason = "in_progress" | "cooldown";

export interface RunAnalysisResult {
  /** True when the run was skipped without starting a subprocess. */
  skipped: boolean;
  /** Reason for skipping, when skipped is true. */
  skipReason?: SkipReason;
  /** Analysis result when the subprocess ran to completion or timeout. */
  result?: AnalysisResult;
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Runs the analyzer subprocess with timeout and lifecycle management.
 *
 * Guards:
 * - Re-entrancy: returns `{ skipped: true, skipReason: 'in_progress' }` if
 *   an analysis is already running.
 * - Cooldown: returns `{ skipped: true, skipReason: 'cooldown' }` if the last
 *   run finished less than ANALYSIS_COOLDOWN_MS ago.
 *
 * On timeout, the subprocess receives SIGTERM and the run resolves with
 * `success: false` and an error describing the timeout.
 */
export async function runAnalysis(
  params: RunAnalysisParams
): Promise<RunAnalysisResult> {
  // Re-entrancy guard
  if (_isRunning) {
    logInfo(params.projectId ?? null, "analyzer-runner", "Skipped: analysis already in progress", params.baseDir);
    return { skipped: true, skipReason: "in_progress" };
  }

  // Cooldown guard
  if (_lastRunTime !== null) {
    const elapsed = Date.now() - _lastRunTime;
    if (elapsed < ANALYSIS_COOLDOWN_MS) {
      logInfo(params.projectId ?? null, "analyzer-runner", "Skipped: cooldown period active", params.baseDir);
      return { skipped: true, skipReason: "cooldown" };
    }
  }

  // Apply passive confidence decay before analysis (US-031)
  if (params.projectId !== undefined) {
    runDecayPass(params.projectId, params.baseDir);
  }

  const timeoutMs =
    (params.timeoutSeconds ?? DEFAULT_CONFIG.timeout_seconds) * 1000;

  logInfo(params.projectId ?? null, "analyzer-runner", "Analysis started", params.baseDir);

  _isRunning = true;
  setAnalyzerRunning(true);

  const handle = spawnAnalyzer(
    params.systemPromptFile,
    params.userPrompt,
    params.cwd,
    params.model
  );

  _currentProcess = handle.process;

  // Collect stderr for logging on failure
  let stderrOutput = "";
  handle.process.stderr?.on("data", (chunk: Buffer) => {
    stderrOutput += chunk.toString();
  });

  // Arm the timeout
  _timeoutHandle = setTimeout(() => {
    if (_currentProcess !== null) {
      _currentProcess.kill(KILL_SIGNAL);
    }
  }, timeoutMs);

  try {
    // Parse stream concurrently with process completion
    const result = await parseAnalyzerStream(
      handle.process.stdout as import("node:stream").Readable
    );

    if (result.success) {
      const fileCount = result.filesWritten.length;
      const errorCount = result.errors.length;
      const parts = [`Analysis completed: ${fileCount} file(s) written`];
      if (errorCount > 0) {
        parts.push(`${errorCount} tool error(s)`);
      }
      logInfo(params.projectId ?? null, "analyzer-runner", parts.join(", "), params.baseDir);
    } else {
      logInfo(params.projectId ?? null, "analyzer-runner", "Analysis finished without clean completion (no agent_end event)", params.baseDir);
      if (stderrOutput.trim()) {
        logWarning(
          params.projectId ?? null,
          "analyzer-runner",
          `Subprocess failed. stderr:\n${stderrOutput.trim()}`,
          params.baseDir
        );
      }
    }

    _lastRunTime = Date.now();
    return { skipped: false, result };
  } catch (err) {
    if (stderrOutput.trim()) {
      logWarning(
        params.projectId ?? null,
        "analyzer-runner",
        `Subprocess error. stderr:\n${stderrOutput.trim()}`,
        params.baseDir
      );
    }
    logError(params.projectId ?? null, "analyzer-runner:runAnalysis", err, params.baseDir);
    _lastRunTime = Date.now();
    return { skipped: false, result: { success: false, filesWritten: [], errors: [String(err)] } };
  } finally {
    clearRunState();
  }
}
