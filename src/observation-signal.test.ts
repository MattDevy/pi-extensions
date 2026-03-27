import { describe, it, expect } from "vitest";
import {
  scoreObservationBatch,
  isLowSignalBatch,
  LOW_SIGNAL_THRESHOLD,
} from "./observation-signal.js";
import type { Observation } from "./types.js";

const base: Omit<Observation, "event"> = {
  timestamp: "2026-01-01T00:00:00.000Z",
  session: "sess-1",
  project_id: "proj-1",
  project_name: "test",
};

function line(obs: Partial<Observation>): string {
  return JSON.stringify({ ...base, ...obs });
}

describe("scoreObservationBatch", () => {
  it("returns zero for empty batch", () => {
    const result = scoreObservationBatch([]);
    expect(result.score).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.corrections).toBe(0);
    expect(result.userPrompts).toBe(0);
  });

  it("returns zero for batch with only routine tool_complete events", () => {
    const lines = [
      line({ event: "tool_complete", tool: "read", is_error: false }),
      line({ event: "tool_complete", tool: "bash", is_error: false }),
    ];
    const result = scoreObservationBatch(lines);
    expect(result.score).toBe(0);
  });

  it("scores error observations at +2 each", () => {
    const lines = [
      line({ event: "tool_complete", tool: "bash", is_error: true }),
    ];
    const result = scoreObservationBatch(lines);
    expect(result.score).toBe(2);
    expect(result.errors).toBe(1);
  });

  it("scores user_prompt after error as correction (+3)", () => {
    const lines = [
      line({ event: "tool_complete", tool: "bash", is_error: true }),
      line({ event: "user_prompt" }),
    ];
    const result = scoreObservationBatch(lines);
    expect(result.score).toBe(5); // 2 (error) + 3 (correction)
    expect(result.corrections).toBe(1);
  });

  it("scores user_prompt without prior error at +1", () => {
    const lines = [
      line({ event: "user_prompt" }),
    ];
    const result = scoreObservationBatch(lines);
    expect(result.score).toBe(1);
    expect(result.userPrompts).toBe(1);
    expect(result.corrections).toBe(0);
  });

  it("resets error flag after non-error event", () => {
    const lines = [
      line({ event: "tool_complete", tool: "bash", is_error: true }),
      line({ event: "tool_complete", tool: "read", is_error: false }),
      line({ event: "user_prompt" }),
    ];
    const result = scoreObservationBatch(lines);
    // error (+2) + normal user_prompt (+1) = 3
    expect(result.score).toBe(3);
    expect(result.corrections).toBe(0);
  });

  it("handles multiple errors and corrections", () => {
    const lines = [
      line({ event: "tool_complete", tool: "bash", is_error: true }),
      line({ event: "user_prompt" }), // correction: +3
      line({ event: "tool_complete", tool: "bash", is_error: true }),
      line({ event: "user_prompt" }), // correction: +3
    ];
    const result = scoreObservationBatch(lines);
    expect(result.score).toBe(10); // 2 + 3 + 2 + 3
    expect(result.errors).toBe(2);
    expect(result.corrections).toBe(2);
  });

  it("skips malformed lines without throwing", () => {
    const lines = ["not json", "", "   ", line({ event: "user_prompt" })];
    const result = scoreObservationBatch(lines);
    expect(result.score).toBe(1);
  });

  it("ignores blank lines", () => {
    expect(scoreObservationBatch(["", "  ", "\n"]).score).toBe(0);
  });
});

describe("isLowSignalBatch", () => {
  it("returns true for empty batch", () => {
    expect(isLowSignalBatch([])).toBe(true);
  });

  it("returns true when score is below threshold", () => {
    const lines = [line({ event: "user_prompt" })]; // score = 1
    expect(isLowSignalBatch(lines)).toBe(true);
  });

  it("returns false when score meets threshold", () => {
    const lines = [
      line({ event: "tool_complete", tool: "bash", is_error: true }),
      line({ event: "user_prompt" }), // score = 5
    ];
    expect(isLowSignalBatch(lines)).toBe(false);
  });

  it(`LOW_SIGNAL_THRESHOLD is ${LOW_SIGNAL_THRESHOLD}`, () => {
    expect(LOW_SIGNAL_THRESHOLD).toBe(3);
  });
});
