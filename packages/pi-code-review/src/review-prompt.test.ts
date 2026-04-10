import { describe, it, expect } from "vitest";
import { buildReviewPrompt, buildFallbackPrompt } from "./review-prompt.js";

describe("buildReviewPrompt", () => {
  const files = [
    { path: "src/foo.ts", content: "const x = 1;", language: "typescript" as const },
    { path: "main.py", content: "x = 1", language: "python" as const },
  ];

  it("includes file paths", () => {
    const prompt = buildReviewPrompt(files);

    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("main.py");
  });

  it("includes file contents", () => {
    const prompt = buildReviewPrompt(files);

    expect(prompt).toContain("const x = 1;");
    expect(prompt).toContain("x = 1");
  });

  it("requests JSON output", () => {
    const prompt = buildReviewPrompt(files);

    expect(prompt).toContain("JSON");
    expect(prompt).toContain("findings");
  });

  it("includes severity levels", () => {
    const prompt = buildReviewPrompt(files);

    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("HIGH");
    expect(prompt).toContain("MEDIUM");
    expect(prompt).toContain("INFO");
  });

  it("includes language-specific focus areas", () => {
    const prompt = buildReviewPrompt(files);

    expect(prompt).toMatch(/typescript/i);
    expect(prompt).toMatch(/python/i);
  });

  it("truncates long file content", () => {
    const longContent = "x".repeat(5000);
    const prompt = buildReviewPrompt([
      { path: "big.ts", content: longContent, language: "typescript" },
    ]);

    expect(prompt).not.toContain("x".repeat(5000));
    expect(prompt).toContain("[truncated]");
  });

  it("handles files with null language", () => {
    const prompt = buildReviewPrompt([
      { path: "unknown.xyz", content: "data", language: null },
    ]);

    expect(prompt).toContain("unknown.xyz");
  });
});

describe("buildFallbackPrompt", () => {
  it("includes file paths", () => {
    const prompt = buildFallbackPrompt([
      { path: "src/foo.ts", language: "typescript" },
      { path: "src/bar.py", language: "python" },
    ]);

    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("src/bar.py");
  });

  it("includes severity format instructions", () => {
    const prompt = buildFallbackPrompt([
      { path: "src/foo.ts", language: "typescript" },
    ]);

    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("HIGH");
  });

  it("includes language checklists", () => {
    const prompt = buildFallbackPrompt([
      { path: "src/foo.ts", language: "typescript" },
    ]);

    expect(prompt).toMatch(/type safety/i);
  });
});
