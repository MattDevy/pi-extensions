export type TddPhase = "idle" | "red" | "green" | "refactor" | "complete";

export type InjectionMode = "always" | "active-only" | "nudge" | "off";

export type EnforcementLevel = "warn" | "strict" | "off";

export type PhaseTransitionTrigger =
  | "tests_fail"
  | "tests_error"
  | "tests_pass"
  | "manual_advance"
  | "reset";

export interface TestFilePatterns {
  readonly typescript: readonly string[];
  readonly python: readonly string[];
  readonly go: readonly string[];
  readonly rust: readonly string[];
  readonly java: readonly string[];
  readonly php: readonly string[];
}

export interface TddConfig {
  readonly injection_mode: InjectionMode;
  readonly ordering_enforcement: EnforcementLevel;
  readonly coverage_threshold: number;
  readonly coverage_enabled: boolean;
  readonly auto_advance: boolean;
  readonly test_file_patterns: TestFilePatterns;
  readonly test_runner_patterns: readonly string[];
}

export interface TestRunResult {
  readonly timestamp: string;
  readonly turn_index: number;
  readonly passed: number;
  readonly failed: number;
  readonly errors: number;
  readonly exit_code: number;
}

export interface PhaseHistoryEntry {
  readonly phase: TddPhase;
  readonly entered_at: string;
}

export interface TddState {
  readonly phase: TddPhase;
  readonly task: string;
  readonly started_at: string;
  readonly session_id: string;
  readonly project_id: string;
  readonly test_files: readonly string[];
  readonly impl_files: readonly string[];
  readonly last_test_run: TestRunResult | null;
  readonly phase_history: readonly PhaseHistoryEntry[];
  readonly current_turn_index: number;
}

export interface PhaseTransitionResult {
  readonly state: TddState;
  readonly warning: string | null;
}

export interface TddCycleRecord {
  readonly task: string;
  readonly session_id: string;
  readonly project_id: string;
  readonly started_at: string;
  readonly completed_at: string;
  readonly final_phase: TddPhase;
  readonly test_files: readonly string[];
  readonly impl_files: readonly string[];
  readonly phase_history: readonly PhaseHistoryEntry[];
}
