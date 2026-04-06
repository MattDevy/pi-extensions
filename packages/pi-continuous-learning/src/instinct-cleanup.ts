/**
 * Auto-cleanup rules for instinct volume control.
 *
 * Cleanup is run at the start of each analysis pass, before decay.
 * Rules (all thresholds are config-driven):
 *  1. Delete flagged_for_removal instincts older than `flagged_cleanup_days`.
 *  2. Delete zero-confirmation instincts older than `instinct_ttl_days`.
 *  3. Enforce per-dir hard caps by deleting lowest-confidence instincts.
 */

import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Instinct, Config } from "./types.js";
import {
  listInstincts,
  saveInstinct,
  invalidateCache,
} from "./instinct-store.js";
import {
  getBaseDir,
  getProjectInstinctsDir,
  getGlobalInstinctsDir,
} from "./storage.js";
import { findContradictions } from "./instinct-contradiction.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ageInDays(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (24 * 60 * 60 * 1000);
}

function deleteInstinctFile(instinct: Instinct, dir: string): boolean {
  const filePath = join(dir, `${instinct.id}.md`);
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cleanup rules
// ---------------------------------------------------------------------------

/**
 * Deletes instincts marked `flagged_for_removal` whose `updated_at` is older
 * than `flaggedCleanupDays`. `updated_at` is set when the flag is applied,
 * so it serves as a proxy for when the instinct was flagged.
 *
 * @returns Number of instincts deleted.
 */
export function cleanupFlaggedInstincts(
  dir: string,
  flaggedCleanupDays: number,
): number {
  const instincts = listInstincts(dir);
  let deleted = 0;
  for (const instinct of instincts) {
    if (
      instinct.flagged_for_removal &&
      ageInDays(instinct.updated_at) >= flaggedCleanupDays
    ) {
      if (deleteInstinctFile(instinct, dir)) {
        deleted++;
      }
    }
  }
  if (deleted > 0) invalidateCache(dir);
  return deleted;
}

/**
 * Deletes instincts with `confirmed_count === 0` whose `created_at` is older
 * than `ttlDays`. These instincts were never validated by the agent and have
 * aged out of relevance.
 *
 * @returns Number of instincts deleted.
 */
export function cleanupZeroConfirmedInstincts(
  dir: string,
  ttlDays: number,
): number {
  const instincts = listInstincts(dir);
  let deleted = 0;
  for (const instinct of instincts) {
    if (
      instinct.confirmed_count === 0 &&
      ageInDays(instinct.created_at) >= ttlDays
    ) {
      if (deleteInstinctFile(instinct, dir)) {
        deleted++;
      }
    }
  }
  if (deleted > 0) invalidateCache(dir);
  return deleted;
}

/**
 * Enforces a hard cap on the number of instincts in a directory.
 * When the count exceeds `maxCount`, deletes the lowest-confidence instincts
 * until the count is at or below the cap.
 *
 * @returns Number of instincts deleted.
 */
export function enforceInstinctCap(dir: string, maxCount: number): number {
  const instincts = listInstincts(dir);
  if (instincts.length <= maxCount) return 0;

  // Sort ascending by confidence - lowest confidence deleted first
  const sorted = [...instincts].sort((a, b) => a.confidence - b.confidence);
  const toDelete = sorted.slice(0, instincts.length - maxCount);

  let deleted = 0;
  for (const instinct of toDelete) {
    if (deleteInstinctFile(instinct, dir)) {
      deleted++;
    }
  }
  if (deleted > 0) invalidateCache(dir);
  return deleted;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * Flags the lower-confidence instinct in each contradictory pair.
 * When confidence is equal, both are flagged.
 * Already-flagged instincts are excluded from contradiction detection.
 *
 * @returns Number of instincts newly flagged.
 */
export function cleanupContradictions(dir: string): number {
  const instincts = listInstincts(dir);
  const matches = findContradictions(instincts);
  if (matches.length === 0) return 0;

  const toFlag = new Set<string>();

  for (const match of matches) {
    const { instinctA, instinctB } = match;
    if (instinctA.confidence > instinctB.confidence) {
      toFlag.add(instinctB.id);
    } else if (instinctB.confidence > instinctA.confidence) {
      toFlag.add(instinctA.id);
    } else {
      // Equal confidence - flag both for user review
      toFlag.add(instinctA.id);
      toFlag.add(instinctB.id);
    }
  }

  let flagged = 0;
  for (const instinct of instincts) {
    if (toFlag.has(instinct.id)) {
      const updated: Instinct = {
        ...instinct,
        flagged_for_removal: true,
        updated_at: new Date().toISOString(),
      };
      saveInstinct(updated, dir);
      flagged++;
    }
  }

  if (flagged > 0) invalidateCache(dir);
  return flagged;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface CleanupResult {
  flaggedDeleted: number;
  zeroConfirmedDeleted: number;
  contradictionsFlagged: number;
  capDeleted: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs all cleanup rules against a single directory.
 * Order: flagged → zero-confirmed → cap enforcement (cap runs last so it
 * accounts for deletions made by the earlier rules).
 */
/**
 * Runs all cleanup rules against a single directory.
 * Order: flagged → zero-confirmed → contradictions → cap enforcement
 * (cap runs last so it accounts for deletions/flags from earlier rules).
 */
export function cleanupDir(
  dir: string,
  config: Config,
  maxCount: number,
): CleanupResult {
  const flaggedDeleted = cleanupFlaggedInstincts(
    dir,
    config.flagged_cleanup_days,
  );
  const zeroConfirmedDeleted = cleanupZeroConfirmedInstincts(
    dir,
    config.instinct_ttl_days,
  );
  const contradictionsFlagged = cleanupContradictions(dir);
  const capDeleted = enforceInstinctCap(dir, maxCount);
  const total =
    flaggedDeleted + zeroConfirmedDeleted + contradictionsFlagged + capDeleted;
  return {
    flaggedDeleted,
    zeroConfirmedDeleted,
    contradictionsFlagged,
    capDeleted,
    total,
  };
}

/**
 * Runs a full cleanup pass over project and global instinct directories.
 * Called at the start of each analysis run, before decay.
 *
 * @param projectId - Project ID to clean up (skipped when null/undefined)
 * @param config    - Runtime config (provides all thresholds)
 * @param baseDir   - Base storage directory (defaults to ~/.pi/continuous-learning/)
 * @returns Aggregated cleanup result across both scopes
 */
export function runCleanupPass(
  projectId: string | null | undefined,
  config: Config,
  baseDir = getBaseDir(),
): CleanupResult {
  const result: CleanupResult = {
    flaggedDeleted: 0,
    zeroConfirmedDeleted: 0,
    contradictionsFlagged: 0,
    capDeleted: 0,
    total: 0,
  };

  if (projectId) {
    const projectDir = getProjectInstinctsDir(projectId, "personal", baseDir);
    const projectResult = cleanupDir(
      projectDir,
      config,
      config.max_total_instincts_per_project,
    );
    result.flaggedDeleted += projectResult.flaggedDeleted;
    result.zeroConfirmedDeleted += projectResult.zeroConfirmedDeleted;
    result.contradictionsFlagged += projectResult.contradictionsFlagged;
    result.capDeleted += projectResult.capDeleted;
    result.total += projectResult.total;
  }

  const globalDir = getGlobalInstinctsDir("personal", baseDir);
  const globalResult = cleanupDir(
    globalDir,
    config,
    config.max_total_instincts_global,
  );
  result.flaggedDeleted += globalResult.flaggedDeleted;
  result.zeroConfirmedDeleted += globalResult.zeroConfirmedDeleted;
  result.contradictionsFlagged += globalResult.contradictionsFlagged;
  result.capDeleted += globalResult.capDeleted;
  result.total += globalResult.total;

  return result;
}
