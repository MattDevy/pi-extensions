/**
 * Passive confidence decay for instincts.
 * Applied at the start of each analysis run to age out stale instincts.
 *
 * Decay: -0.02 per week since updated_at, clamped to [0.1, 0.9].
 * Instincts dropping below 0.1 are flagged for removal.
 *
 * US-031: Passive Confidence Decay
 */

import { applyPassiveDecay } from "./confidence.js";
import { listInstincts, saveInstinct } from "./instinct-store.js";
import {
  getBaseDir,
  getProjectInstinctsDir,
  getGlobalInstinctsDir,
} from "./storage.js";
import type { Instinct } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum confidence change required to persist the instinct back to disk.
 * Prevents excessive writes for negligibly small elapsed times.
 * At 5-minute analysis intervals, elapsed decay is ~0.000002 - well below this.
 */
const DECAY_CHANGE_THRESHOLD = 0.001;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Applies passive decay to a single instinct.
 *
 * Returns the updated instinct (with adjusted confidence and refreshed
 * updated_at) when the decay is significant, or null if no meaningful
 * change occurred.
 *
 * Does not mutate the input instinct.
 */
export function applyDecayToInstinct(instinct: Instinct): Instinct | null {
  const result = applyPassiveDecay(instinct.confidence, instinct.updated_at);

  const decayAmount = Math.abs(result.confidence - instinct.confidence);
  const flagChanged =
    Boolean(result.flaggedForRemoval) !== Boolean(instinct.flagged_for_removal);

  if (decayAmount < DECAY_CHANGE_THRESHOLD && !flagChanged) {
    return null;
  }

  const updated: Instinct = {
    ...instinct,
    confidence: result.confidence,
    updated_at: new Date().toISOString(),
  };

  // Set or clear flagged_for_removal using delete pattern (exactOptionalPropertyTypes)
  if (result.flaggedForRemoval) {
    (updated as Partial<Instinct>).flagged_for_removal = true;
  } else {
    delete (updated as Partial<Instinct>).flagged_for_removal;
  }

  return updated;
}

/**
 * Applies decay to all instincts found in a directory.
 * Saves any instincts with meaningful confidence changes.
 *
 * @param dir - Directory containing .md instinct files
 * @returns Number of instincts updated on disk
 */
export function applyDecayInDir(dir: string): number {
  const instincts = listInstincts(dir);
  let updatedCount = 0;

  for (const instinct of instincts) {
    const updated = applyDecayToInstinct(instinct);
    if (updated !== null) {
      saveInstinct(updated, dir);
      updatedCount++;
    }
  }

  return updatedCount;
}

/**
 * Runs a full decay pass over personal instincts for a project and globally.
 * Called at the start of each analysis run, before the Haiku subprocess
 * applies feedback adjustments.
 *
 * @param projectId - Project ID to decay (skipped when null/undefined)
 * @param baseDir - Base storage directory (defaults to ~/.pi/continuous-learning/)
 * @returns Total number of instincts updated across both scopes
 */
export function runDecayPass(
  projectId?: string | null,
  baseDir = getBaseDir(),
): number {
  let total = 0;

  if (projectId) {
    const projectDir = getProjectInstinctsDir(projectId, "personal", baseDir);
    total += applyDecayInDir(projectDir);
  }

  const globalDir = getGlobalInstinctsDir("personal", baseDir);
  total += applyDecayInDir(globalDir);

  return total;
}
