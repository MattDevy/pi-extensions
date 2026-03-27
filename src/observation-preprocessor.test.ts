import { describe, it, expect } from "vitest";
import { preprocessObservation, preprocessObservations } from "./observation-preprocessor.js";
import type { Observation } from "./types.js";

const base: Omit<Observation, "event"> = {
  timestamp: "2026-01-01T00:00:00.000Z",
  session: "sess-1",
  project_id: "proj-1",
  project_name: "test",
};

describe("preprocessObservation", () => {
  it("drops turn_start events", () => {
    const obs: Observation = { ...base, event: "turn_start", turn_index: 0 };
    expect(preprocessObservation(obs)).toBeNull();
  });

  it("drops tool_start events", () => {
    const obs: Observation = { ...base, event: "tool_start", tool: "bash", input: "ls" };
    expect(preprocessObservation(obs)).toBeNull();
  });

  it("strips output from non-error tool_complete", () => {
    const obs: Observation = {
      ...base,
      event: "tool_complete",
      tool: "bash",
      output: "a".repeat(3000),
      is_error: false,
    };
    const result = preprocessObservation(obs);
    expect(result).not.toBeNull();
    expect(result?.output).toBeUndefined();
    expect(result?.is_error).toBe(false);
    expect(result?.tool).toBe("bash");
  });

  it("does not mutate the original observation when stripping output", () => {
    const obs: Observation = {
      ...base,
      event: "tool_complete",
      tool: "bash",
      output: "some output",
      is_error: false,
    };
    preprocessObservation(obs);
    expect(obs.output).toBe("some output");
  });

  it("keeps full output on error tool_complete", () => {
    const obs: Observation = {
      ...base,
      event: "tool_complete",
      tool: "bash",
      output: "error: command not found",
      is_error: true,
    };
    const result = preprocessObservation(obs);
    expect(result).not.toBeNull();
    expect(result?.output).toBe("error: command not found");
  });

  it("passes through user_prompt unchanged", () => {
    const obs: Observation = { ...base, event: "user_prompt", input: "fix the bug" };
    expect(preprocessObservation(obs)).toEqual(obs);
  });

  it("passes through turn_end unchanged", () => {
    const obs: Observation = {
      ...base,
      event: "turn_end",
      turn_index: 2,
      tool_count: 3,
      error_count: 1,
      tokens_used: 5000,
    };
    expect(preprocessObservation(obs)).toEqual(obs);
  });

  it("passes through user_bash unchanged", () => {
    const obs: Observation = { ...base, event: "user_bash", command: "npm test", cwd: "/project" };
    expect(preprocessObservation(obs)).toEqual(obs);
  });

  it("passes through model_select unchanged", () => {
    const obs: Observation = { ...base, event: "model_select", model: "claude-opus-4-5" };
    expect(preprocessObservation(obs)).toEqual(obs);
  });

  it("passes through session_compact unchanged", () => {
    const obs: Observation = { ...base, event: "session_compact" };
    expect(preprocessObservation(obs)).toEqual(obs);
  });

  it("passes through agent_end unchanged", () => {
    const obs: Observation = { ...base, event: "agent_end" };
    expect(preprocessObservation(obs)).toEqual(obs);
  });
});

describe("preprocessObservations", () => {
  it("filters and transforms a mixed batch", () => {
    const batch: Observation[] = [
      { ...base, event: "turn_start", turn_index: 0 },
      { ...base, event: "tool_start", tool: "read", input: "/file" },
      { ...base, event: "tool_complete", tool: "read", output: "content", is_error: false },
      { ...base, event: "tool_complete", tool: "edit", output: "ENOENT", is_error: true },
      { ...base, event: "turn_end", turn_index: 0, tool_count: 2, error_count: 1 },
      { ...base, event: "user_bash", command: "git status" },
    ];
    const result = preprocessObservations(batch);
    expect(result).toHaveLength(4); // drops turn_start, tool_start
    expect(result[0]?.event).toBe("tool_complete"); // non-error, output stripped
    expect(result[0]?.output).toBeUndefined();
    expect(result[1]?.event).toBe("tool_complete"); // error, output kept
    expect(result[1]?.output).toBe("ENOENT");
    expect(result[2]?.event).toBe("turn_end");
    expect(result[3]?.event).toBe("user_bash");
  });

  it("returns empty array for empty input", () => {
    expect(preprocessObservations([])).toEqual([]);
  });

  it("does not mutate input observations", () => {
    const obs: Observation = {
      ...base,
      event: "tool_complete",
      tool: "bash",
      output: "data",
      is_error: false,
    };
    preprocessObservations([obs]);
    expect(obs.output).toBe("data");
  });
});
