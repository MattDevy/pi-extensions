/**
 * Analyzer timer management for pi-continuous-learning.
 * Starts a periodic interval that runs analysis when conditions are met.
 *
 * US-020: Analyzer Timer Management
 */

import * as fs from "node:fs";
import { getObservationsPath } from "./storage.js";
import { isAnalysisRunning } from "./analyzer-runner.js";
import type { Config } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_SECOND = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimerSkipReason =
  | "in_progress"
  | "insufficient_observations"
  | "outside_active_hours"
  | "user_idle";

export type AnalyzeCallback = () => Promise<void>;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _intervalHandle: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// State accessors (exported for testing)
// ---------------------------------------------------------------------------

/** Returns true when the timer is currently running. */
export function isTimerRunning(): boolean {
  return _intervalHandle !== null;
}

/**
 * Resets all module state to initial values.
 * Exported for test isolation only - do not call from production code.
 */
export function resetTimerState(): void {
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Observation file helpers
// ---------------------------------------------------------------------------

/**
 * Counts non-empty lines in the project's observations.jsonl file.
 * Returns 0 when the file does not exist.
 */
export function countObservations(projectId: string, baseDir?: string): number {
  const obsPath = getObservationsPath(projectId, baseDir);
  if (!fs.existsSync(obsPath)) {
    return 0;
  }
  const content = fs.readFileSync(obsPath, "utf-8") as string;
  return content.split("\n").filter((line) => line.trim() !== "").length;
}

/**
 * Returns the timestamp (ms since epoch) of the last observation,
 * or null if no observations exist or the file is missing.
 */
export function getLastObservationTime(
  projectId: string,
  baseDir?: string
): number | null {
  const obsPath = getObservationsPath(projectId, baseDir);
  if (!fs.existsSync(obsPath)) {
    return null;
  }
  const content = fs.readFileSync(obsPath, "utf-8") as string;
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return null;
  }
  const lastLine = lines[lines.length - 1]!;
  try {
    const obs = JSON.parse(lastLine) as { timestamp?: string };
    if (obs.timestamp) {
      return new Date(obs.timestamp).getTime();
    }
  } catch {
    // malformed JSON line - treat as no timestamp
  }
  return null;
}

// ---------------------------------------------------------------------------
// Active hours check
// ---------------------------------------------------------------------------

/**
 * Returns true when the current LOCAL hour falls within [startHour, endHour).
 * Uses local time so active hours are relative to the user's timezone.
 */
export function isWithinActiveHours(startHour: number, endHour: number): boolean {
  const currentHour = new Date().getHours();
  return currentHour >= startHour && currentHour < endHour;
}

// ---------------------------------------------------------------------------
// Skip condition aggregator
// ---------------------------------------------------------------------------

/**
 * Returns the reason to skip this tick, or null if analysis should run.
 *
 * Checks (in order):
 * 1. Re-entrancy - no analysis currently running
 * 2. Enough observations accumulated
 * 3. Within active hours
 * 4. User is not idle (last observation was recent enough)
 */
export function getSkipReason(
  config: Config,
  projectId: string,
  baseDir?: string
): TimerSkipReason | null {
  if (isAnalysisRunning()) {
    return "in_progress";
  }

  const count = countObservations(projectId, baseDir);
  if (count < config.min_observations_to_analyze) {
    return "insufficient_observations";
  }

  if (!isWithinActiveHours(config.active_hours_start, config.active_hours_end)) {
    return "outside_active_hours";
  }

  const lastObsTime = getLastObservationTime(projectId, baseDir);
  if (lastObsTime !== null) {
    const idleMs = Date.now() - lastObsTime;
    if (idleMs > config.max_idle_seconds * MS_PER_SECOND) {
      return "user_idle";
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts the analyzer timer with the interval from config.
 * Each tick evaluates skip conditions and calls onAnalyze when clear.
 * Clears any existing timer before starting a new one.
 *
 * @param config - Runtime configuration (run_interval_minutes used for interval)
 * @param projectId - Project ID for observation count and idle checks
 * @param onAnalyze - Callback to invoke when analysis should run
 * @param baseDir - Optional base directory override (for tests)
 */
export function startAnalyzerTimer(
  config: Config,
  projectId: string,
  onAnalyze: AnalyzeCallback,
  baseDir?: string
): void {
  stopAnalyzerTimer();
  const intervalMs = config.run_interval_minutes * MS_PER_MINUTE;
  _intervalHandle = setInterval(() => {
    const skipReason = getSkipReason(config, projectId, baseDir);
    if (skipReason !== null) {
      return;
    }
    void onAnalyze();
  }, intervalMs);
}

/**
 * Clears the analyzer timer.
 * Called on session_shutdown.
 */
export function stopAnalyzerTimer(): void {
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}
