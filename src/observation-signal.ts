/**
 * Observation batch signal scoring.
 * Determines whether a batch of observations contains enough signal
 * to warrant running the analyzer (and spending tokens).
 */

import type { Observation } from "./types.js";

/**
 * Score threshold below which a batch is considered low-signal.
 * Batches scoring below this are skipped with a log entry.
 */
export const LOW_SIGNAL_THRESHOLD = 3;

interface ScoreResult {
  readonly score: number;
  readonly errors: number;
  readonly corrections: number;
  readonly userPrompts: number;
}

/**
 * Scores an observation batch for signal richness.
 *
 * Scoring rules:
 * - Error observation (is_error: true): +2 points
 * - user_prompt after an error (user correction): +3 points
 * - Other user_prompt events (potential corrections/redirections): +1 point
 *
 * @param lines - Raw JSONL observation lines (preprocessed or raw)
 * @returns Score result with breakdown
 */
export function scoreObservationBatch(lines: string[]): ScoreResult {
  let score = 0;
  let errors = 0;
  let corrections = 0;
  let userPrompts = 0;
  let lastWasError = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obs: Partial<Observation>;
    try {
      obs = JSON.parse(trimmed) as Partial<Observation>;
    } catch {
      continue; // Skip malformed lines
    }

    if (obs.is_error) {
      score += 2;
      errors++;
      lastWasError = true;
      continue;
    }

    if (obs.event === "user_prompt") {
      userPrompts++;
      if (lastWasError) {
        score += 3;
        corrections++;
      } else {
        score += 1;
      }
    }

    lastWasError = false;
  }

  return { score, errors, corrections, userPrompts };
}

/**
 * Returns true if the batch is low-signal and analysis should be skipped.
 */
export function isLowSignalBatch(lines: string[]): boolean {
  const { score } = scoreObservationBatch(lines);
  return score < LOW_SIGNAL_THRESHOLD;
}
