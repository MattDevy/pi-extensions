import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock fs module before importing config
vi.mock("node:fs");

import { loadConfig, DEFAULT_CONFIG, CONFIG_PATH } from "./config.js";

const mockedFs = vi.mocked(fs);

describe("loadConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns default config when config file is absent", () => {
    mockedFs.existsSync.mockReturnValue(false);

    const config = loadConfig();

    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns merged config when file has valid complete overrides", () => {
    const overrides = {
      run_interval_minutes: 10,
      min_observations_to_analyze: 50,
      min_confidence: 0.7,
      max_instincts: 30,
      model: "claude-opus-4-5",
      timeout_seconds: 240,
      active_hours_start: 9,
      active_hours_end: 18,
      max_idle_seconds: 900,
    };
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(overrides) as unknown as ReturnType<typeof fs.readFileSync>);

    const config = loadConfig();

    expect(config).toEqual(overrides);
  });

  it("merges partial overrides with defaults (overrides win)", () => {
    const partial = { run_interval_minutes: 15, model: "claude-opus-4-5" };
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(partial) as unknown as ReturnType<typeof fs.readFileSync>);

    const config = loadConfig();

    expect(config.run_interval_minutes).toBe(15);
    expect(config.model).toBe("claude-opus-4-5");
    // Remaining fields come from defaults
    expect(config.min_observations_to_analyze).toBe(DEFAULT_CONFIG.min_observations_to_analyze);
    expect(config.min_confidence).toBe(DEFAULT_CONFIG.min_confidence);
    expect(config.max_instincts).toBe(DEFAULT_CONFIG.max_instincts);
    expect(config.timeout_seconds).toBe(DEFAULT_CONFIG.timeout_seconds);
  });

  it("logs a warning and returns defaults when JSON is invalid", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue("{ not valid json" as unknown as ReturnType<typeof fs.readFileSync>);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const config = loadConfig();

    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toContain("config.json");
  });

  it("has correct default values per spec", () => {
    expect(DEFAULT_CONFIG.run_interval_minutes).toBe(5);
    expect(DEFAULT_CONFIG.min_observations_to_analyze).toBe(20);
    expect(DEFAULT_CONFIG.min_confidence).toBe(0.5);
    expect(DEFAULT_CONFIG.max_instincts).toBe(20);
    expect(DEFAULT_CONFIG.model).toBe("claude-haiku-4-5");
    expect(DEFAULT_CONFIG.timeout_seconds).toBe(120);
  });

  it("exports CONFIG_PATH pointing to ~/.pi/continuous-learning/config.json", () => {
    const expected = path.join(os.homedir(), ".pi", "continuous-learning", "config.json");
    expect(CONFIG_PATH).toBe(expected);
  });
});
