import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("./analyzer-runner.js", () => ({
  isAnalysisRunning: vi.fn().mockReturnValue(false),
}));

import {
  startAnalyzerTimer,
  stopAnalyzerTimer,
  isTimerRunning,
  resetTimerState,
  countObservations,
  getLastObservationTime,
  isWithinActiveHours,
  getSkipReason,
} from "./analyzer-timer.js";
import { isAnalysisRunning } from "./analyzer-runner.js";
import type { Config } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = "test-proj-001";

/** Config where active hours span the full day and idle threshold is high. */
const ALWAYS_ACTIVE_CONFIG: Config = {
  run_interval_minutes: 5,
  min_observations_to_analyze: 5,
  min_confidence: 0.5,
  max_instincts: 20,
  model: "claude-haiku-4-5",
  timeout_seconds: 120,
  active_hours_start: 0,  // 00:00
  active_hours_end: 24,   // effectively no end (getHours() is 0-23)
  max_idle_seconds: 86400, // 24 hours - never idle in tests
};

let baseDir: string;
let projectDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "timer-test-"));
  projectDir = join(baseDir, "projects", PROJECT_ID);
  mkdirSync(projectDir, { recursive: true });
  resetTimerState();
  vi.resetAllMocks();
  vi.mocked(isAnalysisRunning).mockReturnValue(false);
  vi.useFakeTimers();
});

afterEach(() => {
  stopAnalyzerTimer();
  vi.useRealTimers();
  rmSync(baseDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Writes N observation lines to observations.jsonl.
 * If lastTimestamp is provided, the last line uses that ISO timestamp.
 */
function writeObservations(count: number, lastTimestamp?: string): void {
  const now = Date.now();
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const ts =
      isLast && lastTimestamp !== undefined
        ? lastTimestamp
        : new Date(now - (count - i) * 1000).toISOString();
    lines.push(
      JSON.stringify({
        timestamp: ts,
        event: "agent_end",
        session: "sess-1",
        project_id: PROJECT_ID,
        project_name: "test",
      })
    );
  }
  writeFileSync(join(projectDir, "observations.jsonl"), lines.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// countObservations
// ---------------------------------------------------------------------------

describe("countObservations", () => {
  it("returns 0 when file does not exist", () => {
    expect(countObservations(PROJECT_ID, baseDir)).toBe(0);
  });

  it("counts non-empty lines", () => {
    writeObservations(7);
    expect(countObservations(PROJECT_ID, baseDir)).toBe(7);
  });

  it("ignores blank lines", () => {
    writeFileSync(
      join(projectDir, "observations.jsonl"),
      '{"timestamp":"2026-01-01T00:00:00.000Z","event":"agent_end","session":"s","project_id":"p","project_name":"n"}\n\n',
      "utf-8"
    );
    expect(countObservations(PROJECT_ID, baseDir)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getLastObservationTime
// ---------------------------------------------------------------------------

describe("getLastObservationTime", () => {
  it("returns null when file does not exist", () => {
    expect(getLastObservationTime(PROJECT_ID, baseDir)).toBeNull();
  });

  it("returns null for empty file", () => {
    writeFileSync(join(projectDir, "observations.jsonl"), "", "utf-8");
    expect(getLastObservationTime(PROJECT_ID, baseDir)).toBeNull();
  });

  it("returns timestamp of last observation", () => {
    const ts = "2026-06-15T10:30:00.000Z";
    writeObservations(3, ts);
    const result = getLastObservationTime(PROJECT_ID, baseDir);
    expect(result).toBe(new Date(ts).getTime());
  });

  it("returns null for malformed last line", () => {
    writeFileSync(
      join(projectDir, "observations.jsonl"),
      "not-json\n",
      "utf-8"
    );
    expect(getLastObservationTime(PROJECT_ID, baseDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isWithinActiveHours
// ---------------------------------------------------------------------------

describe("isWithinActiveHours", () => {
  it("returns true when current hour is within range", () => {
    // Set local time to 14:00 using local Date constructor (not UTC)
    vi.setSystemTime(new Date(2026, 0, 1, 14, 0, 0));
    expect(isWithinActiveHours(8, 23)).toBe(true);
  });

  it("returns true at the start hour boundary", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));
    expect(isWithinActiveHours(8, 23)).toBe(true);
  });

  it("returns false before start hour", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 6, 0, 0));
    expect(isWithinActiveHours(8, 23)).toBe(false);
  });

  it("returns false at the end hour (exclusive)", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0, 0));
    expect(isWithinActiveHours(8, 23)).toBe(false);
  });

  it("returns false after end hour", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
    expect(isWithinActiveHours(8, 23)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSkipReason
// ---------------------------------------------------------------------------

describe("getSkipReason", () => {
  it("returns in_progress when analysis is already running", () => {
    vi.mocked(isAnalysisRunning).mockReturnValue(true);
    writeObservations(10);
    expect(getSkipReason(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, baseDir)).toBe(
      "in_progress"
    );
  });

  it("returns insufficient_observations when count is below threshold", () => {
    writeObservations(2);
    const config = { ...ALWAYS_ACTIVE_CONFIG, min_observations_to_analyze: 5 };
    expect(getSkipReason(config, PROJECT_ID, baseDir)).toBe(
      "insufficient_observations"
    );
  });

  it("returns insufficient_observations when observations file is missing", () => {
    const config = { ...ALWAYS_ACTIVE_CONFIG, min_observations_to_analyze: 1 };
    expect(getSkipReason(config, PROJECT_ID, baseDir)).toBe(
      "insufficient_observations"
    );
  });

  it("returns outside_active_hours when hour is before start", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 6, 0, 0)); // 06:00
    writeObservations(10);
    const config = {
      ...ALWAYS_ACTIVE_CONFIG,
      active_hours_start: 8,
      active_hours_end: 23,
    };
    expect(getSkipReason(config, PROJECT_ID, baseDir)).toBe(
      "outside_active_hours"
    );
  });

  it("returns user_idle when last observation is too old", () => {
    const baseTime = new Date(2026, 0, 1, 12, 0, 0);
    vi.setSystemTime(baseTime);
    // Last observation 31 minutes ago
    const oldTs = new Date(baseTime.getTime() - 31 * 60 * 1000).toISOString();
    writeObservations(10, oldTs);
    const config = { ...ALWAYS_ACTIVE_CONFIG, max_idle_seconds: 1800 }; // 30 min
    expect(getSkipReason(config, PROJECT_ID, baseDir)).toBe("user_idle");
  });

  it("does not skip when last observation is within idle threshold", () => {
    const baseTime = new Date(2026, 0, 1, 12, 0, 0);
    vi.setSystemTime(baseTime);
    // Last observation 10 minutes ago - within 30 min threshold
    const recentTs = new Date(baseTime.getTime() - 10 * 60 * 1000).toISOString();
    writeObservations(10, recentTs);
    const config = { ...ALWAYS_ACTIVE_CONFIG, max_idle_seconds: 1800 };
    expect(getSkipReason(config, PROJECT_ID, baseDir)).toBeNull();
  });

  it("returns null when all conditions pass", () => {
    writeObservations(10);
    expect(getSkipReason(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, baseDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startAnalyzerTimer / stopAnalyzerTimer
// ---------------------------------------------------------------------------

describe("startAnalyzerTimer / stopAnalyzerTimer", () => {
  it("timer is not running before start", () => {
    expect(isTimerRunning()).toBe(false);
  });

  it("timer is running after startAnalyzerTimer", () => {
    startAnalyzerTimer(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, vi.fn(), baseDir);
    expect(isTimerRunning()).toBe(true);
  });

  it("timer is stopped after stopAnalyzerTimer", () => {
    startAnalyzerTimer(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, vi.fn(), baseDir);
    stopAnalyzerTimer();
    expect(isTimerRunning()).toBe(false);
  });

  it("replaces existing timer when started again", () => {
    const cb1 = vi.fn().mockResolvedValue(undefined);
    const cb2 = vi.fn().mockResolvedValue(undefined);
    startAnalyzerTimer(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, cb1, baseDir);
    startAnalyzerTimer(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, cb2, baseDir);
    expect(isTimerRunning()).toBe(true);
  });

  it("calls onAnalyze when tick conditions are met", async () => {
    writeObservations(10);
    const onAnalyze = vi.fn().mockResolvedValue(undefined);
    startAnalyzerTimer(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, onAnalyze, baseDir);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000); // 5 minutes
    expect(onAnalyze).toHaveBeenCalledOnce();
  });

  it("does not call onAnalyze when observations are insufficient", async () => {
    writeObservations(1); // below min_observations_to_analyze of 5
    const onAnalyze = vi.fn().mockResolvedValue(undefined);
    startAnalyzerTimer(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, onAnalyze, baseDir);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it("does not call onAnalyze when analysis is already in progress", async () => {
    vi.mocked(isAnalysisRunning).mockReturnValue(true);
    writeObservations(10);
    const onAnalyze = vi.fn().mockResolvedValue(undefined);
    startAnalyzerTimer(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, onAnalyze, baseDir);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  it("calls onAnalyze multiple times on repeated ticks", async () => {
    writeObservations(10);
    const onAnalyze = vi.fn().mockResolvedValue(undefined);
    startAnalyzerTimer(ALWAYS_ACTIVE_CONFIG, PROJECT_ID, onAnalyze, baseDir);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000); // 3 intervals of 5 min
    expect(onAnalyze).toHaveBeenCalledTimes(3);
  });
});
