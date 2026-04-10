import { describe, it, expect } from "vitest";
import { parseReviewFindings, formatFindings } from "./review-parser.js";

describe("parseReviewFindings", () => {
  it("parses valid JSON findings", () => {
    const text = JSON.stringify({
      findings: [
        {
          severity: "HIGH",
          file: "src/foo.ts",
          line: 42,
          category: "error-handling",
          message: "Unhandled promise rejection",
          suggestion: "Add try-catch",
        },
      ],
    });

    const findings = parseReviewFindings(text);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      severity: "HIGH",
      file: "src/foo.ts",
      line: 42,
      category: "error-handling",
      message: "Unhandled promise rejection",
      suggestion: "Add try-catch",
    });
  });

  it("strips markdown code fences", () => {
    const text = "```json\n" + JSON.stringify({
      findings: [
        { severity: "MEDIUM", file: "a.ts", category: "naming", message: "Unclear name" },
      ],
    }) + "\n```";

    const findings = parseReviewFindings(text);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("MEDIUM");
  });

  it("handles empty findings array", () => {
    const text = JSON.stringify({ findings: [] });

    expect(parseReviewFindings(text)).toEqual([]);
  });

  it("filters out invalid findings", () => {
    const text = JSON.stringify({
      findings: [
        { severity: "HIGH", file: "a.ts", category: "bug", message: "Valid" },
        { severity: "INVALID", file: "b.ts", category: "bug", message: "Bad severity" },
        { file: "c.ts", category: "bug", message: "Missing severity" },
        { severity: "LOW", message: "Missing file" },
      ],
    });

    const findings = parseReviewFindings(text);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("a.ts");
  });

  it("returns fallback finding for unparseable text", () => {
    const findings = parseReviewFindings("This is not JSON at all");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("INFO");
    expect(findings[0]?.category).toBe("parse-error");
  });

  it("handles JSON without findings key", () => {
    const text = JSON.stringify({ results: [] });

    const findings = parseReviewFindings(text);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("parse-error");
  });

  it("omits optional fields when not present", () => {
    const text = JSON.stringify({
      findings: [
        { severity: "INFO", file: "a.ts", category: "style", message: "Minor" },
      ],
    });

    const findings = parseReviewFindings(text);

    expect(findings[0]?.line).toBeUndefined();
    expect(findings[0]?.suggestion).toBeUndefined();
  });
});

describe("formatFindings", () => {
  it("formats findings as markdown", () => {
    const output = formatFindings([
      {
        severity: "HIGH",
        file: "src/foo.ts",
        line: 10,
        category: "security",
        message: "SQL injection risk",
        suggestion: "Use parameterized queries",
      },
      {
        severity: "INFO",
        file: "src/bar.ts",
        category: "naming",
        message: "Unclear variable name",
      },
    ]);

    expect(output).toContain("HIGH");
    expect(output).toContain("src/foo.ts");
    expect(output).toContain("SQL injection risk");
    expect(output).toContain("parameterized queries");
  });

  it("returns clean message when no findings", () => {
    const output = formatFindings([]);

    expect(output).toMatch(/no.*issues|clean/i);
  });

  it("groups by severity", () => {
    const output = formatFindings([
      { severity: "CRITICAL", file: "a.ts", category: "sec", message: "Bad" },
      { severity: "INFO", file: "b.ts", category: "style", message: "Meh" },
      { severity: "HIGH", file: "c.ts", category: "bug", message: "Oops" },
    ]);

    const criticalIdx = output.indexOf("CRITICAL");
    const highIdx = output.indexOf("HIGH");
    const infoIdx = output.indexOf("INFO");

    expect(criticalIdx).toBeLessThan(highIdx);
    expect(highIdx).toBeLessThan(infoIdx);
  });
});
