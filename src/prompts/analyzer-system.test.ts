import { describe, it, expect, beforeAll } from "vitest";
import { buildAnalyzerSystemPrompt } from "./analyzer-system.js";

describe("buildAnalyzerSystemPrompt", () => {
  let prompt: string;

  // Build once - pure function, same result every call
  beforeAll(() => {
    prompt = buildAnalyzerSystemPrompt();
  });

  it("returns a non-empty string", () => {
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Instinct file format section
  // ---------------------------------------------------------------------------

  it("includes the instinct file format section header", () => {
    expect(prompt).toContain("## Instinct File Format");
  });

  it("includes YAML frontmatter structure with required fields", () => {
    expect(prompt).toContain("id:");
    expect(prompt).toContain("title:");
    expect(prompt).toContain("trigger:");
    expect(prompt).toContain("confidence:");
    expect(prompt).toContain("domain:");
    expect(prompt).toContain("source:");
    expect(prompt).toContain("scope:");
    expect(prompt).toContain("observation_count:");
    expect(prompt).toContain("confirmed_count:");
    expect(prompt).toContain("contradicted_count:");
    expect(prompt).toContain("inactive_count:");
    expect(prompt).toContain("evidence:");
  });

  it("specifies kebab-case ID format", () => {
    expect(prompt).toContain("kebab-case");
  });

  // ---------------------------------------------------------------------------
  // Pattern detection section
  // ---------------------------------------------------------------------------

  it("includes pattern detection section header", () => {
    expect(prompt).toContain("## Pattern Detection Heuristics");
  });

  it("includes user corrections heuristic", () => {
    expect(prompt).toContain("User Corrections");
  });

  it("includes error resolutions heuristic", () => {
    expect(prompt).toContain("Error Resolutions");
  });

  it("includes repeated workflows heuristic", () => {
    expect(prompt).toContain("Repeated Workflows");
  });

  it("includes tool preferences heuristic", () => {
    expect(prompt).toContain("Tool Preferences");
  });

  // ---------------------------------------------------------------------------
  // Feedback analysis section
  // ---------------------------------------------------------------------------

  it("includes feedback analysis section header", () => {
    expect(prompt).toContain("## Feedback Analysis Instructions");
  });

  it("describes confirmed feedback logic", () => {
    expect(prompt).toContain("Confirmed");
    expect(prompt).toContain("confirmed_count");
  });

  it("describes contradicted feedback logic", () => {
    expect(prompt).toContain("Contradicted");
    expect(prompt).toContain("contradicted_count");
  });

  it("describes inactive feedback logic", () => {
    expect(prompt).toContain("Inactive");
    expect(prompt).toContain("inactive_count");
  });

  it("explains active_instincts cross-reference mechanism", () => {
    expect(prompt).toContain("active_instincts");
  });

  // ---------------------------------------------------------------------------
  // Confidence scoring section
  // ---------------------------------------------------------------------------

  it("includes confidence scoring section header", () => {
    expect(prompt).toContain("## Confidence Scoring Rules");
  });

  it("includes discovery-based brackets", () => {
    expect(prompt).toContain("0.3");
    expect(prompt).toContain("0.5");
    expect(prompt).toContain("0.7");
    expect(prompt).toContain("0.85");
  });

  it("includes feedback adjustment deltas", () => {
    expect(prompt).toContain("0.05");
    expect(prompt).toContain("0.15");
  });

  it("includes passive decay rule", () => {
    expect(prompt).toContain("Passive Decay");
    expect(prompt).toContain("0.02");
  });

  it("includes clamping range [0.1, 0.9]", () => {
    expect(prompt).toContain("0.1");
    expect(prompt).toContain("0.9");
  });

  it("mentions flagged_for_removal", () => {
    expect(prompt).toContain("flagged_for_removal");
  });

  // ---------------------------------------------------------------------------
  // Scope decision section
  // ---------------------------------------------------------------------------

  it("includes scope decision section header", () => {
    expect(prompt).toContain("## Scope Decision Guide");
  });

  it("explains project scope usage", () => {
    expect(prompt).toContain("project scope");
  });

  it("explains global scope usage", () => {
    expect(prompt).toContain("global scope");
  });

  // ---------------------------------------------------------------------------
  // Conservativeness rules section
  // ---------------------------------------------------------------------------

  it("includes conservativeness rules section header", () => {
    expect(prompt).toContain("## Conservativeness Rules");
  });

  it("requires minimum 3 observations for new instincts", () => {
    expect(prompt).toMatch(/3\s*(or\s*more|[+]|\+)\s*(clear,?\s*)?independent\s*observations/i);
  });

  it("prohibits code snippets in action field", () => {
    expect(prompt).toContain("No code snippets");
    expect(prompt).toContain("Never paste code");
  });

  it("instructs to start action with a verb", () => {
    expect(prompt).toContain("Start with a verb");
  });

  it("instructs to check for duplicate instincts before creating", () => {
    expect(prompt).toContain("No duplication");
  });

  // Avoid Duplicating Guidelines section

  it("includes avoid duplicating guidelines section header", () => {
    expect(prompt).toContain("## Avoid Duplicating Guidelines");
  });

  it("references Existing Guidelines in the deduplication section", () => {
    expect(prompt).toContain("Existing Guidelines");
  });

  it("instructs to skip instincts already covered by AGENTS.md", () => {
    expect(prompt).toContain("do not create the instinct");
  });

  // Avoid Duplicating Installed Skills section

  it("includes avoid duplicating installed skills section header", () => {
    expect(prompt).toContain("## Avoid Duplicating Installed Skills");
  });

  it("references Installed Skills in the deduplication section", () => {
    expect(prompt).toContain("Installed Skills");
  });

  it("instructs to skip instincts covered by named skills", () => {
    expect(prompt).toContain("named skill");
  });
});
