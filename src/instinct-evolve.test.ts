import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Instinct } from "./types.js";
import {
  COMMAND_NAME,
  MERGE_SIMILARITY_THRESHOLD,
  ACTION_SIMILARITY_THRESHOLD,
  PROMOTION_CONFIDENCE_THRESHOLD,
  AGENTS_MD_OVERLAP_THRESHOLD,
  AGENTS_MD_PROJECT_ADDITION_THRESHOLD,
  AGENTS_MD_GLOBAL_ADDITION_THRESHOLD,
  COMMAND_TRIGGER_KEYWORDS,
  tokenizeText,
  triggerSimilarity,
  actionSimilarity,
  findMergeCandidates,
  findCommandCandidates,
  findPromotionCandidates,
  findAgentsMdOverlaps,
  findAgentsMdAdditions,
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

  it("AGENTS_MD_OVERLAP_THRESHOLD is 0.6", () => {
    expect(AGENTS_MD_OVERLAP_THRESHOLD).toBe(0.6);
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
// findAgentsMdOverlaps
// ---------------------------------------------------------------------------

// Fixture AGENTS.md content used across tests
const AGENTS_MD_FIXTURE = `# Project Guidelines

Always run tests before committing any code changes.
Use strict TypeScript with no implicit any.
Keep functions under fifty lines for readability.
`;

describe("findAgentsMdOverlaps", () => {
  it("returns empty array when agentsMdText is empty", () => {
    const instincts = [makeInstinct({ trigger: "run tests before commit", action: "execute test suite" })];
    expect(findAgentsMdOverlaps(instincts, "")).toHaveLength(0);
  });

  it("returns empty array when no instincts provided", () => {
    expect(findAgentsMdOverlaps([], AGENTS_MD_FIXTURE)).toHaveLength(0);
  });

  it("flags instinct with high token overlap (above threshold)", () => {
    // trigger+action tokens: run, tests, before, code, changes = 5 tokens
    // AGENTS_MD_FIXTURE contains: run, tests, before, code, changes = all 5 match
    // ratio: 5/5 = 1.0 >= 0.6
    const instinct = makeInstinct({
      trigger: "run tests before code changes",
      action: "",
    });
    const result = findAgentsMdOverlaps([instinct], AGENTS_MD_FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("agents-md-overlap");
    expect(result[0]!.instinct.id).toBe(instinct.id);
  });

  it("does NOT flag instinct with low token overlap (below threshold)", () => {
    // These tokens don't appear in AGENTS_MD_FIXTURE
    const instinct = makeInstinct({
      trigger: "format python source files",
      action: "use black reformatter",
    });
    const result = findAgentsMdOverlaps([instinct], AGENTS_MD_FIXTURE);
    expect(result).toHaveLength(0);
  });

  it("flags instinct at exactly the threshold (3/5 = 0.6)", () => {
    // AGENTS_MD_FIXTURE tokens include: run, tests, before
    // trigger: "run tests before deploy staging" = run, tests, before, deploy, staging (5 tokens)
    // matching: run, tests, before = 3 tokens; ratio = 3/5 = 0.6 (at threshold)
    const instinct = makeInstinct({
      trigger: "run tests before deploy staging",
      action: "",
    });
    const result = findAgentsMdOverlaps([instinct], AGENTS_MD_FIXTURE);
    expect(result).toHaveLength(1);
  });

  it("does NOT flag instinct just below threshold (3/6 = 0.5)", () => {
    // trigger: "run tests before deploy staging failed" = 6 tokens, 3 match (0.5 < 0.6)
    const instinct = makeInstinct({
      trigger: "run tests before deploy staging failed",
      action: "",
    });
    const result = findAgentsMdOverlaps([instinct], AGENTS_MD_FIXTURE);
    expect(result).toHaveLength(0);
  });

  it("matchingExcerpt is at most 100 chars", () => {
    const instinct = makeInstinct({
      trigger: "run tests before code changes",
      action: "",
    });
    const result = findAgentsMdOverlaps([instinct], AGENTS_MD_FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0]!.matchingExcerpt.length).toBeLessThanOrEqual(100);
  });

  it("matchingExcerpt is a non-empty string when overlap found", () => {
    const instinct = makeInstinct({
      trigger: "run tests before code changes",
      action: "",
    });
    const result = findAgentsMdOverlaps([instinct], AGENTS_MD_FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0]!.matchingExcerpt.length).toBeGreaterThan(0);
  });

  it("handles multiple instincts - only flags those above threshold", () => {
    const overlapping = makeInstinct({
      trigger: "run tests before code changes",
      action: "",
    });
    const notOverlapping = makeInstinct({
      trigger: "format python source files",
      action: "use black reformatter",
    });
    const result = findAgentsMdOverlaps([overlapping, notOverlapping], AGENTS_MD_FIXTURE);
    expect(result).toHaveLength(1);
    expect(result[0]!.instinct.id).toBe(overlapping.id);
  });

  it("uses both trigger and action tokens for overlap calculation", () => {
    // trigger alone: "deploy build artifact" (deploy, build, artifact) - 0 match
    // trigger+action: "deploy build artifact" + "run tests before" - 3/6 match = 0.5 < 0.6
    // action alone contributing: run, tests, before
    // Combined: deploy, build, artifact, run, tests, before = 6 tokens, 3 match = 0.5 < 0.6
    const instinct = makeInstinct({
      trigger: "deploy build artifact",
      action: "run tests before",
    });
    const result = findAgentsMdOverlaps([instinct], AGENTS_MD_FIXTURE);
    // 3/6 = 0.5 < 0.6 threshold - not flagged
    expect(result).toHaveLength(0);
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

  it("accepts projectRoot param without error when null", async () => {
    const ctx = mockCtx();
    await handleInstinctEvolve("", ctx, null, tmpDir, null);
    expect(ctx.ui.notify).toHaveBeenCalledOnce();
  });

  it("accepts projectRoot param without error when pointing to non-existent dir", async () => {
    const ctx = mockCtx();
    await handleInstinctEvolve("", ctx, null, tmpDir, "/does/not/exist");
    expect(ctx.ui.notify).toHaveBeenCalledOnce();
  });

  it("includes Duplicates AGENTS.md section when projectRoot has matching AGENTS.md", async () => {
    // Write a minimal AGENTS.md in tmpDir
    const agentsMdPath = join(tmpDir, "AGENTS.md");
    writeFileSync(agentsMdPath, "Always run tests before committing code changes.", "utf-8");

    const project = {
      id: "proj-overlap",
      name: "overlap-project",
      root: tmpDir,
      remote: "https://github.com/test/overlap",
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen: "2026-01-01T00:00:00.000Z",
    };
    ensureStorageLayout(project, tmpDir);

    // Save an instinct whose tokens heavily overlap with the AGENTS.md content
    const overlappingInstinct = makeInstinct({
      id: "overlap-instinct",
      scope: "project",
      project_id: "proj-overlap",
      trigger: "run tests before committing",
      action: "always check code changes",
    });
    const dir = join(tmpDir, "projects/proj-overlap/instincts/personal");
    saveInstinct(overlappingInstinct, dir);

    const ctx = mockCtx();
    await handleInstinctEvolve("", ctx, "proj-overlap", tmpDir, tmpDir);
    const message = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(message).toContain("Duplicates AGENTS.md");
  });
});

// ---------------------------------------------------------------------------
// generateEvolveSuggestions with agentsMd params
// ---------------------------------------------------------------------------

describe("generateEvolveSuggestions with agentsMd", () => {
  it("includes overlap suggestions when agentsMdProject is provided", () => {
    const instinct = makeInstinct({
      id: "ol1",
      trigger: "run tests before code changes",
      action: "",
      scope: "project",
    });
    const result = generateEvolveSuggestions([instinct], [], AGENTS_MD_FIXTURE, null);
    const overlaps = result.filter((s) => s.type === "agents-md-overlap");
    expect(overlaps.length).toBeGreaterThanOrEqual(1);
  });

  it("includes overlap suggestions when agentsMdGlobal is provided", () => {
    const instinct = makeInstinct({
      id: "ol2",
      trigger: "run tests before code changes",
      action: "",
      scope: "global",
    });
    const result = generateEvolveSuggestions([], [instinct], null, AGENTS_MD_FIXTURE);
    const overlaps = result.filter((s) => s.type === "agents-md-overlap");
    expect(overlaps.length).toBeGreaterThanOrEqual(1);
  });

  it("returns no overlap suggestions when both agentsMd params are null", () => {
    const instinct = makeInstinct({
      id: "ol3",
      trigger: "run tests before code changes",
      action: "",
    });
    const result = generateEvolveSuggestions([instinct], [], null, null);
    const overlaps = result.filter((s) => s.type === "agents-md-overlap");
    expect(overlaps).toHaveLength(0);
  });

  it("returns no overlap suggestions when both agentsMd params are omitted", () => {
    const instinct = makeInstinct({
      id: "ol4",
      trigger: "run tests before code changes",
      action: "",
    });
    const result = generateEvolveSuggestions([instinct], []);
    const overlaps = result.filter((s) => s.type === "agents-md-overlap");
    expect(overlaps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatEvolveSuggestions - Duplicates AGENTS.md section
// ---------------------------------------------------------------------------

describe("formatEvolveSuggestions - agents-md-overlap section", () => {
  it("includes Duplicates AGENTS.md section when overlap suggestions exist", () => {
    const instinct = makeInstinct({ id: "ov1", trigger: "run tests", action: "check code" });
    const suggestions = [{
      type: "agents-md-overlap" as const,
      instinct,
      matchingExcerpt: "Always run tests before committing code changes",
    }];
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("Duplicates AGENTS.md");
  });

  it("shows instinct id, confidence, and excerpt in overlap section", () => {
    const instinct = makeInstinct({ id: "ov2", trigger: "run tests", action: "check code", confidence: 0.75 });
    const suggestions = [{
      type: "agents-md-overlap" as const,
      instinct,
      matchingExcerpt: "Always run tests before committing",
    }];
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("ov2");
    expect(output).toContain("0.75");
    expect(output).toContain("Always run tests before committing");
  });

  it("omits Duplicates AGENTS.md section when no overlap suggestions", () => {
    const instinct = makeInstinct({ trigger: "always run linting", domain: "style" });
    const suggestions = findCommandCandidates([instinct]);
    const output = formatEvolveSuggestions(suggestions);
    expect(output).not.toContain("Duplicates AGENTS.md");
  });
});

// ---------------------------------------------------------------------------
// findAgentsMdAdditions
// ---------------------------------------------------------------------------

describe("findAgentsMdAdditions", () => {
  it("returns project-scoped instincts at exactly the project threshold", () => {
    const instinct = makeInstinct({
      scope: "project",
      confidence: AGENTS_MD_PROJECT_ADDITION_THRESHOLD,
    });
    const result = findAgentsMdAdditions([instinct], new Set(), "project");
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("agents-md-addition");
    expect(result[0]!.scope).toBe("project");
    expect(result[0]!.instinct.id).toBe(instinct.id);
  });

  it("excludes project instincts below project threshold", () => {
    const instinct = makeInstinct({
      scope: "project",
      confidence: AGENTS_MD_PROJECT_ADDITION_THRESHOLD - 0.01,
    });
    const result = findAgentsMdAdditions([instinct], new Set(), "project");
    expect(result).toHaveLength(0);
  });

  it("returns global-scoped instincts at exactly the global threshold", () => {
    const instinct = makeInstinct({
      scope: "global",
      confidence: AGENTS_MD_GLOBAL_ADDITION_THRESHOLD,
    });
    const result = findAgentsMdAdditions([instinct], new Set(), "global");
    expect(result).toHaveLength(1);
    expect(result[0]!.scope).toBe("global");
  });

  it("excludes global instincts below global threshold", () => {
    const instinct = makeInstinct({
      scope: "global",
      confidence: AGENTS_MD_GLOBAL_ADDITION_THRESHOLD - 0.01,
    });
    const result = findAgentsMdAdditions([instinct], new Set(), "global");
    expect(result).toHaveLength(0);
  });

  it("excludes instincts already in overlapIds", () => {
    const instinct = makeInstinct({
      scope: "project",
      confidence: 0.9,
    });
    const result = findAgentsMdAdditions([instinct], new Set([instinct.id]), "project");
    expect(result).toHaveLength(0);
  });

  it("excludes instincts with wrong scope", () => {
    const instinct = makeInstinct({ scope: "global", confidence: 0.9 });
    const result = findAgentsMdAdditions([instinct], new Set(), "project");
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no instincts qualify", () => {
    const result = findAgentsMdAdditions([], new Set(), "project");
    expect(result).toHaveLength(0);
  });

  it("proposedBullet is a non-empty string derived from trigger and action", () => {
    const instinct = makeInstinct({
      scope: "project",
      confidence: 0.8,
      trigger: "when reviewing PRs",
      action: "check for security issues",
    });
    const result = findAgentsMdAdditions([instinct], new Set(), "project");
    expect(result[0]!.proposedBullet).toBeTruthy();
    expect(typeof result[0]!.proposedBullet).toBe("string");
  });

  it("handles multiple instincts, returning only qualifying ones", () => {
    const passing = makeInstinct({ scope: "project", confidence: 0.8 });
    const failing = makeInstinct({ scope: "project", confidence: 0.5 });
    const result = findAgentsMdAdditions([passing, failing], new Set(), "project");
    expect(result).toHaveLength(1);
    expect(result[0]!.instinct.id).toBe(passing.id);
  });
});

// ---------------------------------------------------------------------------
// generateEvolveSuggestions - agents-md-addition integration
// ---------------------------------------------------------------------------

describe("generateEvolveSuggestions with agents-md-addition", () => {
  it("includes project addition suggestions for high-confidence project instincts", () => {
    const instinct = makeInstinct({
      scope: "project",
      confidence: 0.8,
      trigger: "validate input parameters",
      action: "use schema-based validation at boundaries",
    });
    const result = generateEvolveSuggestions([instinct], []);
    const additions = result.filter((s) => s.type === "agents-md-addition");
    expect(additions.length).toBeGreaterThanOrEqual(1);
  });

  it("includes global addition suggestions for high-confidence global instincts", () => {
    const instinct = makeInstinct({
      scope: "global",
      confidence: 0.85,
      trigger: "when writing TypeScript",
      action: "enable strict mode in tsconfig",
    });
    const result = generateEvolveSuggestions([], [instinct]);
    const additions = result.filter(
      (s) => s.type === "agents-md-addition" && (s as { scope: string }).scope === "global"
    );
    expect(additions.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes overlap instincts from addition suggestions", () => {
    const instinct = makeInstinct({
      id: "shared-overlap",
      scope: "project",
      confidence: 0.9,
      trigger: "run tests before committing code changes",
      action: "always check code changes",
    });
    const result = generateEvolveSuggestions([instinct], [], AGENTS_MD_FIXTURE, null);
    const additions = result.filter(
      (s) => s.type === "agents-md-addition" && s.instinct.id === "shared-overlap"
    );
    expect(additions).toHaveLength(0);
  });

  it("returns no addition suggestions when all instincts are below threshold", () => {
    const instinct = makeInstinct({ scope: "project", confidence: 0.5 });
    const result = generateEvolveSuggestions([instinct], []);
    const additions = result.filter((s) => s.type === "agents-md-addition");
    expect(additions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatEvolveSuggestions - agents-md-addition sections
// ---------------------------------------------------------------------------

describe("formatEvolveSuggestions - agents-md-addition sections", () => {
  it("renders Suggested Project AGENTS.md Additions section", () => {
    const instinct = makeInstinct({ id: "add-proj", scope: "project", confidence: 0.8 });
    const suggestions = [
      {
        type: "agents-md-addition" as const,
        instinct,
        proposedBullet: "When testing, run tests before committing.",
        scope: "project" as const,
      },
    ];
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("Suggested Project AGENTS.md Additions");
    expect(output).toContain("add-proj");
    expect(output).toContain("0.80");
    expect(output).toContain("When testing, run tests before committing.");
    expect(output).toContain("manually");
  });

  it("renders Suggested Global AGENTS.md Additions section", () => {
    const instinct = makeInstinct({ id: "add-glob", scope: "global", confidence: 0.85 });
    const suggestions = [
      {
        type: "agents-md-addition" as const,
        instinct,
        proposedBullet: "When using TypeScript, enable strict mode.",
        scope: "global" as const,
      },
    ];
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("Suggested Global AGENTS.md Additions");
    expect(output).toContain("add-glob");
    expect(output).toContain("0.85");
    expect(output).toContain("When using TypeScript, enable strict mode.");
    expect(output).toContain("manually");
  });

  it("omits Project section when no project additions", () => {
    const instinct = makeInstinct({ id: "add-glob2", scope: "global", confidence: 0.85 });
    const suggestions = [
      {
        type: "agents-md-addition" as const,
        instinct,
        proposedBullet: "When deploying, run full test suite.",
        scope: "global" as const,
      },
    ];
    const output = formatEvolveSuggestions(suggestions);
    expect(output).not.toContain("Suggested Project AGENTS.md Additions");
    expect(output).toContain("Suggested Global AGENTS.md Additions");
  });

  it("omits Global section when no global additions", () => {
    const instinct = makeInstinct({ id: "add-proj2", scope: "project", confidence: 0.8 });
    const suggestions = [
      {
        type: "agents-md-addition" as const,
        instinct,
        proposedBullet: "When writing code, add tests.",
        scope: "project" as const,
      },
    ];
    const output = formatEvolveSuggestions(suggestions);
    expect(output).toContain("Suggested Project AGENTS.md Additions");
    expect(output).not.toContain("Suggested Global AGENTS.md Additions");
  });

  it("omits both sections when no addition suggestions", () => {
    const instinct = makeInstinct({ trigger: "always run linting", domain: "style" });
    const suggestions = findCommandCandidates([instinct]);
    const output = formatEvolveSuggestions(suggestions);
    expect(output).not.toContain("Suggested Project AGENTS.md Additions");
    expect(output).not.toContain("Suggested Global AGENTS.md Additions");
  });
});
