import { describe, it, expect } from "vitest";
import { parseInstinct, serializeInstinct } from "./instinct-parser.js";
import type { Instinct } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_CONTENT = `---
id: use-read-tool
title: Use Read Tool for File Inspection
trigger: when examining file contents
confidence: 0.7
domain: tooling
source: personal
scope: project
project_id: abc123def456
project_name: my-project
created_at: 2026-01-01T00:00:00.000Z
updated_at: 2026-01-15T00:00:00.000Z
observation_count: 5
confirmed_count: 2
contradicted_count: 0
inactive_count: 1
evidence:
  - user corrected tool choice from bash cat to read
  - read used successfully 5 times in a row
flagged_for_removal: false
---

Prefer using the Read tool over Bash cat commands when inspecting file contents.`;

const GLOBAL_CONTENT = `---
id: prefer-immutability
title: Prefer Immutable Patterns
trigger: when updating objects or arrays
confidence: 0.5
domain: code-style
source: personal
scope: global
created_at: 2026-01-01T00:00:00.000Z
updated_at: 2026-01-01T00:00:00.000Z
observation_count: 3
confirmed_count: 1
contradicted_count: 0
inactive_count: 0
---

Create new objects and arrays instead of mutating existing ones.`;

const FULL_INSTINCT: Instinct = {
  id: "use-read-tool",
  title: "Use Read Tool for File Inspection",
  trigger: "when examining file contents",
  action:
    "Prefer using the Read tool over Bash cat commands when inspecting file contents.",
  confidence: 0.7,
  domain: "tooling",
  source: "personal",
  scope: "project",
  project_id: "abc123def456",
  project_name: "my-project",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-15T00:00:00.000Z",
  observation_count: 5,
  confirmed_count: 2,
  contradicted_count: 0,
  inactive_count: 1,
  evidence: [
    "user corrected tool choice from bash cat to read",
    "read used successfully 5 times in a row",
  ],
  flagged_for_removal: false,
};

// ---------------------------------------------------------------------------
// parseInstinct
// ---------------------------------------------------------------------------

describe("parseInstinct", () => {
  it("parses a full instinct file with all fields", () => {
    const instinct = parseInstinct(FULL_CONTENT);

    expect(instinct.id).toBe("use-read-tool");
    expect(instinct.title).toBe("Use Read Tool for File Inspection");
    expect(instinct.trigger).toBe("when examining file contents");
    expect(instinct.action).toBe(
      "Prefer using the Read tool over Bash cat commands when inspecting file contents.",
    );
    expect(instinct.confidence).toBe(0.7);
    expect(instinct.domain).toBe("tooling");
    expect(instinct.source).toBe("personal");
    expect(instinct.scope).toBe("project");
    expect(instinct.project_id).toBe("abc123def456");
    expect(instinct.project_name).toBe("my-project");
    expect(instinct.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(instinct.updated_at).toBe("2026-01-15T00:00:00.000Z");
    expect(instinct.observation_count).toBe(5);
    expect(instinct.confirmed_count).toBe(2);
    expect(instinct.contradicted_count).toBe(0);
    expect(instinct.inactive_count).toBe(1);
    expect(instinct.evidence).toEqual([
      "user corrected tool choice from bash cat to read",
      "read used successfully 5 times in a row",
    ]);
    expect(instinct.flagged_for_removal).toBe(false);
  });

  it("handles missing optional fields gracefully (global instinct)", () => {
    const instinct = parseInstinct(GLOBAL_CONTENT);

    expect(instinct.id).toBe("prefer-immutability");
    expect(instinct.scope).toBe("global");
    expect(instinct.project_id).toBeUndefined();
    expect(instinct.project_name).toBeUndefined();
    expect(instinct.evidence).toBeUndefined();
    expect(instinct.flagged_for_removal).toBeUndefined();
  });

  it("clamps confidence above 0.9 to 0.9", () => {
    const content = FULL_CONTENT.replace("confidence: 0.7", "confidence: 0.99");
    const instinct = parseInstinct(content);
    expect(instinct.confidence).toBe(0.9);
  });

  it("clamps confidence below 0.1 to 0.1", () => {
    const content = FULL_CONTENT.replace("confidence: 0.7", "confidence: 0.01");
    const instinct = parseInstinct(content);
    expect(instinct.confidence).toBe(0.1);
  });

  it("throws on invalid kebab-case id", () => {
    const content = FULL_CONTENT.replace(
      "id: use-read-tool",
      "id: Use_Read_Tool",
    );
    expect(() => parseInstinct(content)).toThrow(/Invalid instinct ID/);
  });

  it("throws on id with spaces", () => {
    const content = FULL_CONTENT.replace(
      "id: use-read-tool",
      "id: use read tool",
    );
    expect(() => parseInstinct(content)).toThrow(/Invalid instinct ID/);
  });

  it("throws on missing required field", () => {
    const content = FULL_CONTENT.replace(
      "title: Use Read Tool for File Inspection\n",
      "",
    );
    expect(() => parseInstinct(content)).toThrow(
      /missing required field "title"/,
    );
  });

  it("throws when frontmatter delimiters are absent", () => {
    expect(() => parseInstinct("no frontmatter here")).toThrow(/frontmatter/);
  });
});

// ---------------------------------------------------------------------------
// serializeInstinct
// ---------------------------------------------------------------------------

describe("serializeInstinct", () => {
  it("produces output starting with --- and containing required fields", () => {
    const output = serializeInstinct(FULL_INSTINCT);
    expect(output).toMatch(/^---\n/);
    expect(output).toContain("id: use-read-tool");
    expect(output).toContain("confidence: 0.7");
    expect(output).toContain("domain: tooling");
  });

  it("clamps confidence above 0.9 during serialization", () => {
    const instinct = { ...FULL_INSTINCT, confidence: 1.5 };
    const output = serializeInstinct(instinct);
    expect(output).toContain("confidence: 0.9");
  });

  it("clamps confidence below 0.1 during serialization", () => {
    const instinct = { ...FULL_INSTINCT, confidence: 0.0 };
    const output = serializeInstinct(instinct);
    expect(output).toContain("confidence: 0.1");
  });

  it("omits optional fields when undefined", () => {
    const instinct: Instinct = {
      id: "prefer-immutability",
      title: "Prefer Immutable Patterns",
      trigger: "when updating objects or arrays",
      action:
        "Create new objects and arrays instead of mutating existing ones.",
      confidence: 0.5,
      domain: "code-style",
      source: "personal",
      scope: "global",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      observation_count: 3,
      confirmed_count: 1,
      contradicted_count: 0,
      inactive_count: 0,
    };
    const output = serializeInstinct(instinct);
    expect(output).not.toContain("project_id");
    expect(output).not.toContain("project_name");
    expect(output).not.toContain("evidence");
    expect(output).not.toContain("flagged_for_removal");
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("preserves all data through serialize -> parse", () => {
    const serialized = serializeInstinct(FULL_INSTINCT);
    const parsed = parseInstinct(serialized);

    expect(parsed.id).toBe(FULL_INSTINCT.id);
    expect(parsed.title).toBe(FULL_INSTINCT.title);
    expect(parsed.trigger).toBe(FULL_INSTINCT.trigger);
    expect(parsed.action).toBe(FULL_INSTINCT.action);
    expect(parsed.confidence).toBe(FULL_INSTINCT.confidence);
    expect(parsed.domain).toBe(FULL_INSTINCT.domain);
    expect(parsed.source).toBe(FULL_INSTINCT.source);
    expect(parsed.scope).toBe(FULL_INSTINCT.scope);
    expect(parsed.project_id).toBe(FULL_INSTINCT.project_id);
    expect(parsed.project_name).toBe(FULL_INSTINCT.project_name);
    expect(parsed.created_at).toBe(FULL_INSTINCT.created_at);
    expect(parsed.updated_at).toBe(FULL_INSTINCT.updated_at);
    expect(parsed.observation_count).toBe(FULL_INSTINCT.observation_count);
    expect(parsed.confirmed_count).toBe(FULL_INSTINCT.confirmed_count);
    expect(parsed.contradicted_count).toBe(FULL_INSTINCT.contradicted_count);
    expect(parsed.inactive_count).toBe(FULL_INSTINCT.inactive_count);
    expect(parsed.evidence).toEqual(FULL_INSTINCT.evidence);
    expect(parsed.flagged_for_removal).toBe(FULL_INSTINCT.flagged_for_removal);
  });

  it("preserves global instinct (no optional fields) through serialize -> parse", () => {
    const instinct = parseInstinct(GLOBAL_CONTENT);
    const serialized = serializeInstinct(instinct);
    const reparsed = parseInstinct(serialized);

    expect(reparsed.id).toBe(instinct.id);
    expect(reparsed.action).toBe(instinct.action);
    expect(reparsed.project_id).toBeUndefined();
    expect(reparsed.evidence).toBeUndefined();
  });
});
