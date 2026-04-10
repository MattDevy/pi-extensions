import type { ChangedFile } from "./types.js";

export function buildSimplifyPrompt(files: readonly ChangedFile[]): string {
  const fileList = files.map((f) => `- ${f.path} (${f.status})`).join("\n");

  return `Review the following recently changed files and apply simplification improvements.

## Principles

- **Preserve functionality**: Never change what the code does. All existing tests must continue to pass.
- **Apply project standards**: Follow any conventions from CLAUDE.md or AGENTS.md in this project.
- **Enhance clarity**: Reduce unnecessary complexity and nesting, eliminate redundant code and abstractions, improve variable and function names, consolidate related logic, remove unnecessary comments that describe obvious code. Avoid nested ternary operators: prefer switch statements or if/else chains for multiple conditions.
- **Maintain balance**: Do not over-simplify. Avoid overly clever solutions that are hard to understand. Do not combine too many concerns into single functions. Do not remove helpful abstractions. Prioritize readability over fewer lines.

## Scope

Only review and modify these files:
${fileList}

## Process

1. Read each file listed above
2. Identify concrete improvements (dead code, unclear names, redundant logic, inconsistent patterns)
3. Apply changes one file at a time
4. After all changes, run existing tests to verify nothing is broken
5. Summarize what you changed and why

Do NOT add new features, change public APIs, or refactor code outside the listed files.`;
}
