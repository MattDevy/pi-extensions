import { describe, it, expect } from "vitest";
import type {
  Observation,
  ObservationEvent,
  Instinct,
  InstinctScope,
  InstinctSource,
  GraduationTarget,
  ProjectEntry,
  Config,
} from "./types.js";

describe("types exports", () => {
  it("Observation type is accessible and accepts required fields", () => {
    const obs: Observation = {
      timestamp: "2026-03-26T14:00:00.000Z",
      event: "tool_start",
      session: "session-123",
      project_id: "abc123def456",
      project_name: "my-project",
    };
    expect(obs.event).toBe("tool_start");
    expect(obs.session).toBe("session-123");
  });

  it("Observation accepts all optional fields", () => {
    const obs: Observation = {
      timestamp: "2026-03-26T14:00:00.000Z",
      event: "tool_complete",
      session: "session-123",
      project_id: "abc123def456",
      project_name: "my-project",
      tool: "read",
      input: "some input",
      output: "some output",
      is_error: false,
      active_instincts: ["instinct-1", "instinct-2"],
    };
    expect(obs.tool).toBe("read");
    expect(obs.active_instincts).toHaveLength(2);
  });

  it("ObservationEvent union covers all four values", () => {
    const events: ObservationEvent[] = [
      "tool_start",
      "tool_complete",
      "user_prompt",
      "agent_end",
    ];
    expect(events).toHaveLength(4);
  });

  it("Instinct type is accessible with all required fields", () => {
    const instinct: Instinct = {
      id: "prefer-read-over-cat",
      title: "Prefer read tool over bash cat",
      trigger: "When reading file contents",
      action: "Use the read tool instead of bash cat",
      confidence: 0.7,
      domain: "tooling",
      source: "personal",
      scope: "project",
      project_id: "abc123def456",
      project_name: "my-project",
      created_at: "2026-03-26T14:00:00.000Z",
      updated_at: "2026-03-26T14:00:00.000Z",
      observation_count: 5,
      confirmed_count: 3,
      contradicted_count: 0,
      inactive_count: 2,
      evidence: ["Observed 5 times across 3 sessions"],
    };
    expect(instinct.id).toBe("prefer-read-over-cat");
    expect(instinct.confidence).toBe(0.7);
  });

  it("Instinct allows optional fields to be absent", () => {
    const instinct: Instinct = {
      id: "global-instinct",
      title: "Global pattern",
      trigger: "When starting a task",
      action: "Plan first",
      confidence: 0.5,
      domain: "workflow",
      source: "personal",
      scope: "global",
      created_at: "2026-03-26T14:00:00.000Z",
      updated_at: "2026-03-26T14:00:00.000Z",
      observation_count: 3,
      confirmed_count: 1,
      contradicted_count: 0,
      inactive_count: 2,
    };
    expect(instinct.project_id).toBeUndefined();
    expect(instinct.project_name).toBeUndefined();
  });

  it("InstinctScope union is accessible", () => {
    const scopes: InstinctScope[] = ["project", "global"];
    expect(scopes).toHaveLength(2);
  });

  it("InstinctSource union is accessible", () => {
    const sources: InstinctSource[] = ["personal", "inherited"];
    expect(sources).toHaveLength(2);
  });

  it("GraduationTarget union covers all targets", () => {
    const targets: GraduationTarget[] = ["agents-md", "skill", "command"];
    expect(targets).toHaveLength(3);
  });

  it("Instinct allows graduated_to and graduated_at to be absent", () => {
    const instinct: Instinct = {
      id: "test",
      title: "Test",
      trigger: "when",
      action: "do",
      confidence: 0.5,
      domain: "testing",
      source: "personal",
      scope: "global",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      observation_count: 1,
      confirmed_count: 0,
      contradicted_count: 0,
      inactive_count: 0,
    };
    expect(instinct.graduated_to).toBeUndefined();
    expect(instinct.graduated_at).toBeUndefined();
  });

  it("ProjectEntry type is accessible with all fields", () => {
    const entry: ProjectEntry = {
      id: "abc123def456",
      name: "my-project",
      root: "/Users/user/projects/my-project",
      remote: "git@github.com:user/my-project.git",
      created_at: "2026-03-26T14:00:00.000Z",
      last_seen: "2026-03-26T15:00:00.000Z",
    };
    expect(entry.id).toBe("abc123def456");
    expect(entry.name).toBe("my-project");
  });

  it("Config type is accessible with all fields", () => {
    const config: Config = {
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
      max_total_instincts_per_project: 30,
      max_total_instincts_global: 20,
      max_new_instincts_per_run: 3,
      flagged_cleanup_days: 7,
      instinct_ttl_days: 28,
      dreaming_enabled: true,
      consolidation_interval_days: 7,
      consolidation_min_sessions: 10,
      recurring_prompt_min_sessions: 3,
      recurring_prompt_score_boost: 3,
      max_facts_per_project: 30,
      max_facts_global: 50,
      max_new_facts_per_run: 3,
    };
    expect(config.run_interval_minutes).toBe(5);
    expect(config.model).toBe("claude-haiku-4-5");
    expect(config.active_hours_start).toBe(8);
    expect(config.max_idle_seconds).toBe(1800);
    expect(config.max_total_instincts_per_project).toBe(30);
    expect(config.max_new_instincts_per_run).toBe(3);
    expect(config.flagged_cleanup_days).toBe(7);
    expect(config.instinct_ttl_days).toBe(28);
  });
});
