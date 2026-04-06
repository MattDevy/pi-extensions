import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AnalyzeLogger,
  type ProjectRunStats,
  type RunSummary,
} from "./analyze-logger.js";

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `pi-cl-analyze-logger-test-${Date.now()}-${Math.random()}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeLogger(dir: string): { logger: AnalyzeLogger; logPath: string } {
  const logPath = join(dir, "analyzer.log");
  const logger = new AnalyzeLogger(logPath);
  return { logger, logPath };
}

function readLines(path: string): unknown[] {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

const SAMPLE_PROJECT_STATS: ProjectRunStats = {
  project_id: "abc123",
  project_name: "test-project",
  duration_ms: 3200,
  observations_processed: 42,
  observations_total: 100,
  instincts_created: 2,
  instincts_updated: 1,
  instincts_deleted: 0,
  tokens_input: 1500,
  tokens_output: 800,
  tokens_cache_read: 200,
  tokens_cache_write: 100,
  tokens_total: 2600,
  cost_usd: 0.0032,
  model: "claude-haiku-4-5",
};

describe("AnalyzeLogger", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  describe("basic logging", () => {
    it("writes JSON lines with timestamp and level", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.info("hello world");

      const entries = readLines(logPath);
      expect(entries).toHaveLength(1);

      const entry = entries[0] as Record<string, unknown>;
      expect(entry.level).toBe("info");
      expect(entry.message).toBe("hello world");
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("includes extra data fields in log entry", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.info("test", { foo: "bar", count: 5 });

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.foo).toBe("bar");
      expect(entry.count).toBe(5);
    });

    it("appends multiple entries without overwriting", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.info("first");
      logger.warn("second");
      logger.error("third");

      const entries = readLines(logPath);
      expect(entries).toHaveLength(3);
      expect((entries[0] as Record<string, unknown>).level).toBe("info");
      expect((entries[1] as Record<string, unknown>).level).toBe("warn");
      expect((entries[2] as Record<string, unknown>).level).toBe("error");
    });

    it("creates log directory if it does not exist", () => {
      const nested = join(dir, "sub", "dir");
      const logPath = join(nested, "test.log");
      const logger = new AnalyzeLogger(logPath);
      logger.info("nested");

      expect(existsSync(logPath)).toBe(true);
    });
  });

  describe("error logging", () => {
    it("includes error message and stack for Error objects", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.error("something failed", new Error("boom"));

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.level).toBe("error");
      expect(entry.error_message).toBe("boom");
      expect(entry.error_stack).toMatch(/Error: boom/);
    });

    it("handles non-Error values", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.error("failed", "plain string error");

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.error_message).toBe("plain string error");
    });

    it("merges additional data with error data", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.error("failed", new Error("err"), { project_id: "x" });

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.error_message).toBe("err");
      expect(entry.project_id).toBe("x");
    });
  });

  describe("structured events", () => {
    it("logs run start with event type and project count", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.runStart(5);

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.event).toBe("run_start");
      expect(entry.project_count).toBe(5);
      expect(entry.pid).toBe(process.pid);
    });

    it("logs project skipped with reason", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.projectSkipped("abc", "my-proj", "no new observations");

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.event).toBe("project_skipped");
      expect(entry.project_id).toBe("abc");
      expect(entry.reason).toBe("no new observations");
    });

    it("logs project start with observation counts", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.projectStart("abc", "my-proj", 15, 100);

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.event).toBe("project_start");
      expect(entry.new_observations).toBe(15);
      expect(entry.total_observations).toBe(100);
    });

    it("logs project complete with full stats", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.projectComplete(SAMPLE_PROJECT_STATS);

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.event).toBe("project_complete");
      expect(entry.duration_ms).toBe(3200);
      expect(entry.tokens_total).toBe(2600);
      expect(entry.cost_usd).toBe(0.0032);
      expect(entry.instincts_created).toBe(2);
      expect(entry.instincts_updated).toBe(1);
      expect(entry.instincts_deleted).toBe(0);
      expect(entry.model).toBe("claude-haiku-4-5");
      // Human-readable message
      expect(entry.message).toContain("3.2s");
      expect(entry.message).toContain("$0.0032");
      expect(entry.message).toContain("+2");
    });

    it("logs project error with error details", () => {
      const { logger, logPath } = makeLogger(dir);
      logger.projectError("abc", "my-proj", new Error("timeout"));

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.event).toBe("project_error");
      expect(entry.error_message).toBe("timeout");
      expect(entry.project_id).toBe("abc");
    });

    it("logs run complete with aggregated summary", () => {
      const { logger, logPath } = makeLogger(dir);
      const summary: RunSummary = {
        total_duration_ms: 12500,
        projects_processed: 3,
        projects_skipped: 2,
        projects_errored: 1,
        projects_total: 6,
        total_tokens: 8000,
        total_cost_usd: 0.015,
        total_instincts_created: 4,
        total_instincts_updated: 2,
        total_instincts_deleted: 1,
        project_stats: [SAMPLE_PROJECT_STATS],
      };
      logger.runComplete(summary);

      const entry = readLines(logPath)[0] as Record<string, unknown>;
      expect(entry.event).toBe("run_complete");
      expect(entry.total_duration_ms).toBe(12500);
      expect(entry.projects_processed).toBe(3);
      expect(entry.total_cost_usd).toBe(0.015);
      expect(entry.message).toContain("12.5s");
      expect(entry.message).toContain("3/6");
    });
  });

  describe("getLogPath", () => {
    it("returns the configured log path", () => {
      const logPath = join(dir, "custom.log");
      const logger = new AnalyzeLogger(logPath);
      expect(logger.getLogPath()).toBe(logPath);
    });
  });

  describe("fallback to stderr", () => {
    it("writes to stderr when log file is not writable", () => {
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      const logger = new AnalyzeLogger("/no-such-root-dir/test.log");
      logger.info("fallback test");

      expect(stderrSpy).toHaveBeenCalledOnce();
      const output = stderrSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("fallback test");
      stderrSpy.mockRestore();
    });
  });

  describe("log rotation", () => {
    it("rotates log file when it exceeds max size", () => {
      const logPath = join(dir, "analyzer.log");
      // Create a file just over 10 MB
      const bigContent = "x".repeat(10 * 1024 * 1024 + 1);
      writeFileSync(logPath, bigContent, "utf-8");

      const logger = new AnalyzeLogger(logPath);
      logger.info("after rotation");

      // Old file should exist
      expect(existsSync(logPath + ".old")).toBe(true);
      // New file should have just the new entry
      const content = readFileSync(logPath, "utf-8");
      expect(content).toContain("after rotation");
      expect(content.length).toBeLessThan(1000);
    });
  });

  describe("never throws", () => {
    it("does not throw for any method call", () => {
      const logger = new AnalyzeLogger("/no-such-root-dir/test.log");
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      expect(() => logger.info("msg")).not.toThrow();
      expect(() => logger.warn("msg")).not.toThrow();
      expect(() => logger.error("msg", new Error("e"))).not.toThrow();
      expect(() => logger.runStart(1)).not.toThrow();
      expect(() => logger.projectSkipped("a", "b", "c")).not.toThrow();
      expect(() => logger.projectStart("a", "b", 1, 2)).not.toThrow();
      expect(() => logger.projectComplete(SAMPLE_PROJECT_STATS)).not.toThrow();
      expect(() => logger.projectError("a", "b", new Error("e"))).not.toThrow();

      stderrSpy.mockRestore();
    });
  });
});
