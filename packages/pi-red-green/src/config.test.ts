import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";

const tmpBase = mkdtempSync(join(tmpdir(), "rg-config-test-"));

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when config file does not exist", () => {
    const config = loadConfig(join(tmpBase, "nonexistent.json"));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults when config file is invalid JSON", () => {
    const badPath = join(tmpBase, "bad.json");
    writeFileSync(badPath, "not json {{{", "utf-8");
    const config = loadConfig(badPath);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial config with defaults", () => {
    const partialPath = join(tmpBase, "partial.json");
    writeFileSync(
      partialPath,
      JSON.stringify({ injection_mode: "always", coverage_threshold: 90 }),
      "utf-8",
    );
    const config = loadConfig(partialPath);
    expect(config.injection_mode).toBe("always");
    expect(config.coverage_threshold).toBe(90);
    expect(config.ordering_enforcement).toBe(DEFAULT_CONFIG.ordering_enforcement);
    expect(config.auto_advance).toBe(DEFAULT_CONFIG.auto_advance);
  });

  it("merges partial test_file_patterns without losing defaults", () => {
    const patternPath = join(tmpBase, "patterns.json");
    writeFileSync(
      patternPath,
      JSON.stringify({
        test_file_patterns: { typescript: ["**/*.spec.ts"] },
      }),
      "utf-8",
    );
    const config = loadConfig(patternPath);
    expect(config.test_file_patterns.typescript).toEqual(["**/*.spec.ts"]);
    expect(config.test_file_patterns.python).toEqual(DEFAULT_CONFIG.test_file_patterns.python);
  });

  it("ignores unknown fields", () => {
    const unknownPath = join(tmpBase, "unknown.json");
    writeFileSync(
      unknownPath,
      JSON.stringify({ injection_mode: "nudge", bogus_field: true }),
      "utf-8",
    );
    const config = loadConfig(unknownPath);
    expect(config.injection_mode).toBe("nudge");
    expect((config as unknown as Record<string, unknown>)["bogus_field"]).toBeUndefined();
  });

  it("ignores invalid enum values and uses defaults", () => {
    const invalidPath = join(tmpBase, "invalid-enum.json");
    writeFileSync(
      invalidPath,
      JSON.stringify({ injection_mode: "banana" }),
      "utf-8",
    );
    const config = loadConfig(invalidPath);
    expect(config.injection_mode).toBe(DEFAULT_CONFIG.injection_mode);
  });
});
