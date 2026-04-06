import { describe, it, expect } from "vitest";
import {
  scoreObservationBatch,
  isLowSignalBatch,
  LOW_SIGNAL_THRESHOLD,
  ACTIVE_INSTINCT_BOOST_CAP,
  type FrequencyBoostContext,
} from "./observation-signal.js";
import type { Observation, PromptFrequencyTable } from "./types.js";
import { normalizePrompt, hashPrompt } from "./prompt-frequency.js";

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

  it("scores model_select at +1", () => {
    const lines = [line({ event: "model_select" })];
    const result = scoreObservationBatch(lines);
    expect(result.score).toBe(1);
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

// ---------------------------------------------------------------------------
// Frequency boost
// ---------------------------------------------------------------------------

function makeFreqContext(
  prompts: Record<string, number>,
  minSessions = 3,
  scoreBoost = 3
): FrequencyBoostContext {
  const projectFrequency: PromptFrequencyTable = {};
  for (const [text, sessionCount] of Object.entries(prompts)) {
    const key = hashPrompt(normalizePrompt(text));
    projectFrequency[key] = {
      count: sessionCount,
      sessions: Array.from({ length: sessionCount }, (_, i) => `sess-${i + 1}`),
      last_text: text,
      first_seen: "2026-01-01T00:00:00Z",
      last_seen: "2026-03-27T00:00:00Z",
    };
  }
  return { projectFrequency, minSessions, scoreBoost };
}

describe("scoreObservationBatch with frequency boost", () => {
  it("boosts score for recurring prompt (>= minSessions)", () => {
    const ctx = makeFreqContext({ "PR it": 5 });
    const lines = [line({ event: "user_prompt", input: "PR it" })];
    const result = scoreObservationBatch(lines, ctx);
    expect(result.score).toBe(4); // 1 (user_prompt) + 3 (boost)
    expect(result.recurringPrompts).toBe(1);
  });

  it("does not boost for non-recurring prompt (< minSessions)", () => {
    const ctx = makeFreqContext({ "PR it": 2 });
    const lines = [line({ event: "user_prompt", input: "PR it" })];
    const result = scoreObservationBatch(lines, ctx);
    expect(result.score).toBe(1);
    expect(result.recurringPrompts).toBe(0);
  });

  it("boosts multiple recurring prompts in same batch", () => {
    const ctx = makeFreqContext({ "PR it": 3, "ship it": 4 });
    const lines = [
      line({ event: "user_prompt", input: "PR it" }),
      line({ event: "user_prompt", input: "ship it" }),
    ];
    const result = scoreObservationBatch(lines, ctx);
    expect(result.score).toBe(8); // 1+3 + 1+3
    expect(result.recurringPrompts).toBe(2);
  });

  it("returns recurringPrompts=0 when no freqContext provided", () => {
    const lines = [line({ event: "user_prompt", input: "PR it" })];
    const result = scoreObservationBatch(lines);
    expect(result.score).toBe(1);
    expect(result.recurringPrompts).toBe(0);
  });

  it("normalizes prompt before lookup (case, whitespace, punctuation)", () => {
    const ctx = makeFreqContext({ "pr it": 3 }); // normalized form
    const lines = [line({ event: "user_prompt", input: "  PR  It!  " })];
    const result = scoreObservationBatch(lines, ctx);
    expect(result.recurringPrompts).toBe(1);
  });
});

describe("isLowSignalBatch with frequency boost", () => {
  it("returns false when boost pushes score past threshold", () => {
    const ctx = makeFreqContext({ "PR it": 3 });
    const lines = [line({ event: "user_prompt", input: "PR it" })];
    // Without boost: score=1, below threshold. With boost: score=4.
    expect(isLowSignalBatch(lines)).toBe(true);
    expect(isLowSignalBatch(lines, ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Active instinct confirmation boost
// ---------------------------------------------------------------------------

describe("scoreObservationBatch active instinct boost", () => {
  it("adds +1 per distinct active instinct on a clean session", () => {
    const lines = [
      line({ event: "user_prompt", active_instincts: ["inst-a"] }),
      line({ event: "tool_complete", tool: "read", active_instincts: ["inst-a", "inst-b"] }),
      line({ event: "agent_end", active_instincts: ["inst-b"] }),
    ];
    const result = scoreObservationBatch(lines);
    // user_prompt: +1, active instinct boost: +2 (inst-a, inst-b)
    expect(result.score).toBe(3);
    expect(result.activeInstinctBoost).toBe(2);
  });

  it("caps boost at ACTIVE_INSTINCT_BOOST_CAP when more than cap distinct IDs present", () => {
    const lines = [
      line({ event: "user_prompt", active_instincts: ["a", "b", "c", "d"] }),
    ];
    const result = scoreObservationBatch(lines);
    expect(result.activeInstinctBoost).toBe(ACTIVE_INSTINCT_BOOST_CAP);
    expect(result.score).toBe(1 + ACTIVE_INSTINCT_BOOST_CAP);
  });

  it("does not boost when errors are present", () => {
    const lines = [
      line({ event: "tool_complete", tool: "bash", is_error: true, active_instincts: ["inst-a"] }),
      line({ event: "user_prompt" }),
    ];
    const result = scoreObservationBatch(lines);
    expect(result.activeInstinctBoost).toBe(0);
  });

  it("does not boost when corrections are present", () => {
    const lines = [
      line({ event: "tool_complete", tool: "bash", is_error: true, active_instincts: ["inst-a"] }),
      line({ event: "user_prompt", active_instincts: ["inst-a"] }), // correction
    ];
    const result = scoreObservationBatch(lines);
    expect(result.corrections).toBe(1);
    expect(result.activeInstinctBoost).toBe(0);
  });

  it("does not boost when no active instincts in the batch", () => {
    const lines = [
      line({ event: "user_prompt" }),
      line({ event: "tool_complete", tool: "read" }),
    ];
    const result = scoreObservationBatch(lines);
    expect(result.activeInstinctBoost).toBe(0);
  });

  it("deduplicates the same instinct ID across multiple observations", () => {
    const lines = [
      line({ event: "user_prompt", active_instincts: ["inst-a"] }),
      line({ event: "tool_complete", tool: "read", active_instincts: ["inst-a"] }),
      line({ event: "agent_end", active_instincts: ["inst-a"] }),
    ];
    const result = scoreObservationBatch(lines);
    expect(result.activeInstinctBoost).toBe(1);
  });

  it("returns activeInstinctBoost=0 when no active instincts and no errors", () => {
    const result = scoreObservationBatch([]);
    expect(result.activeInstinctBoost).toBe(0);
  });
});

describe("isLowSignalBatch active instinct boost", () => {
  it("returns false when active instinct boost pushes score past threshold", () => {
    // user_prompt (+1) + 2 distinct instincts (+2) = 3, meets threshold
    const lines = [
      line({ event: "user_prompt", active_instincts: ["inst-a", "inst-b"] }),
    ];
    expect(isLowSignalBatch(lines)).toBe(false);
  });

  it("returns true for single instinct with single user_prompt (score=2 < 3)", () => {
    const lines = [
      line({ event: "user_prompt", active_instincts: ["inst-a"] }),
    ];
    expect(isLowSignalBatch(lines)).toBe(true);
  });
});
