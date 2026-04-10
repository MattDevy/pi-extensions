const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".php": "php",
};

const NON_CODE_EXTENSIONS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".md", ".txt",
  ".css", ".scss", ".html", ".svg", ".png", ".jpg",
  ".lock", ".env", ".gitignore", ".editorconfig",
]);

const CONFIG_FILENAMES = new Set([
  "package.json", "package-lock.json",
  "dockerfile", "makefile",
  "cargo.toml", "go.mod", "go.sum",
  "build.gradle", "build.gradle.kts", "pom.xml",
  "pyproject.toml", "setup.py", "setup.cfg",
]);

const CONFIG_PREFIXES = [
  "tsconfig", "vitest.config", "jest.config",
  "eslint", ".eslint", "prettier", ".prettier",
];

const LANGUAGE_CHECKLISTS: Record<string, readonly string[]> = {
  typescript: [
    "Type safety: any usage, missing return types on exports, unsafe type assertions",
    "Error handling: unhandled promises, missing try-catch at boundaries, swallowed errors",
    "Null safety: missing optional chaining, unchecked array access, nullable values",
    "Naming: unclear variable/function names, inconsistent conventions",
    "Security: unsanitized input, injection vectors, hardcoded secrets",
  ],
  python: [
    "Type hints: missing annotations on public functions, incorrect types",
    "Error handling: bare except, missing error context, swallowed exceptions",
    "Resource management: missing context managers, unclosed handles",
    "Naming: PEP 8 violations, unclear names",
    "Security: input validation, path traversal, injection risks",
  ],
  go: [
    "Error handling: unchecked errors, missing error wrapping, bare returns",
    "Concurrency: goroutine leaks, missing synchronization, channel misuse",
    "Interface design: overly broad interfaces, unused interface methods",
    "Naming: non-idiomatic names, unexported when should be exported",
    "Security: input validation, SQL injection, path traversal",
  ],
  rust: [
    "Ownership: unnecessary clones, lifetime issues, borrow conflicts",
    "Error handling: unwrap in production code, missing error context",
    "Unsafe: unnecessary unsafe blocks, missing safety docs",
    "Naming: non-idiomatic names, unclear module structure",
    "Security: unchecked input, integer overflow, buffer issues",
  ],
  java: [
    "Null safety: missing null checks, Optional misuse",
    "Error handling: catching Exception/Throwable, empty catch blocks",
    "Concurrency: thread safety, shared mutable state",
    "Naming: unclear names, convention violations",
    "Security: injection risks, insecure deserialization",
  ],
  php: [
    "Type safety: missing type declarations, loose comparisons",
    "Error handling: suppressed errors, missing exception handling",
    "Security: SQL injection, XSS, CSRF, path traversal",
    "Naming: PSR violations, unclear names",
    "Resource management: unclosed connections, memory leaks",
  ],
};

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot === -1 ? "" : filePath.slice(dot).toLowerCase();
}

export function detectLanguage(filePath: string): string | null {
  return LANGUAGE_MAP[getExtension(filePath)] ?? null;
}

export function getLanguageChecklist(language: string): readonly string[] {
  return LANGUAGE_CHECKLISTS[language] ?? [];
}

export function buildLanguageSection(languages: readonly string[]): string {
  const parts: string[] = [];
  for (const lang of languages) {
    const items = getLanguageChecklist(lang);
    if (items.length > 0) {
      const formatted = items.map((item) => `- ${item}`).join("\n");
      parts.push(`### ${lang[0]!.toUpperCase()}${lang.slice(1)}\n${formatted}`);
    }
  }
  return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
}

export function isCodeFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const filename = segments[segments.length - 1] ?? "";
  const lower = filename.toLowerCase();
  const ext = getExtension(filePath);

  if (CONFIG_FILENAMES.has(lower)) return false;
  for (const prefix of CONFIG_PREFIXES) {
    if (lower.startsWith(prefix)) return false;
  }
  if (NON_CODE_EXTENSIONS.has(ext)) return false;

  return LANGUAGE_MAP[ext] !== undefined;
}
