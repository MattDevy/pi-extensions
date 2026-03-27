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

export const DEFAULT_CONFIG: Config = {
  run_interval_minutes: 5,
  min_observations_to_analyze: 20,
  min_confidence: 0.5,
  max_instincts: 20,
  model: "claude-haiku-4-5",
  timeout_seconds: 120,
  active_hours_start: 8,
  active_hours_end: 23,
  max_idle_seconds: 1800,
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
    model: Type.String(),
    timeout_seconds: Type.Number(),
    active_hours_start: Type.Number(),
    active_hours_end: Type.Number(),
    max_idle_seconds: Type.Number(),
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
