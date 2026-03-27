/**
 * Observation preprocessing for cost reduction.
 *
 * Strips high-volume, low-signal data from raw observation events before
 * sending to the LLM analyzer. Reduces context size by ~80% on typical sessions.
 *
 * Rules:
 * - turn_start  → DROP (no information not already in turn_end)
 * - tool_start  → DROP (tool name + sequence captured by tool_complete)
 * - tool_complete, is_error: false → KEEP, strip output field
 * - tool_complete, is_error: true  → KEEP as-is (error message needed)
 * - all others  → KEEP as-is
 */
import type { Observation } from "./types.js";

/**
 * Preprocess a single observation.
 * Returns null if the observation should be dropped entirely.
 * Returns a new (immutable) observation with large fields stripped if applicable.
 */
export function preprocessObservation(obs: Observation): Observation | null {
  if (obs.event === "turn_start" || obs.event === "tool_start") {
    return null;
  }

  if (obs.event === "tool_complete" && !obs.is_error) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { output: _, ...stripped } = obs;
    return stripped as Observation;
  }

  return obs;
}

/**
 * Preprocess an array of raw observations.
 * Drops nulls and returns only the meaningful events.
 */
export function preprocessObservations(observations: Observation[]): Observation[] {
  const result: Observation[] = [];
  for (const obs of observations) {
    const processed = preprocessObservation(obs);
    if (processed !== null) {
      result.push(processed);
    }
  }
  return result;
}
