/**
 * Suggestion generators for /instinct-evolve command.
 * All findX() functions, tokenization utilities, and generateEvolveSuggestions live here.
 */

import type { Instinct } from "./types.js";
import { loadProjectInstincts, loadGlobalInstincts } from "./instinct-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Jaccard similarity threshold to suggest merging two instincts (trigger pass). */
export const MERGE_SIMILARITY_THRESHOLD = 0.3;

/** Jaccard similarity threshold for action-text deduplication pass. */
export const ACTION_SIMILARITY_THRESHOLD = 0.4;

/** Minimum project-instinct confidence to suggest global promotion. */
export const PROMOTION_CONFIDENCE_THRESHOLD = 0.7;

/** Words excluded from text tokenization (noise words). */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "is", "are", "was", "were", "be", "been", "i", "you",
  "we", "it", "this", "that", "when", "if", "by", "as", "use",
]);

/** Trigger keywords indicating a repeatable workflow. */
export const COMMAND_TRIGGER_KEYWORDS = [
  "always", "every time", "whenever", "each time",
  "before", "after", "run", "execute",
];

// ---------------------------------------------------------------------------
// Suggestion types
// ---------------------------------------------------------------------------

export interface MergeSuggestion {
  type: "merge";
  instincts: Instinct[];
  reason: string;
  /** Whether the cluster should be merged into one or the lower-confidence duplicate deleted. */
  recommendation: "merge" | "delete-lower";
  /** ID of the instinct to keep; highest confidence, tie-breaks to first alphabetically. */
  keepId: string;
}

export interface CommandSuggestion {
  type: "command";
  instinct: Instinct;
  reason: string;
}

export interface PromotionSuggestion {
  type: "promotion";
  instinct: Instinct;
  reason: string;
}

export type EvolveSuggestion =
  | MergeSuggestion
  | CommandSuggestion
  | PromotionSuggestion;

// ---------------------------------------------------------------------------
// Tokenization and similarity
// ---------------------------------------------------------------------------

/**
 * Tokenizes a text string into significant lowercase words.
 * Strips punctuation, filters stop words, requires length >= 3.
 */
export function tokenizeText(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Computes Jaccard similarity between two instincts' trigger token sets.
 * Returns a value in [0, 1]; returns 0 when both sets are empty.
 */
export function triggerSimilarity(a: Instinct, b: Instinct): number {
  const tokensA = tokenizeText(a.trigger);
  const tokensB = tokenizeText(b.trigger);
  if (tokensA.size === 0 && tokensB.size === 0) return 0;
  const intersection = [...tokensA].filter((t) => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);
  return intersection.length / union.size;
}

/**
 * Computes Jaccard similarity between two instincts' action token sets.
 * Returns a value in [0, 1]; returns 0 when both sets are empty.
 */
export function actionSimilarity(a: Instinct, b: Instinct): number {
  const tokensA = tokenizeText(a.action);
  const tokensB = tokenizeText(b.action);
  if (tokensA.size === 0 && tokensB.size === 0) return 0;
  const intersection = [...tokensA].filter((t) => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);
  return intersection.length / union.size;
}

// ---------------------------------------------------------------------------
// Clustering helpers
// ---------------------------------------------------------------------------

/**
 * Groups instinct pairs into connected components (clusters) via BFS.
 */
function clusterPairs(
  pairs: [Instinct, Instinct][],
  allInGroup: Instinct[]
): Instinct[][] {
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    const aAdj = adj.get(a.id) ?? new Set<string>();
    aAdj.add(b.id);
    adj.set(a.id, aAdj);
    const bAdj = adj.get(b.id) ?? new Set<string>();
    bAdj.add(a.id);
    adj.set(b.id, bAdj);
  }

  const idMap = new Map<string, Instinct>(allInGroup.map((i) => [i.id, i]));
  const visited = new Set<string>();
  const clusters: Instinct[][] = [];

  for (const [startId] of adj) {
    if (visited.has(startId)) continue;
    const cluster: Instinct[] = [];
    const queue = [startId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const inst = idMap.get(id);
      if (inst) cluster.push(inst);
      for (const neighbor of adj.get(id) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    if (cluster.length >= 2) clusters.push(cluster);
  }

  return clusters;
}

/**
 * Finds the instinct to keep in a cluster.
 * Picks highest confidence; ties broken alphabetically by id (first wins).
 */
function findKeeper(cluster: Instinct[]): Instinct {
  return cluster.reduce((best, inst) => {
    if (inst.confidence > best.confidence) return inst;
    if (inst.confidence === best.confidence && inst.id < best.id) return inst;
    return best;
  });
}

// ---------------------------------------------------------------------------
// Suggestion generators
// ---------------------------------------------------------------------------

/**
 * Finds instinct clusters whose triggers or actions are similar enough to
 * suggest merging or deduplication.
 *
 * Pass 1 (trigger): Jaccard >= MERGE_SIMILARITY_THRESHOLD (0.3)
 * Pass 2 (action):  Jaccard >= ACTION_SIMILARITY_THRESHOLD (0.4); skips pairs
 *                   already caught by pass 1.
 */
export function findMergeCandidates(instincts: Instinct[]): MergeSuggestion[] {
  const byDomain = new Map<string, Instinct[]>();
  for (const instinct of instincts) {
    const domain = instinct.domain || "uncategorized";
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), instinct]);
  }

  const suggestions: MergeSuggestion[] = [];

  for (const [domain, group] of byDomain) {
    if (group.length < 2) continue;

    // Pass 1: trigger similarity
    const triggerPairs: [Instinct, Instinct][] = [];
    const triggerPairKeys = new Set<string>();
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!a || !b) continue;
        if (triggerSimilarity(a, b) >= MERGE_SIMILARITY_THRESHOLD) {
          triggerPairs.push([a, b]);
          triggerPairKeys.add(`${a.id}|${b.id}`);
        }
      }
    }

    // Pass 2: action similarity (skip pairs already caught by pass 1)
    const actionPairs: [Instinct, Instinct][] = [];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!a || !b) continue;
        if (triggerPairKeys.has(`${a.id}|${b.id}`)) continue;
        if (actionSimilarity(a, b) >= ACTION_SIMILARITY_THRESHOLD) {
          actionPairs.push([a, b]);
        }
      }
    }

    const allPairs = [...triggerPairs, ...actionPairs];
    if (allPairs.length === 0) continue;

    const clusters = clusterPairs(allPairs, group);
    for (const cluster of clusters) {
      const clusterIdSet = new Set(cluster.map((i) => i.id));
      const hasActionPair = actionPairs.some(
        ([a, b]) => clusterIdSet.has(a.id) && clusterIdSet.has(b.id)
      );
      const recommendation = hasActionPair ? "delete-lower" : "merge";
      const keeper = findKeeper(cluster);
      const label = hasActionPair ? "actions" : "triggers";
      const verb = hasActionPair ? "deduplication" : "merging";

      suggestions.push({
        type: "merge",
        instincts: cluster,
        reason: `${cluster.length} instincts in domain "${domain}" have similar ${label} and may be candidates for ${verb}`,
        recommendation,
        keepId: keeper.id,
      });
    }
  }

  return suggestions;
}

/**
 * Finds instincts whose trigger suggests they could become a slash command.
 */
export function findCommandCandidates(instincts: Instinct[]): CommandSuggestion[] {
  return instincts
    .filter((instinct) => {
      const trigger = instinct.trigger.toLowerCase();
      return (
        instinct.domain === "workflow" ||
        COMMAND_TRIGGER_KEYWORDS.some((kw) => trigger.includes(kw))
      );
    })
    .map((instinct) => ({
      type: "command" as const,
      instinct,
      reason: `Trigger "${instinct.trigger}" suggests a repeatable workflow that could become a slash command`,
    }));
}

/**
 * Finds project-scoped instincts with confidence >= threshold not already global.
 */
export function findPromotionCandidates(
  instincts: Instinct[],
  globalInstinctIds: Set<string>
): PromotionSuggestion[] {
  return instincts
    .filter(
      (i) =>
        i.scope === "project" &&
        i.confidence >= PROMOTION_CONFIDENCE_THRESHOLD &&
        !globalInstinctIds.has(i.id)
    )
    .map((instinct) => ({
      type: "promotion" as const,
      instinct,
      reason: `Project instinct has confidence ${instinct.confidence.toFixed(2)} (>= ${PROMOTION_CONFIDENCE_THRESHOLD}) and may be ready for global promotion`,
    }));
}

/**
 * Generates all evolution suggestions from project and global instinct sets.
 */
export function generateEvolveSuggestions(
  projectInstincts: Instinct[],
  globalInstincts: Instinct[]
): EvolveSuggestion[] {
  const allInstincts = [...projectInstincts, ...globalInstincts];
  const globalIds = new Set(globalInstincts.map((i) => i.id));

  return [
    ...findMergeCandidates(allInstincts),
    ...findCommandCandidates(allInstincts),
    ...findPromotionCandidates(projectInstincts, globalIds),
  ];
}

/**
 * Loads project and global instincts for evolution analysis.
 * Includes all instincts regardless of confidence (to surface improvement opportunities).
 */
export function loadInstinctsForEvolve(
  projectId?: string | null,
  baseDir?: string
): { projectInstincts: Instinct[]; globalInstincts: Instinct[] } {
  const projectInstincts =
    projectId != null ? loadProjectInstincts(projectId, baseDir) : [];
  const globalInstincts = loadGlobalInstincts(baseDir);
  return { projectInstincts, globalInstincts };
}
