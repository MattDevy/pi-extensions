import { describe, it, expect } from "vitest";
import { isTestRunCommand, parseTestRunResult } from "./test-run-detector.js";
import { DEFAULT_CONFIG } from "./config.js";

describe("isTestRunCommand", () => {
  const config = DEFAULT_CONFIG;

  it("detects vitest commands", () => {
    expect(isTestRunCommand("vitest run", config)).toBe(true);
    expect(isTestRunCommand("npx vitest", config)).toBe(true);
    expect(isTestRunCommand("npx vitest run src/foo.test.ts", config)).toBe(true);
  });

  it("detects jest commands", () => {
    expect(isTestRunCommand("jest", config)).toBe(true);
    expect(isTestRunCommand("npx jest --watch", config)).toBe(true);
  });

  it("detects pytest commands", () => {
    expect(isTestRunCommand("pytest tests/", config)).toBe(true);
    expect(isTestRunCommand("python -m pytest", config)).toBe(true);
  });

  it("detects go test commands", () => {
    expect(isTestRunCommand("go test ./...", config)).toBe(true);
  });

  it("detects cargo test commands", () => {
    expect(isTestRunCommand("cargo test", config)).toBe(true);
  });

  it("detects npm test", () => {
    expect(isTestRunCommand("npm test", config)).toBe(true);
    expect(isTestRunCommand("npm run test", config)).toBe(true);
  });

  it("returns false for non-test commands", () => {
    expect(isTestRunCommand("git status", config)).toBe(false);
    expect(isTestRunCommand("npm install", config)).toBe(false);
    expect(isTestRunCommand("tsc --noEmit", config)).toBe(false);
  });
});

describe("parseTestRunResult", () => {
  describe("vitest output", () => {
    it("parses all-passing vitest output", () => {
      const stdout = `
 ✓ src/auth.test.ts (5 tests) 3ms
 ✓ src/utils.test.ts (3 tests) 2ms

 Test Files  2 passed (2)
      Tests  8 passed (8)
   Start at  12:00:00
   Duration  300ms
`;
      const result = parseTestRunResult(stdout, "", 0);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(8);
      expect(result!.failed).toBe(0);
      expect(result!.errors).toBe(0);
      expect(result!.exit_code).toBe(0);
    });

    it("parses mixed vitest output", () => {
      const stdout = `
 ✓ src/auth.test.ts (3 tests) 3ms
 × src/utils.test.ts (2 tests | 1 failed) 5ms

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 4 passed (5)
   Duration  300ms
`;
      const result = parseTestRunResult(stdout, "", 1);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(4);
      expect(result!.failed).toBe(1);
    });

    it("detects vitest compile errors", () => {
      const stderr = `
Error: Cannot find module './nonexistent.js'
vitest v3.2.4
`;
      const result = parseTestRunResult("", stderr, 1);
      expect(result).not.toBeNull();
      expect(result!.errors).toBeGreaterThan(0);
      expect(result!.exit_code).toBe(1);
    });
  });

  describe("jest output", () => {
    it("parses passing jest output", () => {
      const stdout = `
Test Suites: 2 passed, 2 total
Tests:       5 passed, 5 total
`;
      const result = parseTestRunResult(stdout, "", 0);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(5);
      expect(result!.failed).toBe(0);
    });

    it("parses failing jest output", () => {
      const stdout = `
Test Suites: 1 failed, 1 passed, 2 total
Tests:       2 failed, 3 passed, 5 total
`;
      const result = parseTestRunResult(stdout, "", 1);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(3);
      expect(result!.failed).toBe(2);
    });
  });

  describe("pytest output", () => {
    it("parses passing pytest output", () => {
      const stdout = `
========================= 5 passed in 0.3s =========================
`;
      const result = parseTestRunResult(stdout, "", 0);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(5);
      expect(result!.failed).toBe(0);
    });

    it("parses mixed pytest output", () => {
      const stdout = `
========================= 2 failed, 3 passed in 0.5s =========================
`;
      const result = parseTestRunResult(stdout, "", 1);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(3);
      expect(result!.failed).toBe(2);
    });

    it("parses pytest with errors", () => {
      const stdout = `
========================= 1 error in 0.2s =========================
`;
      const result = parseTestRunResult(stdout, "", 1);
      expect(result).not.toBeNull();
      expect(result!.errors).toBe(1);
    });
  });

  describe("go test output", () => {
    it("parses passing go test output", () => {
      const stdout = `
--- PASS: TestAdd (0.00s)
--- PASS: TestSub (0.00s)
ok  	mypackage	0.005s
`;
      const result = parseTestRunResult(stdout, "", 0);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(2);
      expect(result!.failed).toBe(0);
    });

    it("parses failing go test output", () => {
      const stdout = `
--- PASS: TestAdd (0.00s)
--- FAIL: TestSub (0.00s)
FAIL	mypackage	0.005s
`;
      const result = parseTestRunResult(stdout, "", 1);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(1);
      expect(result!.failed).toBe(1);
    });

    it("parses go test with only summary line", () => {
      const stdout = `ok  	mypackage	0.005s\n`;
      const result = parseTestRunResult(stdout, "", 0);
      expect(result).not.toBeNull();
      expect(result!.passed).toBeGreaterThan(0);
    });
  });

  describe("cargo test output", () => {
    it("parses passing cargo test output", () => {
      const stdout = `
running 3 tests
test tests::test_add ... ok
test tests::test_sub ... ok
test tests::test_mul ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
`;
      const result = parseTestRunResult(stdout, "", 0);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(3);
      expect(result!.failed).toBe(0);
    });

    it("parses failing cargo test output", () => {
      const stdout = `
running 3 tests
test tests::test_add ... ok
test tests::test_sub ... FAILED
test tests::test_mul ... ok

test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out
`;
      const result = parseTestRunResult(stdout, "", 1);
      expect(result).not.toBeNull();
      expect(result!.passed).toBe(2);
      expect(result!.failed).toBe(1);
    });
  });

  describe("unrecognized output", () => {
    it("returns null for non-test output", () => {
      const result = parseTestRunResult("hello world", "", 0);
      expect(result).toBeNull();
    });
  });
});
