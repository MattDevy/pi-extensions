/**
 * Shared TypeScript interfaces for pi-continuous-learning.
 * All modules import from this file for consistent data contracts.
 */

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export type ObservationEvent =
  | "tool_start"
  | "tool_complete"
  | "user_prompt"
  | "agent_end";

export interface Observation {
  timestamp: string; // ISO 8601 UTC
  event: ObservationEvent;
  session: string;
  project_id: string;
  project_name: string;
  tool?: string;
  input?: string;
  output?: string;
  is_error?: boolean;
  active_instincts?: string[];
}

// ---------------------------------------------------------------------------
// Instinct
// ---------------------------------------------------------------------------

export type InstinctScope = "project" | "global";
export type InstinctSource = "personal" | "inherited";

export interface Instinct {
  id: string; // kebab-case
  title: string;
  trigger: string;
  action: string;
  confidence: number; // 0.1 - 0.9
  domain: string;
  source: InstinctSource;
  scope: InstinctScope;
  project_id?: string;
  project_name?: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  observation_count: number;
  confirmed_count: number;
  contradicted_count: number;
  inactive_count: number;
  evidence?: string[];
  flagged_for_removal?: boolean;
}

// ---------------------------------------------------------------------------
// ProjectEntry
// ---------------------------------------------------------------------------

export interface ProjectEntry {
  id: string;
  name: string;
  root: string;
  remote: string;
  created_at: string; // ISO 8601
  last_seen: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface InstalledSkill {
  name: string;
  description: string;
}

export interface Config {
  run_interval_minutes: number;
  min_observations_to_analyze: number;
  min_confidence: number;
  max_instincts: number;
  model: string;
  timeout_seconds: number;
  active_hours_start: number; // 0-23
  active_hours_end: number; // 0-23
  max_idle_seconds: number;
}
