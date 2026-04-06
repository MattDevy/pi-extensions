/**
 * Observation batch signal scoring.
 * Determines whether a batch of observations contains enough signal
 * to warrant running the analyzer (and spending tokens).
 */

import type { Observation, PromptFrequencyTable } from "./types.js";
import { normalizePrompt, hashPrompt } from "./prompt-frequency.js";

export const LOW_SIGNAL_THRESHOLD = 3;

export interface FrequencyBoostContext {
  readonly projectFrequency: PromptFrequencyTable;
  readonly minSessions: number;
  readonly scoreBoost: number;
}

interface ScoreResult {
  readonly score: number;
  readonly errors: number;
  readonly corrections: number;
  readonly userPrompts: number;
  readonly recurringPrompts: number;
  readonly activeInstinctBoost: number;
}

export const ACTIVE_INSTINCT_BOOST_CAP = 3;

export function scoreObservationBatch(
  lines: string[],
  freqContext?: FrequencyBoostContext,
): ScoreResult {
  let score = 0;
  let errors = 0;
  let corrections = 0;
  let userPrompts = 0;
  let recurringPrompts = 0;
  let lastWasError = false;
  const seenActiveInstincts = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obs: Partial<Observation>;
    try {
      obs = JSON.parse(trimmed) as Partial<Observation>;
    } catch {
      continue;
    }

    if (Array.isArray(obs.active_instincts)) {
      for (const id of obs.active_instincts) {
        if (id) seenActiveInstincts.add(id);
      }
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

      // Recurring prompt boost (second pass inline)
      if (freqContext && obs.input) {
        const normalized = normalizePrompt(obs.input);
        if (normalized) {
          const key = hashPrompt(normalized);
          const entry = freqContext.projectFrequency[key];
          if (entry && entry.sessions.length >= freqContext.minSessions) {
            score += freqContext.scoreBoost;
            recurringPrompts++;
          }
        }
      }
    } else if (obs.event === "model_select") {
      score += 1;
    }

    lastWasError = false;
  }

  // Implicit confirmation boost: clean session with active instincts
  let activeInstinctBoost = 0;
  if (errors === 0 && corrections === 0 && seenActiveInstincts.size > 0) {
    activeInstinctBoost = Math.min(
      seenActiveInstincts.size,
      ACTIVE_INSTINCT_BOOST_CAP,
    );
    score += activeInstinctBoost;
  }

  return {
    score,
    errors,
    corrections,
    userPrompts,
    recurringPrompts,
    activeInstinctBoost,
  };
}

export function isLowSignalBatch(
  lines: string[],
  freqContext?: FrequencyBoostContext,
): boolean {
  const { score } = scoreObservationBatch(lines, freqContext);
  return score < LOW_SIGNAL_THRESHOLD;
}
