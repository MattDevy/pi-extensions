import { describe, it, expect } from "vitest";
import { parseFact, serializeFact } from "./fact-parser.js";
import type { Fact } from "./types.js";

const BASE_FACT: Fact = {
  id: "test-db-port",
  title: "Test Database Port",
  content: "The test database runs on port 3306.",
  confidence: 0.7,
  domain: "database",
  source: "personal",
  scope: "project",
  project_id: "abc123",
  project_name: "my-project",
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-02T00:00:00.000Z",
  observation_count: 3,
  confirmed_count: 2,
  contradicted_count: 0,
  inactive_count: 1,
};

const BASE_FACT_FILE = `---
id: test-db-port
title: Test Database Port
confidence: 0.7
domain: database
source: personal
scope: project
project_id: abc123
project_name: my-project
created_at: "2024-01-01T00:00:00.000Z"
updated_at: "2024-01-02T00:00:00.000Z"
observation_count: 3
confirmed_count: 2
contradicted_count: 0
inactive_count: 1
---

The test database runs on port 3306.
`;

describe("parseFact", () => {
  it("parses a valid fact file", () => {
    const fact = parseFact(BASE_FACT_FILE);
    expect(fact.id).toBe("test-db-port");
    expect(fact.title).toBe("Test Database Port");
    expect(fact.content).toBe("The test database runs on port 3306.");
    expect(fact.confidence).toBe(0.7);
    expect(fact.domain).toBe("database");
    expect(fact.source).toBe("personal");
    expect(fact.scope).toBe("project");
    expect(fact.project_id).toBe("abc123");
    expect(fact.project_name).toBe("my-project");
    expect(fact.observation_count).toBe(3);
    expect(fact.confirmed_count).toBe(2);
    expect(fact.contradicted_count).toBe(0);
    expect(fact.inactive_count).toBe(1);
  });

  it("parses minimal required fields only", () => {
    const minimal = `---
id: staging-url
title: Staging URL
confidence: 0.5
domain: workflow
source: personal
scope: global
created_at: "2024-01-01T00:00:00.000Z"
updated_at: "2024-01-01T00:00:00.000Z"
observation_count: 1
confirmed_count: 0
contradicted_count: 0
inactive_count: 0
---

Staging environment lives at staging.example.com.
`;
    const fact = parseFact(minimal);
    expect(fact.id).toBe("staging-url");
    expect(fact.scope).toBe("global");
    expect(fact.project_id).toBeUndefined();
    expect(fact.flagged_for_removal).toBeUndefined();
    expect(fact.evidence).toBeUndefined();
  });

  it("clamps confidence below 0.1 to 0.1", () => {
    const low = BASE_FACT_FILE.replace("confidence: 0.7", "confidence: 0.01");
    const fact = parseFact(low);
    expect(fact.confidence).toBe(0.1);
  });

  it("clamps confidence above 0.9 to 0.9", () => {
    const high = BASE_FACT_FILE.replace("confidence: 0.7", "confidence: 1.5");
    const fact = parseFact(high);
    expect(fact.confidence).toBe(0.9);
  });

  it("throws on non-kebab-case ID", () => {
    const bad = BASE_FACT_FILE.replace("id: test-db-port", "id: Test_DB_Port");
    expect(() => parseFact(bad)).toThrow(/kebab-case/);
  });

  it("throws when frontmatter delimiters are missing", () => {
    expect(() => parseFact("no frontmatter here")).toThrow(
      /YAML frontmatter delimiters/,
    );
  });

  it("throws when a required field is missing", () => {
    const noTitle = BASE_FACT_FILE.replace(
      "title: Test Database Port\n",
      "",
    );
    expect(() => parseFact(noTitle)).toThrow(/missing required field "title"/);
  });

  it("does not require trigger field", () => {
    // Fact files must NOT have trigger — parsing should succeed without it
    expect(() => parseFact(BASE_FACT_FILE)).not.toThrow();
    const fact = parseFact(BASE_FACT_FILE);
    expect(fact).not.toHaveProperty("trigger");
    expect(fact).not.toHaveProperty("action");
  });

  it("parses evidence array when present", () => {
    const withEvidence = BASE_FACT_FILE.replace(
      "inactive_count: 1\n",
      "inactive_count: 1\nevidence:\n  - saw in logs\n  - confirmed by user\n",
    );
    const fact = parseFact(withEvidence);
    expect(fact.evidence).toEqual(["saw in logs", "confirmed by user"]);
  });

  it("parses flagged_for_removal when present", () => {
    const flagged = BASE_FACT_FILE.replace(
      "inactive_count: 1\n",
      "inactive_count: 1\nflagged_for_removal: true\n",
    );
    const fact = parseFact(flagged);
    expect(fact.flagged_for_removal).toBe(true);
  });
});

describe("serializeFact", () => {
  it("round-trips a fact through serialize → parse", () => {
    const serialized = serializeFact(BASE_FACT);
    const parsed = parseFact(serialized);
    expect(parsed.id).toBe(BASE_FACT.id);
    expect(parsed.title).toBe(BASE_FACT.title);
    expect(parsed.content).toBe(BASE_FACT.content);
    expect(parsed.confidence).toBeCloseTo(BASE_FACT.confidence);
    expect(parsed.domain).toBe(BASE_FACT.domain);
    expect(parsed.scope).toBe(BASE_FACT.scope);
  });

  it("does not include trigger in serialized output", () => {
    const serialized = serializeFact(BASE_FACT);
    expect(serialized).not.toMatch(/trigger:/);
  });

  it("does not include graduated_to in serialized output", () => {
    const serialized = serializeFact(BASE_FACT);
    expect(serialized).not.toMatch(/graduated_to:/);
  });

  it("clamps confidence to 0.9 on serialization", () => {
    const over = { ...BASE_FACT, confidence: 1.2 };
    const serialized = serializeFact(over);
    expect(serialized).toMatch(/confidence: 0.9/);
  });

  it("places the declarative statement as the markdown body", () => {
    const serialized = serializeFact(BASE_FACT);
    expect(serialized).toContain(
      "---\n\nThe test database runs on port 3306.\n",
    );
  });

  it("includes optional fields when present", () => {
    const withEvidence: Fact = {
      ...BASE_FACT,
      evidence: ["seen in logs"],
      flagged_for_removal: true,
    };
    const serialized = serializeFact(withEvidence);
    expect(serialized).toMatch(/evidence:/);
    expect(serialized).toMatch(/flagged_for_removal: true/);
  });

  it("omits optional fields when absent", () => {
    const minimal: Fact = {
      id: "minimal-fact",
      title: "Minimal",
      content: "Just a fact.",
      confidence: 0.5,
      domain: "workflow",
      source: "personal",
      scope: "global",
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
      observation_count: 1,
      confirmed_count: 0,
      contradicted_count: 0,
      inactive_count: 0,
    };
    const serialized = serializeFact(minimal);
    expect(serialized).not.toMatch(/project_id:/);
    expect(serialized).not.toMatch(/evidence:/);
    expect(serialized).not.toMatch(/flagged_for_removal:/);
  });
});
