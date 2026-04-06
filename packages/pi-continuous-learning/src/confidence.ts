/**
 * Pure functions for instinct confidence scoring.
 * No I/O - all functions take plain values and return plain values.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLAMP_MIN = 0.1;
const CLAMP_MAX = 0.9;

// initialConfidence brackets
const INITIAL_LOW = 0.3;
const INITIAL_MED = 0.5;
const INITIAL_HIGH = 0.7;
const INITIAL_VERY_HIGH = 0.85;

const OBS_BRACKET_LOW_MAX = 2;
const OBS_BRACKET_MED_MAX = 5;
const OBS_BRACKET_HIGH_MAX = 10;

// adjustConfidence deltas
// Confirmation uses diminishing returns to prevent runaway confidence on trivially easy-to-confirm instincts.
const DELTA_CONFIRMED_TIER1 = 0.05; // 1st–3rd confirmation
const DELTA_CONFIRMED_TIER2 = 0.03; // 4th–6th confirmation
const DELTA_CONFIRMED_TIER3 = 0.01; // 7th+ confirmation
const DELTA_CONTRADICTED = -0.15;
const DELTA_INACTIVE = 0;

const CONFIRMED_TIER1_MAX = 3;
const CONFIRMED_TIER2_MAX = 6;

// applyPassiveDecay
// Increased from 0.02 to 0.05: at 0.5 confidence, reaches 0.1 in ~8 weeks instead of 20.
const DECAY_PER_WEEK = 0.05;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeedbackOutcome = "confirmed" | "contradicted" | "inactive";

/**
 * Returns the confirmation confidence delta using diminishing returns.
 * Higher confirmed_count yields smaller increments to prevent runaway scores.
 */
export function confirmationDelta(confirmedCount: number): number {
  if (confirmedCount <= CONFIRMED_TIER1_MAX) return DELTA_CONFIRMED_TIER1;
  if (confirmedCount <= CONFIRMED_TIER2_MAX) return DELTA_CONFIRMED_TIER2;
  return DELTA_CONFIRMED_TIER3;
}

export interface ConfidenceResult {
  confidence: number;
  flaggedForRemoval: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, value));
}

function toResult(raw: number): ConfidenceResult {
  const flaggedForRemoval = raw < CLAMP_MIN;
  return { confidence: clamp(raw), flaggedForRemoval };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the initial confidence score for a newly discovered instinct
 * based on how many observations support it.
 */
export function initialConfidence(observationCount: number): number {
  if (observationCount <= OBS_BRACKET_LOW_MAX) return INITIAL_LOW;
  if (observationCount <= OBS_BRACKET_MED_MAX) return INITIAL_MED;
  if (observationCount <= OBS_BRACKET_HIGH_MAX) return INITIAL_HIGH;
  return INITIAL_VERY_HIGH;
}

/**
 * Adjusts confidence based on a feedback outcome from the observer loop.
 * For "confirmed" outcomes, applies diminishing returns based on how many
 * times the instinct has already been confirmed (higher count = smaller delta).
 * Returns the clamped confidence and a flag indicating if removal is warranted.
 *
 * @param current       - Current confidence value
 * @param outcome       - Feedback outcome type
 * @param confirmedCount - Current confirmed_count (used for diminishing returns on confirmations)
 */
export function adjustConfidence(
  current: number,
  outcome: FeedbackOutcome,
  confirmedCount = 0,
): ConfidenceResult {
  let delta: number;
  if (outcome === "confirmed") {
    delta = confirmationDelta(confirmedCount);
  } else if (outcome === "contradicted") {
    delta = DELTA_CONTRADICTED;
  } else {
    delta = DELTA_INACTIVE;
  }
  const raw = current + delta;
  return toResult(raw);
}

/**
 * Applies passive time-based decay of -0.02 per week since lastUpdated.
 * Future lastUpdated values produce zero decay.
 */
export function applyPassiveDecay(
  confidence: number,
  lastUpdated: string,
): ConfidenceResult {
  const now = Date.now();
  const updatedAt = new Date(lastUpdated).getTime();
  const elapsedMs = Math.max(0, now - updatedAt);
  const weeksElapsed = elapsedMs / MS_PER_WEEK;
  const decay = weeksElapsed * DECAY_PER_WEEK;
  const raw = confidence - decay;
  return toResult(raw);
}
