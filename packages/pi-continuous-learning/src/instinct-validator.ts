/**
 * Instinct validation and semantic deduplication.
 * Rejects instincts with empty, undefined, nonsense, or low-quality fields,
 * and detects near-duplicate instincts via Jaccard similarity.
 */

import type { Instinct } from "./types.js";

const MIN_FIELD_LENGTH = 10;
const INVALID_LITERALS = new Set(["undefined", "null", "none", ""]);

// ---------------------------------------------------------------------------
// Known domains (with "other" as escape hatch)
// ---------------------------------------------------------------------------

export const KNOWN_DOMAINS = new Set([
  "git",
  "testing",
  "debugging",
  "workflow",
  "typescript",
  "javascript",
  "python",
  "go",
  "css",
  "design",
  "security",
  "performance",
  "documentation",
  "react",
  "node",
  "database",
  "api",
  "devops",
  "architecture",
  "other",
]);

// ---------------------------------------------------------------------------
// Verb heuristic for action field
// ---------------------------------------------------------------------------

/** Common imperative verbs expected at the start of an instinct action. */
export const KNOWN_VERBS = new Set([
  "add",
  "always",
  "analyze",
  "apply",
  "ask",
  "avoid",
  "build",
  "call",
  "catch",
  "check",
  "clean",
  "confirm",
  "consider",
  "create",
  "define",
  "delete",
  "document",
  "emit",
  "ensure",
  "exclude",
  "export",
  "extract",
  "fetch",
  "find",
  "fix",
  "follow",
  "format",
  "generate",
  "get",
  "handle",
  "import",
  "include",
  "inspect",
  "load",
  "log",
  "look",
  "merge",
  "monitor",
  "move",
  "never",
  "parse",
  "pass",
  "prefer",
  "print",
  "read",
  "record",
  "refactor",
  "reject",
  "rename",
  "require",
  "resolve",
  "return",
  "run",
  "save",
  "scan",
  "search",
  "send",
  "set",
  "show",
  "skip",
  "start",
  "stop",
  "test",
  "track",
  "update",
  "use",
  "validate",
  "verify",
  "watch",
  "wrap",
  "write",
]);

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  /** Non-fatal warnings that indicate lower-quality instincts. */
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isInvalidField(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return `${fieldName} is ${String(value)}`;
  }
  if (typeof value !== "string") {
    return `${fieldName} is not a string (got ${typeof value})`;
  }
  const trimmed = value.trim();
  if (INVALID_LITERALS.has(trimmed.toLowerCase())) {
    return `${fieldName} is the literal string "${trimmed}"`;
  }
  if (trimmed.length < MIN_FIELD_LENGTH) {
    return `${fieldName} is too short (${trimmed.length} chars, minimum ${MIN_FIELD_LENGTH})`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// validateInstinct
// ---------------------------------------------------------------------------

/**
 * Validates that an instinct's fields meet quality requirements.
 *
 * Rules:
 * - action and trigger must be non-empty, non-null, non-"undefined", and >= 10 chars
 * - action first word should be a known imperative verb (warning if not)
 * - domain, if provided, must be in KNOWN_DOMAINS (with "other" as escape hatch)
 *
 * Returns { valid: true } or { valid: false, reason: "..." }.
 * Non-fatal issues are reported in the optional `warnings` array.
 */
export function validateInstinct(fields: {
  action: unknown;
  trigger: unknown;
  domain?: unknown;
}): ValidationResult {
  const actionError = isInvalidField(fields.action, "action");
  if (actionError) {
    return { valid: false, reason: actionError };
  }

  const triggerError = isInvalidField(fields.trigger, "trigger");
  if (triggerError) {
    return { valid: false, reason: triggerError };
  }

  const warnings: string[] = [];

  // Domain validation
  if (fields.domain !== undefined) {
    if (
      typeof fields.domain !== "string" ||
      !KNOWN_DOMAINS.has(fields.domain.toLowerCase().trim())
    ) {
      return {
        valid: false,
        reason: `domain "${String(fields.domain)}" is not in the known set. Use one of: ${[...KNOWN_DOMAINS].join(", ")}`,
      };
    }
  }

  // Verb heuristic (warning only - does not reject)
  const action = (fields.action as string).trim();
  const firstWord = action.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (firstWord && !KNOWN_VERBS.has(firstWord)) {
    warnings.push(
      `action should start with an imperative verb (got "${firstWord}"). Consider rewriting as a clear instruction.`,
    );
  }

  return warnings.length > 0 ? { valid: true, warnings } : { valid: true };
}

// ---------------------------------------------------------------------------
// Jaccard similarity deduplication
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "shall",
  "can",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "from",
  "up",
  "about",
  "into",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "and",
  "or",
  "but",
  "if",
  "as",
  "when",
  "where",
  "how",
  "what",
  "which",
  "who",
  "not",
  "no",
  "so",
]);

/**
 * Tokenizes text into a set of meaningful lowercase words.
 * Splits on non-alphanumeric characters and filters stop words and short tokens.
 */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  );
}

/**
 * Computes Jaccard similarity between two token sets.
 * Returns 1.0 for two empty sets, 0.0 if one is empty.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return intersection / union;
}

export interface SimilarityMatch {
  instinct: Instinct;
  similarity: number;
}

/**
 * Checks whether a candidate instinct is semantically similar to any existing instinct.
 *
 * Tokenizes trigger+action for both candidate and each existing instinct,
 * computes Jaccard similarity, and returns the closest match above the threshold.
 *
 * @param candidate  - The new instinct being considered (trigger + action)
 * @param existing   - All current instincts to check against
 * @param skipId     - ID to skip (the candidate's own ID on updates)
 * @param threshold  - Similarity threshold; default 0.6
 */
export function findSimilarInstinct(
  candidate: { trigger: string; action: string },
  existing: Instinct[],
  skipId?: string,
  threshold = 0.6,
): SimilarityMatch | null {
  const candidateTokens = tokenize(`${candidate.trigger} ${candidate.action}`);

  let bestMatch: SimilarityMatch | null = null;

  for (const instinct of existing) {
    if (instinct.id === skipId) continue;

    const existingTokens = tokenize(`${instinct.trigger} ${instinct.action}`);
    const similarity = jaccardSimilarity(candidateTokens, existingTokens);

    if (similarity >= threshold) {
      if (bestMatch === null || similarity > bestMatch.similarity) {
        bestMatch = { instinct, similarity };
      }
    }
  }

  return bestMatch;
}
