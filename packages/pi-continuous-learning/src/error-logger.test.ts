import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logError, logWarning, logInfo, getLogPath } from "./error-logger.js";

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `pi-cl-error-logger-test-${Date.now()}-${Math.random()}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("getLogPath", () => {
  it("returns path inside project dir", () => {
    const logPath = getLogPath("proj123", "/base");
    expect(logPath).toBe("/base/projects/proj123/analyzer.log");
  });
});

describe("logError", () => {
  let baseDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = makeTmpDir();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("writes error to analyzer.log with timestamp and context", () => {
    logError("proj1", "session_start", new Error("boom"), baseDir);

    const logPath = getLogPath("proj1", baseDir);
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    expect(content).toMatch(/\[.*T.*Z\]/); // ISO timestamp
    expect(content).toContain("[session_start]");
    expect(content).toContain("Error: boom");
  });

  it("includes stack trace when error has a stack", () => {
    const err = new Error("with stack");
    logError("proj1", "ctx", err, baseDir);

    const content = readFileSync(getLogPath("proj1", baseDir), "utf-8");
    expect(content).toContain("Stack:");
  });

  it("creates log directory if it does not exist", () => {
    const logPath = getLogPath("newproj", baseDir);
    expect(existsSync(logPath)).toBe(false);

    logError("newproj", "ctx", "some error", baseDir);
    expect(existsSync(logPath)).toBe(true);
  });

  it("appends multiple entries without overwriting", () => {
    logError("proj2", "ctx1", new Error("first"), baseDir);
    logError("proj2", "ctx2", new Error("second"), baseDir);

    const content = readFileSync(getLogPath("proj2", baseDir), "utf-8");
    expect(content).toContain("first");
    expect(content).toContain("second");
  });

  it("handles non-Error objects as string", () => {
    logError("proj3", "ctx", "plain string error", baseDir);

    const content = readFileSync(getLogPath("proj3", baseDir), "utf-8");
    expect(content).toContain("plain string error");
  });

  it("falls back to console.warn when projectId is null", () => {
    logError(null, "ctx", new Error("no project"), baseDir);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toContain("no project");
  });

  it("falls back to console.warn when log write fails", () => {
    // Use a path that cannot be written to (root-owned dir)
    logError(
      "proj4",
      "ctx",
      new Error("write fail"),
      "/no-such-root-dir-that-exists",
    );

    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("does not throw on any error condition", () => {
    expect(() => logError(null, "ctx", new Error("err"))).not.toThrow();
    expect(() => logError("proj5", "ctx", undefined, baseDir)).not.toThrow();
    expect(() => logError("proj6", "ctx", null, baseDir)).not.toThrow();
  });
});

describe("logWarning", () => {
  let baseDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = makeTmpDir();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("writes warning entry with Warning: prefix", () => {
    logWarning("proj1", "analyzer", "subprocess stderr here", baseDir);

    const content = readFileSync(getLogPath("proj1", baseDir), "utf-8");
    expect(content).toContain("Warning: subprocess stderr here");
    expect(content).toContain("[analyzer]");
  });

  it("falls back to console.warn when projectId is null", () => {
    logWarning(null, "ctx", "no project warn");

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toContain("no project warn");
  });

  it("does not throw on any condition", () => {
    expect(() => logWarning(null, "ctx", "msg")).not.toThrow();
    expect(() =>
      logWarning("proj2", "ctx", "msg", "/nonexistent/root/path"),
    ).not.toThrow();
  });
});

describe("logInfo", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = makeTmpDir();
  });

  it("writes info entry with Info: prefix", () => {
    logInfo("proj1", "analyzer-runner", "Analysis started", baseDir);

    const content = readFileSync(getLogPath("proj1", baseDir), "utf-8");
    expect(content).toContain("Info: Analysis started");
    expect(content).toContain("[analyzer-runner]");
  });

  it("includes timestamp in ISO format", () => {
    logInfo("proj1", "ctx", "test message", baseDir);

    const content = readFileSync(getLogPath("proj1", baseDir), "utf-8");
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("appends multiple entries without overwriting", () => {
    logInfo("proj1", "ctx", "first", baseDir);
    logInfo("proj1", "ctx", "second", baseDir);

    const content = readFileSync(getLogPath("proj1", baseDir), "utf-8");
    expect(content).toContain("first");
    expect(content).toContain("second");
  });

  it("creates log directory if it does not exist", () => {
    const logPath = getLogPath("newproj", baseDir);
    expect(existsSync(logPath)).toBe(false);

    logInfo("newproj", "ctx", "hello", baseDir);
    expect(existsSync(logPath)).toBe(true);
  });

  it("silently does nothing when projectId is null", () => {
    expect(() => logInfo(null, "ctx", "msg")).not.toThrow();
  });

  it("does not throw on write failure", () => {
    expect(() =>
      logInfo("proj2", "ctx", "msg", "/nonexistent/root/path"),
    ).not.toThrow();
  });
});
