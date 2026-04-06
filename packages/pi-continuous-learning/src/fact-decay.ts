/**
 * Passive confidence decay for facts.
 * Applied at the start of each analysis run to age out stale facts.
 *
 * Decay: -0.05 per week since updated_at, clamped to [0.1, 0.9].
 * Facts dropping below 0.1 are flagged for removal.
 */

import { applyPassiveDecay } from "./confidence.js";
import { listFacts, saveFact } from "./fact-store.js";
import {
  getBaseDir,
  getProjectFactsDir,
  getGlobalFactsDir,
} from "./storage.js";
import type { Fact } from "./types.js";

const DECAY_CHANGE_THRESHOLD = 0.001;

export function applyDecayToFact(fact: Fact): Fact | null {
  const result = applyPassiveDecay(fact.confidence, fact.updated_at);

  const decayAmount = Math.abs(result.confidence - fact.confidence);
  const flagChanged =
    Boolean(result.flaggedForRemoval) !== Boolean(fact.flagged_for_removal);

  if (decayAmount < DECAY_CHANGE_THRESHOLD && !flagChanged) {
    return null;
  }

  const updated: Fact = {
    ...fact,
    confidence: result.confidence,
    updated_at: new Date().toISOString(),
  };

  if (result.flaggedForRemoval) {
    (updated as Partial<Fact>).flagged_for_removal = true;
  } else {
    delete (updated as Partial<Fact>).flagged_for_removal;
  }

  return updated;
}

export function applyFactDecayInDir(dir: string): number {
  const facts = listFacts(dir);
  let updatedCount = 0;

  for (const fact of facts) {
    const updated = applyDecayToFact(fact);
    if (updated !== null) {
      saveFact(updated, dir);
      updatedCount++;
    }
  }

  return updatedCount;
}

export function runFactDecayPass(
  projectId?: string | null,
  baseDir = getBaseDir(),
): number {
  let total = 0;

  if (projectId) {
    const projectDir = getProjectFactsDir(projectId, "personal", baseDir);
    total += applyFactDecayInDir(projectDir);
  }

  const globalDir = getGlobalFactsDir("personal", baseDir);
  total += applyFactDecayInDir(globalDir);

  return total;
}
