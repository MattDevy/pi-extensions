import type { TddConfig, TestRunResult } from "./types.js";

let cachedLowerPatterns: readonly string[] | null = null;
let cachedPatternSource: readonly string[] | null = null;

function getLowerPatterns(patterns: readonly string[]): readonly string[] {
  if (cachedPatternSource === patterns && cachedLowerPatterns) {
    return cachedLowerPatterns;
  }
  cachedLowerPatterns = patterns.map((p) => p.toLowerCase());
  cachedPatternSource = patterns;
  return cachedLowerPatterns;
}

export function isTestRunCommand(
  command: string,
  config: TddConfig,
): boolean {
  const normalized = command.trim().toLowerCase();
  return getLowerPatterns(config.test_runner_patterns).some((pattern) =>
    normalized.includes(pattern),
  );
}

interface RunnerParser {
  name: string;
  detect: (stdout: string, stderr: string) => boolean;
  parse: (stdout: string, stderr: string, exitCode: number) => TestRunResult | null;
}

const vitestJestParser: RunnerParser = {
  name: "vitest/jest",
  detect: (stdout, stderr) => {
    const combined = stdout + stderr;
    return /Tests?\s+\d/.test(combined) || /Test Suites?:/.test(combined) || /vitest/i.test(combined);
  },
  parse: (stdout, stderr, exitCode) => {
    const combined = stdout + stderr;
    let passed = 0;
    let failed = 0;
    let errors = 0;

    // Vitest format: "Tests  24 passed (24)" or "Tests  1 failed | 23 passed (24)"
    const vitestMatch = combined.match(
      /Tests\s+(?:(\d+)\s+failed\s*\|?\s*)?(\d+)\s+passed/,
    );
    if (vitestMatch) {
      failed = parseInt(vitestMatch[1] ?? "0", 10);
      passed = parseInt(vitestMatch[2] ?? "0", 10);
    }

    // Jest format: "Tests:  1 failed, 2 passed, 3 total"
    const jestMatch = combined.match(
      /Tests:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed)?/,
    );
    if (!vitestMatch && jestMatch) {
      failed = parseInt(jestMatch[1] ?? "0", 10);
      passed = parseInt(jestMatch[2] ?? "0", 10);
    }

    // Detect errors (compile/runtime errors before tests run)
    if (exitCode !== 0 && passed === 0 && failed === 0) {
      errors = 1;
    }

    if (passed === 0 && failed === 0 && errors === 0) {
      return null;
    }

    return {
      timestamp: new Date().toISOString(),
      turn_index: 0,
      passed,
      failed,
      errors,
      exit_code: exitCode,
    };
  },
};

const pytestParser: RunnerParser = {
  name: "pytest",
  detect: (stdout, stderr) => {
    const combined = stdout + stderr;
    return /=+ .*(passed|failed|error).* =+/.test(combined) || /pytest/.test(combined);
  },
  parse: (stdout, stderr, exitCode) => {
    const combined = stdout + stderr;
    let passed = 0;
    let failed = 0;
    let errors = 0;

    // pytest format: "3 passed, 1 failed, 2 errors"
    const passedMatch = combined.match(/(\d+)\s+passed/);
    const failedMatch = combined.match(/(\d+)\s+failed/);
    const errorsMatch = combined.match(/(\d+)\s+error/);

    if (passedMatch) passed = parseInt(passedMatch[1]!, 10);
    if (failedMatch) failed = parseInt(failedMatch[1]!, 10);
    if (errorsMatch) errors = parseInt(errorsMatch[1]!, 10);

    if (exitCode !== 0 && passed === 0 && failed === 0 && errors === 0) {
      errors = 1;
    }

    if (passed === 0 && failed === 0 && errors === 0) {
      return null;
    }

    return {
      timestamp: new Date().toISOString(),
      turn_index: 0,
      passed,
      failed,
      errors,
      exit_code: exitCode,
    };
  },
};

const goTestParser: RunnerParser = {
  name: "go test",
  detect: (stdout, stderr) => {
    const combined = stdout + stderr;
    return /^(ok|FAIL)\s+\S+/.test(combined) || /--- (PASS|FAIL):/.test(combined);
  },
  parse: (stdout, stderr, exitCode) => {
    const combined = stdout + stderr;
    let passed = 0;
    let failed = 0;
    let errors = 0;

    const passMatches = combined.match(/--- PASS:/g);
    const failMatches = combined.match(/--- FAIL:/g);
    if (passMatches) passed = passMatches.length;
    if (failMatches) failed = failMatches.length;

    // Detect panics or build errors
    if (/panic:/.test(combined) || /build failed/.test(combined.toLowerCase())) {
      errors = 1;
    }

    if (exitCode !== 0 && passed === 0 && failed === 0 && errors === 0) {
      errors = 1;
    }

    if (passed === 0 && failed === 0 && errors === 0) {
      // Check for "ok" lines without individual test output
      if (/^ok\s/m.test(combined) && exitCode === 0) {
        passed = 1;
      } else if (/^FAIL\s/m.test(combined)) {
        failed = 1;
      }
    }

    if (passed === 0 && failed === 0 && errors === 0) {
      return null;
    }

    return {
      timestamp: new Date().toISOString(),
      turn_index: 0,
      passed,
      failed,
      errors,
      exit_code: exitCode,
    };
  },
};

const cargoTestParser: RunnerParser = {
  name: "cargo test",
  detect: (stdout, stderr) => {
    const combined = stdout + stderr;
    return /test result:/.test(combined);
  },
  parse: (stdout, stderr, exitCode) => {
    const combined = stdout + stderr;
    let passed = 0;
    let failed = 0;
    let errors = 0;

    // cargo test format: "test result: FAILED. 1 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out"
    const resultMatch = combined.match(
      /test result: \w+\.\s+(\d+)\s+passed;\s+(\d+)\s+failed/,
    );
    if (resultMatch) {
      passed = parseInt(resultMatch[1]!, 10);
      failed = parseInt(resultMatch[2]!, 10);
    }

    if (/error\[E\d+\]/.test(combined)) {
      errors = 1;
    }

    if (exitCode !== 0 && passed === 0 && failed === 0 && errors === 0) {
      errors = 1;
    }

    if (passed === 0 && failed === 0 && errors === 0) {
      return null;
    }

    return {
      timestamp: new Date().toISOString(),
      turn_index: 0,
      passed,
      failed,
      errors,
      exit_code: exitCode,
    };
  },
};

const PARSERS: readonly RunnerParser[] = [
  vitestJestParser,
  pytestParser,
  goTestParser,
  cargoTestParser,
];

export function parseTestRunResult(
  stdout: string,
  stderr: string,
  exitCode: number,
): TestRunResult | null {
  for (const parser of PARSERS) {
    if (parser.detect(stdout, stderr)) {
      const result = parser.parse(stdout, stderr, exitCode);
      if (result) return result;
    }
  }

  return null;
}
