import { describe, it, expect } from "vitest";
import {
  parseChanges,
  buildInstinctFromChange,
  formatInstinctsForPrompt,
  formatInstinctsCompact,
  estimateTokens,
} from "./analyze-single-shot.js";
import type { InstinctChange } from "./analyze-single-shot.js";
import type { Instinct } from "../types.js";

const existingInstinct: Instinct = {
  id: "read-before-edit",
  title: "Read files before editing",
  trigger: "Before making edits to an existing file",
  action: "Read the file first to understand context and patterns",
  confidence: 0.8,
  domain: "workflow",
  scope: "global",
  source: "personal",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  observation_count: 5,
  confirmed_count: 2,
  contradicted_count: 0,
  inactive_count: 1,
};

describe("parseChanges", () => {
  it("parses a valid JSON string with a create change", () => {
    const json = JSON.stringify({
      changes: [
        {
          action: "create",
          instinct: {
            id: "new-instinct",
            title: "New instinct",
            trigger: "When X",
            action: "Do Y",
            confidence: 0.5,
            domain: "typescript",
            scope: "project",
            observation_count: 3,
            confirmed_count: 0,
            contradicted_count: 0,
            inactive_count: 0,
          },
        },
      ],
    });
    const result = parseChanges(json);
    expect(result).toHaveLength(1);
    expect(result[0]?.action).toBe("create");
  });

  it("returns empty array for { changes: [] }", () => {
    const result = parseChanges(JSON.stringify({ changes: [] }));
    expect(result).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseChanges("not json")).toThrow(/invalid JSON/i);
  });

  it("throws if changes is not an array", () => {
    expect(() => parseChanges(JSON.stringify({ changes: "bad" }))).toThrow(/changes.*array/i);
  });

  it("strips ```json fences before parsing", () => {
    const json = "```json\n" + JSON.stringify({ changes: [] }) + "\n```";
    expect(parseChanges(json)).toEqual([]);
  });

  it("strips plain ``` fences before parsing", () => {
    const json = "```\n" + JSON.stringify({ changes: [] }) + "\n```";
    expect(parseChanges(json)).toEqual([]);
  });
});

describe("buildInstinctFromChange", () => {
  it("builds a new instinct from a create change", () => {
    const change: InstinctChange = {
      action: "create",
      instinct: {
        id: "new-one",
        title: "Title",
        trigger: "When something happens",
        action: "Do something",
        confidence: 0.5,
        domain: "typescript",
        scope: "project",
        observation_count: 3,
        confirmed_count: 0,
        contradicted_count: 0,
        inactive_count: 0,
      },
    };
    const result = buildInstinctFromChange(change, null, "proj-1");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("new-one");
    expect(result?.source).toBe("personal");
    expect(result?.created_at).toBeDefined();
    expect(result?.project_id).toBe("proj-1");
    expect(result?.scope).toBe("project");
  });

  it("sets project_id to undefined for global scope instincts", () => {
    const change: InstinctChange = {
      action: "create",
      instinct: {
        id: "global-one",
        title: "Global",
        trigger: "When working on any project globally",
        action: "Do this action globally across all projects",
        confidence: 0.5,
        domain: "workflow",
        scope: "global",
        observation_count: 3,
        confirmed_count: 0,
        contradicted_count: 0,
        inactive_count: 0,
      },
    };
    const result = buildInstinctFromChange(change, null, "proj-1");
    expect(result?.project_id).toBeUndefined();
  });

  it("clamps confidence to [0.1, 0.9]", () => {
    const change: InstinctChange = {
      action: "create",
      instinct: {
        id: "clamped",
        title: "T",
        trigger: "When confidence needs clamping in tests",
        action: "Clamp the confidence value to valid range",
        confidence: 1.5,
        domain: "workflow",
        scope: "project",
        observation_count: 1,
        confirmed_count: 0,
        contradicted_count: 0,
        inactive_count: 0,
      },
    };
    expect(buildInstinctFromChange(change, null, "p")?.confidence).toBe(0.9);

    change.instinct!.confidence = -0.5;
    expect(buildInstinctFromChange(change, null, "p")?.confidence).toBe(0.1);
  });

  it("merges an update change into an existing instinct, preserving created_at", () => {
    const change: InstinctChange = {
      action: "update",
      instinct: {
        id: "read-before-edit",
        title: "Read files before editing",
        trigger: "Before editing any existing file in the project",
        action: "Read the complete file first to understand context",
        confidence: 0.85,
        domain: "workflow",
        scope: "global",
        observation_count: 6,
        confirmed_count: 3,
        contradicted_count: 0,
        inactive_count: 1,
      },
    };
    const result = buildInstinctFromChange(change, existingInstinct, "proj-1");
    expect(result?.confidence).toBe(0.85);
    expect(result?.observation_count).toBe(6);
    expect(result?.created_at).toBe(existingInstinct.created_at);
    expect(result?.updated_at).not.toBe(existingInstinct.updated_at);
  });

  it("returns null for delete action", () => {
    const change: InstinctChange = { action: "delete", id: "some-id" };
    expect(buildInstinctFromChange(change, null, "proj-1")).toBeNull();
  });

  it("returns null for create with missing instinct field", () => {
    const change: InstinctChange = { action: "create" };
    expect(buildInstinctFromChange(change, null, "proj-1")).toBeNull();
  });

  it("returns null when action is the literal string 'undefined'", () => {
    const change: InstinctChange = {
      action: "create",
      instinct: {
        id: "bad-action",
        title: "Bad",
        trigger: "When something happens in the project",
        action: "undefined",
        confidence: 0.5,
        domain: "workflow",
        scope: "project",
        observation_count: 1,
        confirmed_count: 0,
        contradicted_count: 0,
        inactive_count: 0,
      },
    };
    expect(buildInstinctFromChange(change, null, "proj-1")).toBeNull();
  });

  it("returns null when trigger is too short", () => {
    const change: InstinctChange = {
      action: "create",
      instinct: {
        id: "bad-trigger",
        title: "Bad",
        trigger: "When X",
        action: "Do something meaningful with the codebase",
        confidence: 0.5,
        domain: "workflow",
        scope: "project",
        observation_count: 1,
        confirmed_count: 0,
        contradicted_count: 0,
        inactive_count: 0,
      },
    };
    expect(buildInstinctFromChange(change, null, "proj-1")).toBeNull();
  });

  it("returns null when action is empty string", () => {
    const change: InstinctChange = {
      action: "create",
      instinct: {
        id: "empty-action",
        title: "Empty",
        trigger: "When something happens in the project",
        action: "",
        confidence: 0.5,
        domain: "workflow",
        scope: "project",
        observation_count: 1,
        confirmed_count: 0,
        contradicted_count: 0,
        inactive_count: 0,
      },
    };
    expect(buildInstinctFromChange(change, null, "proj-1")).toBeNull();
  });
});

describe("formatInstinctsForPrompt", () => {
  it("returns placeholder when no instincts", () => {
    expect(formatInstinctsForPrompt([])).toContain("no existing instincts");
  });

  it("includes instinct id in output", () => {
    const result = formatInstinctsForPrompt([existingInstinct]);
    expect(result).toContain("read-before-edit");
  });

  it("separates multiple instincts with ---", () => {
    const result = formatInstinctsForPrompt([existingInstinct, existingInstinct]);
    expect(result).toContain("---");
  });
});

describe("formatInstinctsCompact", () => {
  it("returns empty JSON array when no instincts", () => {
    expect(formatInstinctsCompact([])).toBe("[]");
  });

  it("includes required fields for each instinct", () => {
    const result = formatInstinctsCompact([existingInstinct]);
    const parsed = JSON.parse(result) as unknown[];
    expect(parsed).toHaveLength(1);
    const entry = parsed[0] as Record<string, unknown>;
    expect(entry["id"]).toBe("read-before-edit");
    expect(entry["trigger"]).toBeDefined();
    expect(entry["action"]).toBeDefined();
    expect(entry["confidence"]).toBe(0.8);
    expect(entry["domain"]).toBe("workflow");
    expect(entry["scope"]).toBe("global");
    expect(entry["confirmed"]).toBe(2);
    expect(entry["contradicted"]).toBe(0);
    expect(entry["inactive"]).toBe(1);
    expect(typeof entry["age_days"]).toBe("number");
  });

  it("is significantly shorter than formatInstinctsForPrompt for large inputs", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...existingInstinct,
      id: `instinct-${i}`,
    }));
    const compact = formatInstinctsCompact(many);
    const full = formatInstinctsForPrompt(many);
    expect(compact.length).toBeLessThan(full.length);
  });

  it("produces valid JSON parseable output", () => {
    const result = formatInstinctsCompact([existingInstinct, existingInstinct]);
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toHaveLength(2);
  });

  it("does not include full YAML frontmatter", () => {
    const result = formatInstinctsCompact([existingInstinct]);
    expect(result).not.toContain("---");
    expect(result).not.toContain("observation_count:");
  });
});

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates 1 token for 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("rounds up for partial chunks", () => {
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("scales linearly with text length", () => {
    const text = "a".repeat(400);
    expect(estimateTokens(text)).toBe(100);
  });
});
