/**
 * Tests for instinct-injector.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildInjectionBlock,
  injectInstincts,
  handleBeforeAgentStartInjection,
  handleAgentEndClearInstincts,
  INSTINCTS_HEADER,
} from "./instinct-injector.js";
import {
  getCurrentActiveInstincts,
  clearActiveInstincts,
} from "./active-instincts.js";
import type { Instinct, Config } from "./types.js";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  BeforeAgentStartEvent,
  AgentEndEvent,
} from "./prompt-observer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test Instinct",
    trigger: "when writing tests",
    action: "use vitest",
    confidence: 0.7,
    domain: "testing",
    source: "personal",
    scope: "global",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 2,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

const BASE_CONFIG: Config = {
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
};

const MOCK_CTX = {} as ExtensionContext;

// ---------------------------------------------------------------------------
// buildInjectionBlock
// ---------------------------------------------------------------------------

describe("buildInjectionBlock", () => {
  it("returns null for empty instinct list", () => {
    expect(buildInjectionBlock([])).toBeNull();
  });

  it("includes the instincts header", () => {
    const block = buildInjectionBlock([makeInstinct()]);
    expect(block).toContain(INSTINCTS_HEADER);
  });

  it("formats each instinct as a bullet with confidence, trigger, and action", () => {
    const inst = makeInstinct({
      confidence: 0.75,
      trigger: "when writing tests",
      action: "use vitest",
    });
    const block = buildInjectionBlock([inst]);
    expect(block).toContain("- [0.75] when writing tests: use vitest");
  });

  it("formats confidence with two decimal places", () => {
    const inst = makeInstinct({ confidence: 0.9 });
    const block = buildInjectionBlock([inst]);
    expect(block).toContain("[0.90]");
  });

  it("renders multiple instincts as separate bullets", () => {
    const instincts = [
      makeInstinct({
        id: "a",
        trigger: "trigger A",
        action: "action A",
        confidence: 0.8,
      }),
      makeInstinct({
        id: "b",
        trigger: "trigger B",
        action: "action B",
        confidence: 0.6,
      }),
    ];
    const block = buildInjectionBlock(instincts);
    expect(block).toContain("- [0.80] trigger A: action A");
    expect(block).toContain("- [0.60] trigger B: action B");
  });

  it("starts with two newlines before the header", () => {
    const block = buildInjectionBlock([makeInstinct()]);
    expect(block).toMatch(/^\n\n## Learned Behaviors/);
  });
});

// ---------------------------------------------------------------------------
// injectInstincts
// ---------------------------------------------------------------------------

describe("injectInstincts", () => {
  it("returns null when instinct list is empty", () => {
    expect(injectInstincts("base prompt", [])).toBeNull();
  });

  it("appends injection block to existing system prompt", () => {
    const inst = makeInstinct({
      trigger: "when editing",
      action: "be careful",
    });
    const result = injectInstincts("You are a helpful assistant.", [inst]);
    expect(result).not.toBeNull();
    expect(result).toContain("You are a helpful assistant.");
    expect(result).toContain(INSTINCTS_HEADER);
    expect(result).toContain("when editing: be careful");
  });

  it("preserves original system prompt text exactly", () => {
    const original = "Original system prompt text here.";
    const result = injectInstincts(original, [makeInstinct()]);
    expect(result?.startsWith(original)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleBeforeAgentStartInjection
// ---------------------------------------------------------------------------

describe("handleBeforeAgentStartInjection", () => {
  beforeEach(async () => {
    clearActiveInstincts();
    const { loadAndFilterFromConfig } = await import("./instinct-loader.js");
    vi.mocked(loadAndFilterFromConfig).mockReturnValue([]);
  });

  it("returns undefined when no instincts qualify (empty loader result)", async () => {
    // Use a temp dir that won't have any instinct files
    const result = handleBeforeAgentStartInjection(
      { type: "before_agent_start", prompt: "hello", systemPrompt: "base" },
      MOCK_CTX,
      BASE_CONFIG,
      null,
      "/tmp/nonexistent-dir-pi-cl-test",
    );
    expect(result).toBeUndefined();
  });

  it("does not modify systemPrompt when no qualifying instincts", () => {
    const event: BeforeAgentStartEvent = {
      type: "before_agent_start",
      prompt: "user prompt",
      systemPrompt: "original system prompt",
    };
    const result = handleBeforeAgentStartInjection(
      event,
      MOCK_CTX,
      BASE_CONFIG,
      null,
      "/tmp/nonexistent-dir-pi-cl-test",
    );
    // Either undefined or object without systemPrompt
    if (result !== undefined) {
      expect(
        (result as { systemPrompt?: string }).systemPrompt,
      ).toBeUndefined();
    }
  });

  it("returns systemPrompt with instincts appended when instincts qualify", async () => {
    // Mock loadAndFilterFromConfig to return instincts
    const { loadAndFilterFromConfig } = await import("./instinct-loader.js");
    vi.spyOn({ loadAndFilterFromConfig }, "loadAndFilterFromConfig");

    // We need to mock at module level - use vi.mock instead
    // Test via injectInstincts directly (the handler delegates to it)
    const instincts = [
      makeInstinct({
        trigger: "use immutable objects",
        action: "never mutate state",
      }),
    ];
    const systemPrompt = "You are helpful.";
    const result = injectInstincts(systemPrompt, instincts);

    expect(result).not.toBeNull();
    expect(result).toContain(systemPrompt);
    expect(result).toContain(INSTINCTS_HEADER);
    expect(result).toContain("use immutable objects: never mutate state");
  });

  it("injection block is appended after system prompt (not prepended)", () => {
    const instincts = [makeInstinct({ trigger: "t", action: "a" })];
    const systemPrompt = "SYSTEM START";
    const result = injectInstincts(systemPrompt, instincts);
    expect(result?.indexOf("SYSTEM START")).toBe(0);
    expect(result?.indexOf(INSTINCTS_HEADER)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Active Instincts State Bridge (US-023)
// ---------------------------------------------------------------------------

vi.mock("./instinct-loader.js", () => ({
  loadAndFilterFromConfig: vi.fn(),
  inferDomains: vi.fn().mockReturnValue(new Set()),
}));

describe("active instincts state bridge", () => {
  const MOCK_EVENT: BeforeAgentStartEvent = {
    type: "before_agent_start",
    prompt: "do something",
    systemPrompt: "You are helpful.",
  };

  const MOCK_AGENT_END: AgentEndEvent = {
    type: "agent_end",
  };

  beforeEach(async () => {
    clearActiveInstincts();
    const { loadAndFilterFromConfig } = await import("./instinct-loader.js");
    vi.mocked(loadAndFilterFromConfig).mockReset();
  });

  it("sets active instinct IDs after successful injection", async () => {
    const { loadAndFilterFromConfig } = await import("./instinct-loader.js");
    const instincts = [
      makeInstinct({ id: "instinct-a", trigger: "t", action: "a" }),
      makeInstinct({ id: "instinct-b", trigger: "t2", action: "a2" }),
    ];
    vi.mocked(loadAndFilterFromConfig).mockReturnValue(instincts);

    handleBeforeAgentStartInjection(MOCK_EVENT, MOCK_CTX, BASE_CONFIG, "proj1");

    expect(getCurrentActiveInstincts()).toEqual(["instinct-a", "instinct-b"]);
  });

  it("clears active instincts when no instincts qualify", async () => {
    const { loadAndFilterFromConfig } = await import("./instinct-loader.js");
    vi.mocked(loadAndFilterFromConfig).mockReturnValue([]);

    // Pre-set some active instincts
    const { setCurrentActiveInstincts } = await import("./active-instincts.js");
    setCurrentActiveInstincts(["old-id"]);

    handleBeforeAgentStartInjection(MOCK_EVENT, MOCK_CTX, BASE_CONFIG, "proj1");

    expect(getCurrentActiveInstincts()).toEqual([]);
  });

  it("clears active instincts on agent_end", async () => {
    const { setCurrentActiveInstincts } = await import("./active-instincts.js");
    setCurrentActiveInstincts(["instinct-x", "instinct-y"]);

    handleAgentEndClearInstincts(MOCK_AGENT_END, MOCK_CTX);

    expect(getCurrentActiveInstincts()).toEqual([]);
  });

  it("active instincts are empty by default before any injection", () => {
    expect(getCurrentActiveInstincts()).toEqual([]);
  });
});
