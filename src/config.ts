/**
 * Configuration module for pi-continuous-learning.
 * Loads user settings from ~/.pi/continuous-learning/config.json with defaults.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Config } from "./types.js";
import {
  DEFAULT_CONSOLIDATION_INTERVAL_DAYS,
  DEFAULT_CONSOLIDATION_MIN_SESSIONS,
} from "./consolidation.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maps instinct domain names to human-readable purposes.
 * Used by findSkillShadows() to detect when an instinct is covered by an installed Pi skill.
 */
export const SKILL_DOMAINS: Record<string, string> = {
  git: "version control and git workflows",
  testing: "test writing and test frameworks",
  debugging: "error analysis and debugging",
  workflow: "development workflow and automation",
  typescript: "TypeScript language and type system",
  css: "CSS and styling",
  design: "UI design and component patterns",
  security: "security practices and vulnerability prevention",
  performance: "performance optimization",
  documentation: "documentation writing and standards",
};

export const CONFIG_PATH = path.join(
  os.homedir(),
  ".pi",
  "continuous-learning",
  "config.json"
);

// ---------------------------------------------------------------------------
// Graduation maturity criteria
// ---------------------------------------------------------------------------

/** Minimum age in days before an instinct is eligible for graduation. */
export const GRADUATION_MIN_AGE_DAYS = 7;

/** Minimum confidence to qualify for graduation. */
export const GRADUATION_MIN_CONFIDENCE = 0.75;

/** Minimum confirmed_count to qualify for graduation. */
export const GRADUATION_MIN_CONFIRMED = 3;

/** Maximum contradicted_count allowed for graduation. */
export const GRADUATION_MAX_CONTRADICTED = 1;

/** Minimum related instincts in same domain to propose a skill scaffold. */
export const GRADUATION_SKILL_CLUSTER_SIZE = 3;

/** Minimum related instincts in same domain to propose a command scaffold. */
export const GRADUATION_COMMAND_CLUSTER_SIZE = 3;

/** Maximum instinct age in days before TTL cull (aggressive decay / deletion). */
export const GRADUATION_TTL_MAX_DAYS = 28;

/** Confidence threshold below which TTL-expired instincts are deleted outright. */
export const GRADUATION_TTL_CULL_CONFIDENCE = 0.3;

export const DEFAULT_CONFIG: Config = {
  run_interval_minutes: 5,
  min_observations_to_analyze: 20,
  min_confidence: 0.5,
  max_instincts: 20,
  max_injection_chars: 4000,
  model: "claude-haiku-4-5",
  timeout_seconds: 120,
  active_hours_start: 8,
  active_hours_end: 23,
  max_idle_seconds: 1800,
  // Volume control defaults
  max_total_instincts_per_project: 30,
  max_total_instincts_global: 20,
  max_new_instincts_per_run: 3,
  flagged_cleanup_days: 7,
  instinct_ttl_days: 28,
  dreaming_enabled: true,
  consolidation_interval_days: DEFAULT_CONSOLIDATION_INTERVAL_DAYS,
  consolidation_min_sessions: DEFAULT_CONSOLIDATION_MIN_SESSIONS,
  recurring_prompt_min_sessions: 3,
  recurring_prompt_score_boost: 3,
};

// ---------------------------------------------------------------------------
// TypeBox schema for partial config overrides (runtime validation)
// ---------------------------------------------------------------------------

const PartialConfigSchema = Type.Partial(
  Type.Object({
    run_interval_minutes: Type.Number(),
    min_observations_to_analyze: Type.Number(),
    min_confidence: Type.Number(),
    max_instincts: Type.Number(),
    max_injection_chars: Type.Number(),
    model: Type.String(),
    timeout_seconds: Type.Number(),
    active_hours_start: Type.Number(),
    active_hours_end: Type.Number(),
    max_idle_seconds: Type.Number(),
    log_path: Type.String(),
    // Volume control
    max_total_instincts_per_project: Type.Number(),
    max_total_instincts_global: Type.Number(),
    max_new_instincts_per_run: Type.Number(),
    flagged_cleanup_days: Type.Number(),
    instinct_ttl_days: Type.Number(),
    dreaming_enabled: Type.Boolean(),
    consolidation_interval_days: Type.Number(),
    consolidation_min_sessions: Type.Number(),
    recurring_prompt_min_sessions: Type.Number(),
    recurring_prompt_score_boost: Type.Number(),
  })
);

type PartialConfig = Static<typeof PartialConfigSchema>;

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

/**
 * Loads config from ~/.pi/continuous-learning/config.json.
 * Returns defaults when file is absent or contains invalid JSON.
 * Merges partial overrides with defaults (overrides win).
 */
export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf-8") as string;
  } catch (err) {
    console.warn(`[pi-continuous-learning] Failed to read config.json: ${String(err)}`);
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[pi-continuous-learning] Invalid JSON in config.json: ${String(err)}. Using defaults.`
    );
    return { ...DEFAULT_CONFIG };
  }

  // Validate and extract only known config fields (runtime boundary check)
  const cleaned = Value.Clean(PartialConfigSchema, parsed) as PartialConfig;

  return { ...DEFAULT_CONFIG, ...cleaned };
}
