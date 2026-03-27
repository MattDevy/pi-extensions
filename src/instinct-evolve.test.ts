import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Instinct } from "./types.js";
import {
  COMMAND_NAME,
  MERGE_SIMILARITY_THRESHOLD,
  ACTION_SIMILARITY_THRESHOLD,
  PROMOTION_CONFIDENCE_THRESHOLD,
  COMMAND_TRIGGER_KEYWORDS,
  tokenizeText,
  triggerSimilarity,
  actionSimilarity,
  findMergeCandidates,
  findCommandCandidates,
  findPromotionCandidates,
  generateEvolveSuggestions,
  formatEvolveSuggestions,
  loadInstinctsForEvolve,
  handleInstinctEvolve,
} from "./instinct-evolve.js";
import { ensureStorageLayout } from "./storage.js";
import { saveInstinct } from "./instinct-store.js";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-cl-evolve-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

let idCounter = 0;
function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  idCounter += 1;
  return {
    id: `instinct-${idCounter}`,
    title: "Test Instinct",
    trigger: "when testing code",
    action: "run the tests",
    confidence: 0.6,
    domain: "testing",
    source: "personal",
    scope: "project",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 2,
    contradicted_count: 1,
    inactive_count: 2,
    ...overrides,
  };
}

function mockCtx(): ExtensionCommandContext {
  return { ui: { notify: vi.fn() } } as unknown as ExtensionCommandContext;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("COMMAND_NAME is instinct-evolve", () => {
    expect(COMMAND_NAME).toBe("instinct-evolve");
  });

  it("MERGE_SIMILARITY_THRESHOLD is a positive number <= 1", () => {
    expect(MERGE_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(MERGE_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it("ACTION_SIMILARITY_THRESHOLD is a positive number <= 1", () => {
    expect(ACTION_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(ACTION_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it("PROMOTION_CONFIDENCE_THRESHOLD is in [0, 1]", () => {
    expect(PROMOTION_CONFIDENCE_THRESHOLD).toBeGreaterThanOrEqual(0);
    expect(PROMOTION_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it("COMMAND_TRIGGER_KEYWORDS is a non-empty array", () => {
    expect(COMMAND_TRIGGER_KEYWORDS.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// tokenizeText
// ---------------------------------------------------------------------------

describe("tokenizeText", () => {
  it("returns lowercase tokens from a trigger string", () => {
    const tokens = tokenizeText("Run the Tests Now");
    expect(tokens.has("run")).toBe(true);
    expect(tokens.has("tests")).toBe(true);
    expect(tokens.has("now")).toBe(true);
  });

  it("filters out stop words", () => {
    const tokens = tokenizeText("when the test is done");
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("when")).toBe(false);
    expect(tokens.has("is")).toBe(false);
    expect(tokens.has("test")).toBe(true);
    expect(tokens.has("done")).toBe(true);
  });

  it("filters out short words (length < 3)", () => {
    const tokens = tokenizeText("do it now");
    expect(tokens.has("do")).toBe(false);
    expect(tokens.has("it")).toBe(false);
    expect(tokens.has("now")).toBe(true);
  });

  it("strips punctuation", () => {
    const tokens = tokenizeText("always: run tests!");
    expect(tokens.has("always")).toBe(true);
    expect(tokens.has("tests")).toBe(true);
    expect(tokens.has(":")).toBe(false);
    expect(tokens.has("!")).toBe(false);
  });

  it("returns empty set for stop-word-only input", () => {
    const tokens = tokenizeText("when the is");
    expect(tokens.size).toBe(0);
  });

  it("tokenizes action text (not just trigger text)", () => {
    const tokens = tokenizeText("execute the linting pipeline");
    expect(tokens.has("execute")).toBe(true);
    expect(tokens.has("linting")).toBe(true);
    expect(tokens.has("pipeline")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// triggerSimilarity
// ---------------------------------------------------------------------------

describe("triggerSimilarity", () => {
  it("returns 1 for identical triggers", () => {
    const a = makeInstinct({ trigger: "always run tests before commit" });
    const b = makeInstinct({ trigger: "always run tests before commit" });
    expect(triggerSimilarity(a, b)).toBe(1);
  });

  it("returns 0 for completely different triggers", () => {
    const a = makeInstinct({ trigger: "formatting python files" });
    const b = makeInstinct({ trigger: "reviewing security vulnerabilities" });
    expect(triggerSimilarity(a, b)).toBe(0);
  });

  it("returns 0 when both triggers tokenize to empty sets", () => {
    const a = makeInstinct({ trigger: "when is it" });
    const b = makeInstinct({ trigger: "if or and" });
    expect(triggerSimilarity(a, b)).toBe(0);
  });

  it("returns partial overlap value for shared words", () => {
    const a = makeInstinct({ trigger: "run tests before deployment" });
    const b = makeInstinct({ trigger: "run tests after merging" });
    const sim = triggerSimilarity(a, b);
    // "run", "tests" shared out of "run", "tests", "deployment", "merging" = 2/4 = 0.5
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// actionSimilarity
// ---------------------------------------------------------------------------

describe("actionSimilarity", () => {
  it("returns 1 for identical actions", () => {
    const a = makeInstinct({ action: "run npx eslint and fix errors" });
    const b = makeInstinct({ action: "run npx eslint and fix errors" });
    expect(actionSimilarity(a, b)).toBe(1);
  });

  it("returns 0 for completely different actions", () => {
    const a = makeInstinct({ action: "format python source code" });
    const b = makeInstinct({ action: "check security vulnerabilities" });
    expect(actionSimilarity(a, b)).toBe(0);
  });

  it("returns 0 when both actions tokenize to empty sets", () => {
    const a = makeInstinct({ action: "do it" });
    const b = makeInstinct({ action: "be the" });
    expect(actionSimilarity(a, b)).toBe(0);
  });

  it("returns partial overlap value for shared action words", () => {
    const a = makeInstinct({ action: "run the linting checks before commit" });
    const b = makeInstinct({ action: "run the linting checks after changes" });
    const sim = actionSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("uses tokenizeText on action field (not trigger)", () => {
    const a = makeInstinct({ trigger: "totally different context", action: "execute linting pipeline" });
    const b = makeInstinct({ trigger: "something else entirely", action: "execute linting pipeline" });
    expect(actionSimilarity(a, b)).toBe(1);
    expect(triggerSimilarity(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findMergeCandidates
// ---------------------------------------------------------------------------

describe("findMergeCandidates", () => {
  it("returns empty array when fewer than 2 instincts", () => {
    const instincts = [makeInstinct({ domain: "testing" })];
    expect(findMergeCandidates(instincts)).toHaveLength(0);
  });

  it("returns empty array when instincts have no trigger or action overlap", () => {
    const instincts = [
      makeInstinct({
        trigger: "formatting python source",
        action: "reformat file indentation",
        domain: "testing",
      }),
      makeInstinct({
        trigger: "reviewing security vulnerabilities",
        action: "scan dependencies packages",
        domain: "testing",
      }),
    ];
    expect(findMergeCandidates(instincts)).toHaveLength(0);
  });

  it("groups similar-trigger instincts in the same domain as merge candidates", () => {
    const instincts = [
      makeInstinct({ id: "a", trigger: "run tests before commit", domain: "testing" }),
      makeInstinct({ id: "b", trigger: "run tests after changes", domain: "testing" }),
    ];
    const result = findMergeCandidates(instincts);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("merge");
    expect(result[0]!.instincts).toHaveLength(2);
  });

  it("does NOT group similar instincts from different domains", () => {
    const instincts = [
      makeInstinct({ id: "a", trigger: "run tests before commit", domain: "testing" }),
      makeInstinct({ id: "b", trigger: "run tests after changes", domain: "deployment" }),
    ];
    const result = findMergeCandidates(instincts);
    expect(result).toHaveLength(0);
  });

  it("clusters three connected instincts into one group", () => {
    const instincts = [
      makeInstinct({ id: "a", trigger: "run tests commit deploy", domain: "workflow" }),
      makeInstinct({ id: "b", trigger: "run tests commit frequently", domain: "workflow" }),
      makeInstinct({ id: "c", trigger: "run tests frequently checks", domain: "workflow" }),
    ];
    const result = findMergeCandidates(instincts);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const ids = result.flatMap((s) => s.instincts.map((i) => i.id));
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
  });

  it("sets recommendation to 'merge' for trigger-similarity pairs", () => {
    const instincts = [
      makeInstinct({ id: "a", trigger: "run tests before commit", action: "check coverage report", domain: "testing" }),
      makeInstinct({ id: "b", trigger: "run tests after changes", action: "validate all assertions", domain: "testing" }),
    ];
    const result = findMergeCandidates(instincts);
    expect(result).toHaveLength(1);
    expect(result[0]!.recommendation).toBe("merge");
  });

  it("sets recommendation to 'delete-lower' for action-similarity pairs", () => {
    // Different triggers but same action -> caught only by action pass
    const instincts = [
      makeInstinct({
        id: "a",
        trigger: "before shipping feature code",
        action: "run linting checks pipeline",
        domain: "style",
      }),
      makeInstinct({
        id: "b",
        trigger: "after merging pull request",
        action: "run linting checks pipeline",
        domain: "style",
      }),
    ];
    const result = findMergeCandidates(instincts);
    expect(result).toHaveLength(1);
    expect(result[0]!.recommendation).toBe("delete-lower");
  });

  it("does not duplicate pairs already caught by trigger pass in action pass", () => {
    // Both trigger AND action are similar - should only appear once
    const instincts = [
      makeInstinct({
        id: "a",
        trigger: "run linting before commit",
        action: "execute eslint checks",
        domain: "style",
      }),
      makeInstinct({
        id: "b",
        trigger: "run linting after change",
        action: "execute eslint checks",
        domain: "style",
      }),
    ];
    const result = findMergeCandidates(instincts);
    // Should be exactly one suggestion, not two
    expect(result).toHaveLength(1);
    const ids = result.flatMap((s) => s.instincts.map((i) => i.id));
    const aCount = ids.filter((id) => id === "a").length;
    const bCount = ids.filter((id) => id === "b").length;
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);
  });

  it("sets keepId to the higher-confidence instinct", () => {
    const instincts = [
      makeInstinct({ id: "low", trigger: "run tests before commit", confidence: 0.5, domain: "testing" }),
      makeInstinct({ id: "high", trigger: "run tests after changes", confidence: 0.9, domain: "testing" }),
    ];
    const result = findMergeCandidates(instincts);
    expect(result).toHaveLength(1);
    expect(result[0]!.keepId).toBe("high");
  });

  it("tie-breaks keepId alphabetically when confidence is equal", () => {
    const instincts = [
      makeInstinct({ id: "zebra", trigger: "run tests before commit", confidence: 0.7, domain: "testing" }),
      makeInstinct({ id: "alpha", trigger: "run tests after changes", confidence: 0.7, domain: "testing" }),
    ];
    const result = findMergeCandidates(instincts);
    expect(result).toHaveLength(1);
    // "alpha" < "zebra" alphabetically, so "alpha" wins tie-break
    expect(result[0]!.keepId).toBe("alpha");
  });
});

// ---------------------------------------------------------------------------
// findCommandCandidates
// ---------------------------------------------------------------------------

describe("findCommandCandidates", () => {
  it("returns empty array when no workflow triggers", () => {
    const instincts = [
      makeInstinct({ trigger: "formatting code files", domain: "style" }),
    ];
    expect(findCommandCandidates(instincts)).toHaveLength(0);
  });

  it("detects instinct with 'always' keyword as command candidate", () => {
    const instinct = makeInstinct({ trigger: "always run linting checks", domain: "style" });
    const result = findCommandCandidates([instinct]);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("command");
    expect(result[0]!.instinct.id).toBe(instinct.id);
  });

  it("detects instinct with 'whenever' keyword as command candidate", () => {
    const instinct = makeInstinct({ trigger: "whenever tests fail debug", domain: "testing" });
    const result = findCommandCandidates([instinct]);
    expect(result).toHaveLength(1);
  });

  it("detects instinct with domain=workflow as command candidate", () => {
    const instinct = makeInstinct({ trigger: "checking code quality", domain: "workflow" });
    const result = findCommandCandidates([instinct]);
    expect(result).toHaveLength(1);
  });

  it("does not detect normal instinct without trigger keywords", () => {
    const instinct = makeInstinct({ trigger: "debugging failing tests", domain: "testing" });
    const result = findCommandCandidates([instinct]);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findPromotionCandidates
// ---------------------------------------------------------------------------

describe("findPromotionCandidates", () => {
  it("returns empty array when no project instincts", () => {
    const result = findPromotionCandidates([], new Set());
    expect(result).toHaveLength(0);
  });

  it("suggests high-confidence project instinct not in global", () => {
    const instinct = makeInstinct({
      scope: "project",
      confidence: PROMOTION_CONFIDENCE_THRESHOLD,
    });
    const result = findPromotionCandidates([instinct], new Set());
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("promotion");
    expect(result[0]!.instinct.id).toBe(instinct.id);
  });

  it("skips project instinct below confidence threshold", () => {
    const instinct = makeInstinct({
      scope: "project",
      confidence: PROMOTION_CONFIDENCE_THRESHOLD - 0.1,
    });
    const result = findPromotionCandidates([instinct], new Set());
    expect(result).toHaveLength(0);
  });

  it("skips project instinct already in global", () => {
    const instinct = makeInstinct({
      scope: "project",
      confidence: 0.9,
    });
    const result = findPromotionCandidates([instinct], new Set([instinct.id]));
    expect(result).toHaveLength(0);
  });

  it("skips global-scoped instinct even with high confidence", () => {
    const instinct = makeInstinct({
      scope: "global",
      confidence: 0.9,
    });
    const result = findPromotionCandidates([instinct], new Set());
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateEvolveSuggestions
// ---------------------------------------------------------------------------

describe("generateEvolveSuggestions", () => {
  it("returns empty array when no instincts", () => {
    const result = generateEvolveSuggestions([], []);
    expect(result).toHaveLength(0);
  });

  it("combines merge, command, and promotion suggestions", () => {
    const mergeable1 = makeInstinct({
      id: "m1",
      trigger: "run tests before commit",
      domain: "testing",
      scope: "global",
    });
    const mergeable2 = makeInstinct({
      id: "m2",
      trigger: "run tests after changes",
      domain: "testing",
      scope: "global",
    });
    const workflow = makeInstinct({
      id: "wf1",
      trigger: "always check formatting",
      domain: "style",
      scope: "global",
    });
    const promotion = makeInstinct({
      id: "promo1",
      trigger: "checking security",
      domain: "security",
      scope: "project",
      confidence: 0.8,
    });

    const result = generateEvolveSuggestions([promotion], [mergeable1, mergeable2, workflow]);
    const types = result.map((s) => s.type);
    expect(types).toContain("merge");
    expect(types).toContain("command");
    expect(types).toContain("promotion");
  });
});

// ---------------------------------------------------------------------------
// formatEvolveSuggestions
// ---------------------------------------------------------------------------

describe("formatEvolveSuggestions", () => {
  it("returns no-suggestion message when empty", () => {
    const output = formatEvolveSuggestions([]);
    expect(output).toContain("No evolution suggestions");
  });

  it("includes merge section header when merge suggestions exist", () => {
    const instinct1 = makeInstinct({ id: "x1", trigger: "run tests before commit", domain: "testing" });
    const instinct2 = makeInstinct({ id: "x2", trigger: "run tests after changes", domain: "testing" });
    const suggestions = findMergeCandidates([instinct1, instinct2]);
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("Merge Candidates");
  });

  it("includes recommendation and keepId in merge output", () => {
    const instinct1 = makeInstinct({ id: "x1", trigger: "run tests before commit", confidence: 0.9, domain: "testing" });
    const instinct2 = makeInstinct({ id: "x2", trigger: "run tests after changes", confidence: 0.5, domain: "testing" });
    const suggestions = findMergeCandidates([instinct1, instinct2]);
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("Recommendation:");
    expect(output).toContain("keep: x1");
  });

  it("includes command section header when command suggestions exist", () => {
    const instinct = makeInstinct({ trigger: "always run linting", domain: "style" });
    const suggestions = findCommandCandidates([instinct]);
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("Potential Slash Commands");
  });

  it("includes promotion section header when promotion suggestions exist", () => {
    const instinct = makeInstinct({
      scope: "project",
      confidence: PROMOTION_CONFIDENCE_THRESHOLD,
    });
    const suggestions = findPromotionCandidates([instinct], new Set());
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("Promotion Candidates");
  });

  it("includes total count and informational note", () => {
    const instinct = makeInstinct({ trigger: "always run linting", domain: "style" });
    const suggestions = findCommandCandidates([instinct]);
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("informational only");
    expect(output).toMatch(/Total: \d+ suggestion/);
  });

  it("uses singular 'suggestion' for count of 1", () => {
    const instinct = makeInstinct({ trigger: "always run linting", domain: "style" });
    const suggestions = findCommandCandidates([instinct]);
    expect(suggestions).toHaveLength(1);
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("1 suggestion (");
  });
});

// ---------------------------------------------------------------------------
// loadInstinctsForEvolve (I/O)
// ---------------------------------------------------------------------------

describe("loadInstinctsForEvolve", () => {
  it("returns empty arrays when no instincts on disk", () => {
    const project = {
      id: "proj-001",
      name: "test-project",
      root: tmpDir,
      remote: "https://github.com/test/repo",
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen: "2026-01-01T00:00:00.000Z",
    };
    ensureStorageLayout(project, tmpDir);
    const result = loadInstinctsForEvolve("proj-001", tmpDir);
    expect(result.projectInstincts).toHaveLength(0);
    expect(result.globalInstincts).toHaveLength(0);
  });

  it("loads project instincts when projectId provided", () => {
    const project = {
      id: "proj-002",
      name: "test-project",
      root: tmpDir,
      remote: "https://github.com/test/repo2",
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen: "2026-01-01T00:00:00.000Z",
    };
    ensureStorageLayout(project, tmpDir);

    const instinct = makeInstinct({ id: "my-instinct", scope: "project", project_id: "proj-002" });
    const dir = join(tmpDir, "projects/proj-002/instincts/personal");
    saveInstinct(instinct, dir);

    const result = loadInstinctsForEvolve("proj-002", tmpDir);
    expect(result.projectInstincts).toHaveLength(1);
    expect(result.projectInstincts[0]!.id).toBe("my-instinct");
  });

  it("returns empty project instincts when projectId is null", () => {
    const result = loadInstinctsForEvolve(null, tmpDir);
    expect(result.projectInstincts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// handleInstinctEvolve
// ---------------------------------------------------------------------------

describe("handleInstinctEvolve", () => {
  it("calls ctx.ui.notify with formatted output", async () => {
    const ctx = mockCtx();
    await handleInstinctEvolve("", ctx, null, tmpDir);
    expect(ctx.ui.notify).toHaveBeenCalledOnce();
    const [message, level] = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
    expect(level).toBe("info");
  });

  it("shows no-suggestion message when no instincts exist", async () => {
    const ctx = mockCtx();
    await handleInstinctEvolve("", ctx, null, tmpDir);
    const message = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(message).toContain("No evolution suggestions");
  });
});
