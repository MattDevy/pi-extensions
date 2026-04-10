import type { ReviewFinding, ReviewSeverity } from "./types.js";

const VALID_SEVERITIES = new Set<string>(["CRITICAL", "HIGH", "MEDIUM", "INFO"]);

const SEVERITY_ORDER: Record<ReviewSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  INFO: 3,
};

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/gm, "").replace(/\n?```\s*$/gm, "");
}

function isValidFinding(obj: Record<string, unknown>): boolean {
  return (
    typeof obj["severity"] === "string" &&
    VALID_SEVERITIES.has(obj["severity"]) &&
    typeof obj["file"] === "string" &&
    typeof obj["category"] === "string" &&
    typeof obj["message"] === "string"
  );
}

function toFinding(item: Record<string, unknown>): ReviewFinding {
  return {
    severity: item["severity"] as ReviewSeverity,
    file: item["file"] as string,
    category: item["category"] as string,
    message: item["message"] as string,
    ...(typeof item["line"] === "number" ? { line: item["line"] } : {}),
    ...(typeof item["suggestion"] === "string" ? { suggestion: item["suggestion"] } : {}),
  };
}

export function parseReviewFindings(text: string): ReviewFinding[] {
  const cleaned = stripCodeFences(text.trim());

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") {
      return makeFallback(text);
    }

    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj["findings"])) {
      return makeFallback(text);
    }

    const findings: ReviewFinding[] = [];
    for (const item of obj["findings"] as unknown[]) {
      const raw = item as Record<string, unknown>;
      if (isValidFinding(raw)) {
        findings.push(toFinding(raw));
      }
    }
    return findings;
  } catch {
    return makeFallback(text);
  }
}

function makeFallback(text: string): ReviewFinding[] {
  return [
    {
      severity: "INFO",
      file: "",
      category: "parse-error",
      message: `Could not parse structured review. Raw response: ${text.slice(0, 200)}`,
    },
  ];
}

export function formatFindings(findings: readonly ReviewFinding[]): string {
  if (findings.length === 0) {
    return "Code review complete: no issues found. Code looks clean.";
  }

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const lines = sorted.map((f) => {
    const location = f.line ? `${f.file}:${f.line}` : f.file;
    const suggestion = f.suggestion ? `\n  Suggestion: ${f.suggestion}` : "";
    return `- **${f.severity}** [${f.category}] ${location}: ${f.message}${suggestion}`;
  });

  const counts = findings.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const summary = Object.entries(counts)
    .sort(([a], [b]) => SEVERITY_ORDER[a as ReviewSeverity] - SEVERITY_ORDER[b as ReviewSeverity])
    .map(([sev, count]) => `${count} ${sev}`)
    .join(", ");

  return `## Code Review Findings (${summary})\n\n${lines.join("\n")}`;
}
