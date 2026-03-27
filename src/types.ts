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
  | "agent_end"
  | "turn_start"
  | "turn_end"
  | "user_bash"
  | "session_compact"
  | "model_select";

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
  turn_index?: number;
  tool_count?: number;
  error_count?: number;
  tokens_used?: number;
  command?: string;
  cwd?: string;
  from_extension?: boolean;
  model?: string;
  previous_model?: string;
  model_change_source?: string;
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
  graduated_to?: GraduationTarget;
  graduated_at?: string; // ISO 8601
  last_confirmed_session?: string; // session ID that last provided a confirmation
}

export type GraduationTarget = "agents-md" | "skill" | "command";

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
  max_injection_chars: number;
  model: string;
  timeout_seconds: number;
  active_hours_start: number; // 0-23
  active_hours_end: number; // 0-23
  max_idle_seconds: number;
  log_path?: string; // Override analyzer log location (default: ~/.pi/continuous-learning/analyzer.log)
  // Volume control
  max_total_instincts_per_project: number; // hard cap per project (enforced by auto-deletion)
  max_total_instincts_global: number; // hard cap for global instincts (enforced by auto-deletion)
  max_new_instincts_per_run: number; // creation rate limit per analyzer run
  flagged_cleanup_days: number; // auto-delete flagged instincts after N days
  instinct_ttl_days: number; // auto-delete zero-confirmation instincts after N days
  // Consolidation (dream) settings
  dreaming_enabled: boolean; // whether automatic consolidation runs during normal analysis
  consolidation_interval_days: number; // minimum days between consolidation runs
  consolidation_min_sessions: number; // minimum sessions since last consolidation
}
