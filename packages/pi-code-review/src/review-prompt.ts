import { buildLanguageSection } from "./language-detector.js";
import type { EditedFile } from "./types.js";

const MAX_FILE_CHARS = 4000;

interface FileWithContent {
  readonly path: string;
  readonly content: string;
  readonly language: string | null;
}

function truncate(content: string, max: number): string {
  if (content.length <= max) return content;
  return content.slice(0, max) + "\n[truncated]";
}

export function buildReviewPrompt(files: readonly FileWithContent[]): string {
  const languages = [
    ...new Set(
      files.map((f) => f.language).filter((l): l is string => l !== null),
    ),
  ];

  const fileBlocks = files
    .map(
      (f) =>
        `### ${f.path}${f.language ? ` (${f.language})` : ""}\n\`\`\`\n${truncate(f.content, MAX_FILE_CHARS)}\n\`\`\``,
    )
    .join("\n\n");

  const langSection = buildLanguageSection(languages);

  return `Review the following files for code quality issues. Return your findings as JSON in this exact format:

\`\`\`json
{"findings": [{"severity": "CRITICAL|HIGH|MEDIUM|INFO", "file": "path", "line": 42, "category": "category", "message": "description", "suggestion": "fix"}]}
\`\`\`

Severity guide:
- CRITICAL: Security vulnerabilities, data loss risks, crash-inducing bugs
- HIGH: Bugs, unhandled errors, type safety violations
- MEDIUM: Anti-patterns, maintainability issues, naming problems
- INFO: Style improvements, minor optimizations

Focus areas by language:${langSection}

If no issues are found, return: \`{"findings": []}\`

## Files to Review

${fileBlocks}`;
}

export function buildFallbackPrompt(files: readonly EditedFile[]): string {
  const languages = [
    ...new Set(
      files.map((f) => f.language).filter((l): l is string => l !== null),
    ),
  ];

  const fileList = files.map((f) => `- ${f.path}`).join("\n");
  const langSection = buildLanguageSection(languages);

  return `Review the following recently changed files for code quality issues. Read each file, then report findings.

## Format

For each finding, state:
- **Severity**: CRITICAL, HIGH, MEDIUM, or INFO
- **File** and **line number**
- **Category** (security, error-handling, type-safety, naming, etc.)
- **Issue** and **suggestion**

Focus areas:${langSection}

## Files to Review

${fileList}

Read each file, identify issues, and report your findings. Fix any CRITICAL or HIGH issues immediately.`;
}
