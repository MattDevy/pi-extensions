/**
 * Auto-cleanup rules for fact volume control.
 *
 * Cleanup is run at the start of each analysis pass.
 * Rules:
 *  1. Delete flagged_for_removal facts older than `flagged_cleanup_days`.
 *  2. Delete zero-confirmation facts older than `instinct_ttl_days`.
 *  3. Enforce per-dir hard caps by deleting lowest-confidence facts.
 */

import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Fact, Config } from "./types.js";
import {
  listFacts,
  invalidateFactCache,
} from "./fact-store.js";
import {
  getBaseDir,
  getProjectFactsDir,
  getGlobalFactsDir,
} from "./storage.js";

function ageInDays(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (24 * 60 * 60 * 1000);
}

function deleteFactFile(fact: Fact, dir: string): boolean {
  const filePath = join(dir, `${fact.id}.md`);
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function cleanupFlaggedFacts(
  dir: string,
  flaggedCleanupDays: number,
): number {
  const facts = listFacts(dir);
  let deleted = 0;
  for (const fact of facts) {
    if (
      fact.flagged_for_removal &&
      ageInDays(fact.updated_at) >= flaggedCleanupDays
    ) {
      if (deleteFactFile(fact, dir)) {
        deleted++;
      }
    }
  }
  if (deleted > 0) invalidateFactCache(dir);
  return deleted;
}

export function cleanupZeroConfirmedFacts(
  dir: string,
  ttlDays: number,
): number {
  const facts = listFacts(dir);
  let deleted = 0;
  for (const fact of facts) {
    if (
      fact.confirmed_count === 0 &&
      ageInDays(fact.created_at) >= ttlDays
    ) {
      if (deleteFactFile(fact, dir)) {
        deleted++;
      }
    }
  }
  if (deleted > 0) invalidateFactCache(dir);
  return deleted;
}

export function enforceFactCap(dir: string, maxCount: number): number {
  const facts = listFacts(dir);
  if (facts.length <= maxCount) return 0;

  const sorted = [...facts].sort((a, b) => a.confidence - b.confidence);
  const toDelete = sorted.slice(0, facts.length - maxCount);

  let deleted = 0;
  for (const fact of toDelete) {
    if (deleteFactFile(fact, dir)) {
      deleted++;
    }
  }
  if (deleted > 0) invalidateFactCache(dir);
  return deleted;
}

export interface FactCleanupResult {
  flaggedDeleted: number;
  zeroConfirmedDeleted: number;
  capDeleted: number;
  total: number;
}

function cleanupFactDir(
  dir: string,
  config: Config,
  maxCount: number,
): FactCleanupResult {
  const flaggedDeleted = cleanupFlaggedFacts(dir, config.flagged_cleanup_days);
  const zeroConfirmedDeleted = cleanupZeroConfirmedFacts(
    dir,
    config.instinct_ttl_days,
  );
  const capDeleted = enforceFactCap(dir, maxCount);
  const total = flaggedDeleted + zeroConfirmedDeleted + capDeleted;
  return { flaggedDeleted, zeroConfirmedDeleted, capDeleted, total };
}

export function runFactCleanupPass(
  projectId: string | null | undefined,
  config: Config,
  baseDir = getBaseDir(),
): FactCleanupResult {
  const result: FactCleanupResult = {
    flaggedDeleted: 0,
    zeroConfirmedDeleted: 0,
    capDeleted: 0,
    total: 0,
  };

  if (projectId) {
    const projectDir = getProjectFactsDir(projectId, "personal", baseDir);
    const projectResult = cleanupFactDir(
      projectDir,
      config,
      config.max_facts_per_project,
    );
    result.flaggedDeleted += projectResult.flaggedDeleted;
    result.zeroConfirmedDeleted += projectResult.zeroConfirmedDeleted;
    result.capDeleted += projectResult.capDeleted;
    result.total += projectResult.total;
  }

  const globalDir = getGlobalFactsDir("personal", baseDir);
  const globalResult = cleanupFactDir(
    globalDir,
    config,
    config.max_facts_global,
  );
  result.flaggedDeleted += globalResult.flaggedDeleted;
  result.zeroConfirmedDeleted += globalResult.zeroConfirmedDeleted;
  result.capDeleted += globalResult.capDeleted;
  result.total += globalResult.total;

  return result;
}
