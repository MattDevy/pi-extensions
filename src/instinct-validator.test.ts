import { describe, it, expect } from "vitest";
import {
  validateInstinct,
  tokenize,
  jaccardSimilarity,
  findSimilarInstinct,
  KNOWN_DOMAINS,
  KNOWN_VERBS,
} from "./instinct-validator.js";
import type { Instinct } from "./types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeInstinct(override: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test Instinct",
    trigger: "When writing tests for a new module",
    action: "Use vitest and place test files alongside source as *.test.ts",
    confidence: 0.7,
    domain: "testing",
    source: "personal",
    scope: "project",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 2,
    contradicted_count: 0,
    inactive_count: 1,
    ...override,
  };
}

const validFields = {
  action: "Read the file before making any edits to understand context",
  trigger: "Before making edits to an existing file",
};

// ---------------------------------------------------------------------------
// validateInstinct - basic field checks
// ---------------------------------------------------------------------------

describe("validateInstinct", () => {
  it("accepts valid action and trigger", () => {
    expect(validateInstinct(validFields)).toMatchObject({ valid: true });
  });

  describe("rejects invalid action", () => {
    it("rejects undefined action", () => {
      const result = validateInstinct({ ...validFields, action: undefined });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
      expect(result.reason).toContain("undefined");
    });

    it("rejects null action", () => {
      const result = validateInstinct({ ...validFields, action: null });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
    });

    it("rejects empty string action", () => {
      const result = validateInstinct({ ...validFields, action: "" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
    });

    it("rejects literal 'undefined' string", () => {
      const result = validateInstinct({ ...validFields, action: "undefined" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
      expect(result.reason).toContain("undefined");
    });

    it("rejects literal 'null' string", () => {
      const result = validateInstinct({ ...validFields, action: "null" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("action");
    });

    it("rejects literal 'none' string (case-insensitive)", () => {
      const result = validateInstinct({ ...validFields, action: "None" });
      expect(result.valid).toBe(false);
    });

    it("rejects action shorter than 10 characters", () => {
      const result = validateInstinct({ ...validFields, action: "Do stuff" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("too short");
    });

    it("rejects whitespace-only action", () => {
      const result = validateInstinct({ ...validFields, action: "   " });
      expect(result.valid).toBe(false);
    });

    it("rejects non-string action", () => {
      const result = validateInstinct({ ...validFields, action: 42 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not a string");
    });
  });

  describe("rejects invalid trigger", () => {
    it("rejects undefined trigger", () => {
      const result = validateInstinct({ ...validFields, trigger: undefined });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("trigger");
    });

    it("rejects literal 'undefined' trigger", () => {
      const result = validateInstinct({ ...validFields, trigger: "undefined" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("trigger");
    });

    it("rejects trigger shorter than 10 characters", () => {
      const result = validateInstinct({ ...validFields, trigger: "When X" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("too short");
    });
  });

  it("checks action before trigger (action error takes priority)", () => {
    const result = validateInstinct({
      action: "undefined",
      trigger: "undefined",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("action");
  });

  // ---------------------------------------------------------------------------
  // Domain validation
  // ---------------------------------------------------------------------------

  describe("domain validation", () => {
    it("accepts known domain", () => {
      const result = validateInstinct({ ...validFields, domain: "typescript" });
      expect(result.valid).toBe(true);
    });

    it("accepts 'other' as escape hatch", () => {
      const result = validateInstinct({ ...validFields, domain: "other" });
      expect(result.valid).toBe(true);
    });

    it("accepts all domains in KNOWN_DOMAINS", () => {
      for (const domain of KNOWN_DOMAINS) {
        const result = validateInstinct({ ...validFields, domain });
        expect(result.valid).toBe(true);
      }
    });

    it("rejects unknown domain", () => {
      const result = validateInstinct({ ...validFields, domain: "unicorns" });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("unicorns");
      expect(result.reason).toContain("known set");
    });

    it("is case-insensitive for domain matching", () => {
      const result = validateInstinct({ ...validFields, domain: "TypeScript" });
      expect(result.valid).toBe(true);
    });

    it("skips domain check when domain is not provided", () => {
      const result = validateInstinct({ ...validFields });
      expect(result.valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Verb heuristic (warning, not rejection)
  // ---------------------------------------------------------------------------

  describe("verb heuristic", () => {
    it("issues no warning when action starts with a known verb", () => {
      const result = validateInstinct({
        ...validFields,
        action: "Use vitest for all new test files in this project",
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toBeUndefined();
    });

    it("includes a warning when action does not start with a known verb", () => {
      const result = validateInstinct({
        ...validFields,
        action: "File-based testing is the convention in this project",
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toContain("imperative verb");
    });

    it("does not reject the instinct for a missing verb", () => {
      const result = validateInstinct({
        ...validFields,
        action: "Tests should always be placed alongside source files here",
      });
      expect(result.valid).toBe(true);
    });

    it("includes the unrecognised first word in the warning", () => {
      const result = validateInstinct({
        ...validFields,
        action: "Sometimes the agent should double-check its own output",
      });
      expect(result.valid).toBe(true);
      expect(result.warnings![0]).toContain("sometimes");
    });

    it("all KNOWN_VERBS produce no warning", () => {
      for (const verb of KNOWN_VERBS) {
        const action = `${verb.charAt(0).toUpperCase() + verb.slice(1)} the thing when starting work on the task`;
        const result = validateInstinct({ ...validFields, action });
        expect(result.warnings).toBeUndefined();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("returns lowercase tokens", () => {
    const tokens = tokenize("Read THE File");
    expect(tokens.has("read")).toBe(true);
    expect(tokens.has("file")).toBe(true);
  });

  it("filters stop words", () => {
    const tokens = tokenize("read the file and edit it");
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("it")).toBe(false);
    expect(tokens.has("and")).toBe(false);
    expect(tokens.has("read")).toBe(true);
    expect(tokens.has("file")).toBe(true);
    expect(tokens.has("edit")).toBe(true);
  });

  it("filters short tokens (length <= 2)", () => {
    const tokens = tokenize("do it in a new way");
    expect(tokens.has("do")).toBe(false);
    expect(tokens.has("in")).toBe(false);
    expect(tokens.has("a")).toBe(false);
  });

  it("splits on non-alphanumeric characters", () => {
    const tokens = tokenize("read-before-edit: always check first");
    expect(tokens.has("read")).toBe(true);
    expect(tokens.has("before")).toBe(true); // not a stop word - meaningful token
    expect(tokens.has("edit")).toBe(true);
    expect(tokens.has("always")).toBe(true);
    expect(tokens.has("check")).toBe(true);
    expect(tokens.has("first")).toBe(true);
  });

  it("returns a set (deduplicates)", () => {
    const tokens = tokenize("read read read the file file");
    expect(tokens.size).toBe(2); // "read", "file"
  });

  it("returns empty set for stop-word-only text", () => {
    const tokens = tokenize("a the is of");
    expect(tokens.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// jaccardSimilarity
// ---------------------------------------------------------------------------

describe("jaccardSimilarity", () => {
  it("returns 1.0 for identical sets", () => {
    const s = new Set(["read", "file", "edit"]);
    expect(jaccardSimilarity(s, s)).toBe(1.0);
  });

  it("returns 0.0 for completely disjoint sets", () => {
    const a = new Set(["read", "file"]);
    const b = new Set(["write", "document"]);
    expect(jaccardSimilarity(a, b)).toBe(0.0);
  });

  it("returns 1.0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1.0);
  });

  it("returns 0.0 when one set is empty", () => {
    expect(jaccardSimilarity(new Set(["read"]), new Set())).toBe(0.0);
    expect(jaccardSimilarity(new Set(), new Set(["read"]))).toBe(0.0);
  });

  it("returns partial overlap correctly", () => {
    const a = new Set(["read", "file", "edit"]);
    const b = new Set(["read", "file", "write"]);
    // intersection: {read, file} = 2
    // union: {read, file, edit, write} = 4
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 4, 5);
  });
});

// ---------------------------------------------------------------------------
// findSimilarInstinct
// ---------------------------------------------------------------------------

describe("findSimilarInstinct", () => {
  const readBeforeEdit = makeInstinct({
    id: "read-before-edit",
    trigger: "Before making edits to an existing file",
    action:
      "Read the file content first to understand current state and context before making edits",
  });

  const verifyEditContext = makeInstinct({
    id: "verify-edit-context",
    trigger: "When using the edit tool to modify a file after reading it",
    action:
      "Ensure the oldText in the edit tool matches the exact file content and context",
  });

  const useTdd = makeInstinct({
    id: "use-tdd",
    trigger: "When implementing a new feature or fixing a bug",
    action: "Write the test first before writing implementation code",
  });

  it("returns null when no existing instincts", () => {
    const result = findSimilarInstinct(
      {
        trigger: "When editing a file",
        action: "Read file content before editing",
      },
      [],
    );
    expect(result).toBeNull();
  });

  it("returns null when no instinct exceeds threshold", () => {
    const result = findSimilarInstinct(
      {
        trigger: "When writing Python code",
        action: "Use type hints for all function parameters",
      },
      [readBeforeEdit, verifyEditContext, useTdd],
    );
    expect(result).toBeNull();
  });

  it("detects highly similar instincts above default threshold", () => {
    // This is very similar to readBeforeEdit
    const candidate = {
      trigger: "Before making edits to a file that exists",
      action:
        "Read the file content to understand the current state before editing",
    };
    const result = findSimilarInstinct(candidate, [readBeforeEdit, useTdd]);
    expect(result).not.toBeNull();
    expect(result!.instinct.id).toBe("read-before-edit");
    expect(result!.similarity).toBeGreaterThanOrEqual(0.6);
  });

  it("respects skipId to avoid matching the instinct being updated", () => {
    const candidate = {
      trigger: "Before making edits to a file that exists",
      action:
        "Read the file content to understand the current state before editing",
    };
    // Skip the similar instinct - simulates updating read-before-edit itself
    const result = findSimilarInstinct(
      candidate,
      [readBeforeEdit, useTdd],
      "read-before-edit",
    );
    expect(result).toBeNull();
  });

  it("returns the best (highest similarity) match when multiple qualify", () => {
    const veryClose = makeInstinct({
      id: "read-file-first",
      trigger: "Before making edits to any existing file",
      action:
        "Read the file content first to understand the current state and context",
    });
    const lessSimilar = makeInstinct({
      id: "check-file-exists",
      trigger: "Before editing a file in the project",
      action: "Read the file to confirm it exists and understand the structure",
    });

    const candidate = {
      trigger: "Before making edits to an existing file in the codebase",
      action:
        "Read the file content to understand the current state before making edits",
    };

    const result = findSimilarInstinct(candidate, [veryClose, lessSimilar]);
    expect(result).not.toBeNull();
    // Should return the one with higher similarity
    expect(result!.instinct.id).toBe("read-file-first");
  });

  it("respects custom threshold", () => {
    const candidate = {
      trigger: "Before making edits to a file",
      action: "Read the file content before editing",
    };
    // With very high threshold (0.95), should not match
    const highThreshold = findSimilarInstinct(
      candidate,
      [readBeforeEdit],
      undefined,
      0.95,
    );
    expect(highThreshold).toBeNull();

    // With low threshold (0.3), should match
    const lowThreshold = findSimilarInstinct(
      candidate,
      [readBeforeEdit],
      undefined,
      0.3,
    );
    expect(lowThreshold).not.toBeNull();
  });
});
