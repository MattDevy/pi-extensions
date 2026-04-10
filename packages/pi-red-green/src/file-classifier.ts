import type { TddConfig } from "./types.js";

export type FileClassification = "test" | "implementation" | "other";

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

const OTHER_EXTENSIONS = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
  ".txt",
  ".css",
  ".scss",
  ".html",
  ".svg",
  ".png",
  ".jpg",
  ".lock",
  ".env",
  ".gitignore",
  ".editorconfig",
]);

export function detectLanguage(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  for (const [ext, lang] of Object.entries(LANGUAGE_MAP)) {
    if (lower.endsWith(ext)) return lang;
  }
  return null;
}

const globRegexCache = new Map<string, RegExp>();

function getGlobRegex(pattern: string): RegExp {
  let cached = globRegexCache.get(pattern);
  if (cached) return cached;

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(__GLOBSTAR__/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/__GLOBSTAR__/g, ".*");

  cached = new RegExp(`(^|/)${escaped}$`);
  globRegexCache.set(pattern, cached);
  return cached;
}

function matchesAnyPattern(filePath: string, patterns: readonly string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of patterns) {
    if (getGlobRegex(pattern).test(normalized)) return true;
  }
  return false;
}

export function classifyFile(
  filePath: string,
  config: TddConfig,
): FileClassification {
  const normalized = filePath.replace(/\\/g, "/");

  for (const ext of OTHER_EXTENSIONS) {
    if (normalized.toLowerCase().endsWith(ext)) return "other";
  }

  const segments = normalized.split("/");
  const filename = segments[segments.length - 1] ?? "";
  if (isConfigFile(filename)) return "other";

  const language = detectLanguage(filePath);
  if (!language) return "other";

  const patterns = config.test_file_patterns[language as keyof typeof config.test_file_patterns];
  if (patterns && matchesAnyPattern(normalized, patterns)) {
    return "test";
  }

  return "implementation";
}

function isConfigFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.startsWith("tsconfig") ||
    lower.startsWith("vitest.config") ||
    lower.startsWith("jest.config") ||
    lower.startsWith("eslint") ||
    lower.startsWith(".eslint") ||
    lower.startsWith("prettier") ||
    lower.startsWith(".prettier") ||
    lower === "package.json" ||
    lower === "package-lock.json" ||
    lower === "makefile" ||
    lower === "dockerfile" ||
    lower === "cargo.toml" ||
    lower === "go.mod" ||
    lower === "go.sum" ||
    lower === "build.gradle" ||
    lower === "build.gradle.kts" ||
    lower === "pom.xml" ||
    lower === "pyproject.toml" ||
    lower === "setup.py" ||
    lower === "setup.cfg"
  );
}
