import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { TddConfig, InjectionMode, EnforcementLevel, TestFilePatterns } from "./types.js";

export const CONFIG_DIR = join(homedir(), ".pi", "red-green");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_TEST_FILE_PATTERNS: TestFilePatterns = {
  typescript: ["**/*.test.ts", "**/*.spec.ts", "**/*.test.tsx", "**/*.spec.tsx"],
  python: ["**/test_*.py", "**/*_test.py"],
  go: ["**/*_test.go"],
  rust: ["**/tests/**/*.rs"],
  java: ["**/*Test.java", "**/*Spec.java"],
  php: ["**/*Test.php"],
};

const DEFAULT_TEST_RUNNER_PATTERNS: readonly string[] = [
  "vitest",
  "jest",
  "pytest",
  "go test",
  "cargo test",
  "phpunit",
  "mix test",
  "dotnet test",
  "mvn test",
  "gradle test",
  "npm test",
  "npm run test",
  "npx vitest",
  "npx jest",
];

export const DEFAULT_CONFIG: TddConfig = {
  injection_mode: "active-only",
  ordering_enforcement: "warn",
  coverage_threshold: 80,
  coverage_enabled: false,
  auto_advance: true,
  test_file_patterns: DEFAULT_TEST_FILE_PATTERNS,
  test_runner_patterns: DEFAULT_TEST_RUNNER_PATTERNS,
};

const TestFilePatternsSchema = Type.Partial(
  Type.Object({
    typescript: Type.Array(Type.String()),
    python: Type.Array(Type.String()),
    go: Type.Array(Type.String()),
    rust: Type.Array(Type.String()),
    java: Type.Array(Type.String()),
    php: Type.Array(Type.String()),
  }),
);

const PartialConfigSchema = Type.Partial(
  Type.Object({
    injection_mode: Type.Union([
      Type.Literal("always"),
      Type.Literal("active-only"),
      Type.Literal("nudge"),
      Type.Literal("off"),
    ]),
    ordering_enforcement: Type.Union([
      Type.Literal("warn"),
      Type.Literal("strict"),
      Type.Literal("off"),
    ]),
    coverage_threshold: Type.Number({ minimum: 0, maximum: 100 }),
    coverage_enabled: Type.Boolean(),
    auto_advance: Type.Boolean(),
    test_file_patterns: TestFilePatternsSchema,
    test_runner_patterns: Type.Array(Type.String()),
  }),
);

type PartialConfig = {
  injection_mode?: TddConfig["injection_mode"];
  ordering_enforcement?: TddConfig["ordering_enforcement"];
  coverage_threshold?: number;
  coverage_enabled?: boolean;
  auto_advance?: boolean;
  test_file_patterns?: Partial<TestFilePatterns>;
  test_runner_patterns?: readonly string[];
};

export function loadConfig(configPath = CONFIG_PATH): TddConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[pi-red-green] Invalid JSON in config.json, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  const cleaned = Value.Clean(PartialConfigSchema, parsed) as PartialConfig;

  const VALID_INJECTION_MODES: readonly InjectionMode[] = ["always", "active-only", "nudge", "off"];
  const VALID_ENFORCEMENT_LEVELS: readonly EnforcementLevel[] = ["warn", "strict", "off"];

  const injectionMode = cleaned.injection_mode !== undefined
    && VALID_INJECTION_MODES.includes(cleaned.injection_mode)
    ? cleaned.injection_mode
    : DEFAULT_CONFIG.injection_mode;

  const orderingEnforcement = cleaned.ordering_enforcement !== undefined
    && VALID_ENFORCEMENT_LEVELS.includes(cleaned.ordering_enforcement)
    ? cleaned.ordering_enforcement
    : DEFAULT_CONFIG.ordering_enforcement;

  const mergedPatterns: TestFilePatterns = cleaned.test_file_patterns
    ? { ...DEFAULT_TEST_FILE_PATTERNS, ...cleaned.test_file_patterns }
    : DEFAULT_TEST_FILE_PATTERNS;

  return {
    ...DEFAULT_CONFIG,
    ...cleaned,
    injection_mode: injectionMode,
    ordering_enforcement: orderingEnforcement,
    test_file_patterns: mergedPatterns,
  };
}
