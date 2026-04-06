/**
 * Contradiction detection for instincts with opposing actions.
 *
 * Detects instincts that have similar triggers but semantically opposed actions
 * using pattern-based heuristics (negation words, antonym verb pairs).
 * No LLM cost - purely deterministic.
 */

import type { Instinct } from "./types.js";
import { tokenize, jaccardSimilarity } from "./instinct-validator.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default Jaccard similarity threshold for trigger comparison. */
const DEFAULT_TRIGGER_THRESHOLD = 0.4;

/**
 * Pairs of verbs/keywords that indicate opposing intent when one appears
 * in each action. Order within each pair does not matter.
 */
export const OPPOSING_VERB_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["avoid", "prefer"],
  ["avoid", "use"],
  ["avoid", "always"],
  ["avoid", "ensure"],
  ["never", "always"],
  ["never", "prefer"],
  ["never", "use"],
  ["never", "ensure"],
  ["skip", "always"],
  ["skip", "ensure"],
  ["skip", "require"],
  ["reject", "prefer"],
  ["reject", "use"],
  ["reject", "accept"],
] as const;

/**
 * Negation prefixes that invert the meaning of a following verb.
 * Matched as word boundaries in lowercase text.
 */
const NEGATION_PATTERNS: ReadonlyArray<string> = [
  "do not ",
  "don't ",
  "do not",
  "don't",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the set of action-relevant keywords from an action string.
 * Lowercases and splits on word boundaries.
 */
function extractActionWords(action: string): Set<string> {
  return new Set(
    action
      .toLowerCase()
      .split(/[^a-z']+/)
      .filter((w) => w.length > 0),
  );
}

/**
 * Checks whether a negation prefix appears in the action text,
 * followed by a verb that appears in the other action.
 */
function hasNegationConflict(actionA: string, actionB: string): string | null {
  const lowerA = actionA.toLowerCase();
  const lowerB = actionB.toLowerCase();
  const wordsA = extractActionWords(actionA);
  const wordsB = extractActionWords(actionB);

  for (const neg of NEGATION_PATTERNS) {
    // Check if A has negation + verb that B uses affirmatively
    const idxA = lowerA.indexOf(neg);
    if (idxA !== -1) {
      const afterNeg = lowerA.slice(idxA + neg.length).trim();
      const negatedVerb = afterNeg.split(/[^a-z]+/)[0];
      if (negatedVerb && negatedVerb.length > 1 && wordsB.has(negatedVerb)) {
        return `"${neg}${negatedVerb}" vs "${negatedVerb}"`;
      }
    }

    // Check if B has negation + verb that A uses affirmatively
    const idxB = lowerB.indexOf(neg);
    if (idxB !== -1) {
      const afterNeg = lowerB.slice(idxB + neg.length).trim();
      const negatedVerb = afterNeg.split(/[^a-z]+/)[0];
      if (negatedVerb && negatedVerb.length > 1 && wordsA.has(negatedVerb)) {
        return `"${neg}${negatedVerb}" vs "${negatedVerb}"`;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ContradictionMatch {
  instinctA: Instinct;
  instinctB: Instinct;
  triggerSimilarity: number;
  reason: string;
}

/**
 * Checks whether two actions are semantically opposing using verb pair matching
 * and negation pattern detection.
 *
 * @returns A reason string if opposing, null otherwise.
 */
export function hasOpposingAction(
  actionA: string,
  actionB: string,
): string | null {
  if (!actionA || !actionB) return null;
  if (actionA === actionB) return null;

  const wordsA = extractActionWords(actionA);
  const wordsB = extractActionWords(actionB);

  // Check opposing verb pairs
  for (const [verbX, verbY] of OPPOSING_VERB_PAIRS) {
    if (
      (wordsA.has(verbX) && wordsB.has(verbY)) ||
      (wordsA.has(verbY) && wordsB.has(verbX))
    ) {
      return `opposing verbs: "${verbX}" vs "${verbY}"`;
    }
  }

  // Check negation patterns (e.g., "do not use" vs "use")
  const negationResult = hasNegationConflict(actionA, actionB);
  if (negationResult) {
    return `negation conflict: ${negationResult}`;
  }

  return null;
}

/**
 * Finds all contradictory pairs in a set of instincts.
 *
 * A contradiction is defined as:
 * 1. Similar triggers (Jaccard similarity >= threshold on trigger tokens)
 * 2. Opposing actions (detected via verb pairs or negation patterns)
 *
 * Instincts with `flagged_for_removal` are excluded.
 * Each pair is reported once (no duplicates).
 *
 * @param instincts - All instincts to check
 * @param triggerThreshold - Jaccard similarity threshold for triggers (default 0.4)
 * @returns Array of contradiction matches
 */
export function findContradictions(
  instincts: readonly Instinct[],
  triggerThreshold = DEFAULT_TRIGGER_THRESHOLD,
): ContradictionMatch[] {
  const active = instincts.filter((i) => !i.flagged_for_removal);
  if (active.length < 2) return [];

  const matches: ContradictionMatch[] = [];

  // Pre-compute trigger tokens
  const triggerTokens = new Map<string, Set<string>>();
  for (const inst of active) {
    triggerTokens.set(inst.id, tokenize(inst.trigger));
  }

  // Compare all unique pairs
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;

      // Step 1: Check trigger similarity
      const tokensA = triggerTokens.get(a.id)!;
      const tokensB = triggerTokens.get(b.id)!;
      const similarity = jaccardSimilarity(tokensA, tokensB);

      if (similarity < triggerThreshold) continue;

      // Step 2: Check action opposition
      const reason = hasOpposingAction(a.action, b.action);
      if (reason) {
        matches.push({
          instinctA: a,
          instinctB: b,
          triggerSimilarity: similarity,
          reason,
        });
      }
    }
  }

  return matches;
}
