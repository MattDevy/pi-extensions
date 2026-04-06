/**
 * Pure consolidation gate logic for the "instinct-dream" holistic review.
 *
 * Determines whether enough time and sessions have elapsed since the last
 * consolidation to justify a new pass. No I/O - all inputs are passed in.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getBaseDir } from "./storage.js";

// ---------------------------------------------------------------------------
// Constants (defaults - overridable via config)
// ---------------------------------------------------------------------------

/** Minimum days between consolidation runs. */
export const DEFAULT_CONSOLIDATION_INTERVAL_DAYS = 7;

/** Minimum distinct sessions since last consolidation. */
export const DEFAULT_CONSOLIDATION_MIN_SESSIONS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsolidationMeta {
  last_consolidation_at?: string; // ISO 8601
  last_consolidation_session_count?: number;
}

export interface ConsolidationGateInput {
  meta: ConsolidationMeta;
  currentSessionCount: number;
  now?: Date;
  intervalDays?: number;
  minSessions?: number;
}

export interface ConsolidationGateResult {
  eligible: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Gate check (pure)
// ---------------------------------------------------------------------------

/**
 * Determines whether a consolidation pass should run based on
 * elapsed time and session count since the last consolidation.
 *
 * Both conditions must be met (dual-gate):
 * 1. At least `intervalDays` since last consolidation
 * 2. At least `minSessions` new sessions since last consolidation
 */
export function checkConsolidationGate(
  input: ConsolidationGateInput,
): ConsolidationGateResult {
  const {
    meta,
    currentSessionCount,
    now = new Date(),
    intervalDays = DEFAULT_CONSOLIDATION_INTERVAL_DAYS,
    minSessions = DEFAULT_CONSOLIDATION_MIN_SESSIONS,
  } = input;

  // First run - no prior consolidation
  if (!meta.last_consolidation_at) {
    const sessionsSinceStart = currentSessionCount;
    if (sessionsSinceStart < minSessions) {
      return {
        eligible: false,
        reason: `only ${sessionsSinceStart} sessions recorded (need ${minSessions})`,
      };
    }
    return { eligible: true, reason: "first consolidation run" };
  }

  const lastRun = new Date(meta.last_consolidation_at);
  const daysSince = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince < intervalDays) {
    return {
      eligible: false,
      reason: `only ${daysSince.toFixed(1)} days since last consolidation (need ${intervalDays})`,
    };
  }

  const sessionsSinceLast =
    currentSessionCount - (meta.last_consolidation_session_count ?? 0);

  if (sessionsSinceLast < minSessions) {
    return {
      eligible: false,
      reason: `only ${sessionsSinceLast} sessions since last consolidation (need ${minSessions})`,
    };
  }

  return { eligible: true, reason: "gate conditions met" };
}

// ---------------------------------------------------------------------------
// Session counting (from observations)
// ---------------------------------------------------------------------------

/**
 * Counts distinct session IDs in a JSONL observations file.
 * Scans all lines and extracts unique `"session":"..."` values.
 */
export function countDistinctSessions(obsPath: string): number {
  if (!existsSync(obsPath)) return 0;

  const content = readFileSync(obsPath, "utf-8");
  const sessions = new Set<string>();

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    // Fast regex extraction avoids full JSON parse per line
    const match = /"session"\s*:\s*"([^"]+)"/.exec(line);
    if (match?.[1]) {
      sessions.add(match[1]);
    }
  }

  return sessions.size;
}

// ---------------------------------------------------------------------------
// Consolidation meta persistence
// ---------------------------------------------------------------------------

const CONSOLIDATION_META_FILENAME = "consolidation.json";

export function getConsolidationMetaPath(
  projectId: string,
  baseDir = getBaseDir(),
): string {
  return join(baseDir, "projects", projectId, CONSOLIDATION_META_FILENAME);
}

export function loadConsolidationMeta(
  projectId: string,
  baseDir = getBaseDir(),
): ConsolidationMeta {
  const metaPath = getConsolidationMetaPath(projectId, baseDir);
  if (!existsSync(metaPath)) return {};
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as ConsolidationMeta;
  } catch {
    return {};
  }
}

export function saveConsolidationMeta(
  projectId: string,
  meta: ConsolidationMeta,
  baseDir = getBaseDir(),
): void {
  const metaPath = getConsolidationMetaPath(projectId, baseDir);
  mkdirSync(dirname(metaPath), { recursive: true });
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}
