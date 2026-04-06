/**
 * Tests for the extension entry point (US-032).
 * Verifies all event handlers and slash commands are registered.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { COMMAND_NAME as STATUS_CMD } from "./instinct-status.js";
import { COMMAND_NAME as EXPORT_CMD } from "./instinct-export.js";
import { COMMAND_NAME as IMPORT_CMD } from "./instinct-import.js";
import { COMMAND_NAME as PROMOTE_CMD } from "./instinct-promote.js";
import { COMMAND_NAME as EVOLVE_CMD } from "./instinct-evolve.js";
import { COMMAND_NAME as PROJECTS_CMD } from "./instinct-projects.js";
import { COMMAND_NAME as GRADUATE_CMD } from "./instinct-graduate.js";
import { COMMAND_NAME as DREAM_CMD } from "./instinct-dream.js";
import extension from "./index.js";

/** Builds a minimal mock ExtensionAPI sufficient for registration checks. */
function makeMockPi(): ExtensionAPI {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    exec: vi.fn(),
  } as unknown as ExtensionAPI;
}

describe("extension entry point - registrations", () => {
  let pi: ExtensionAPI;

  beforeEach(() => {
    pi = makeMockPi();
    extension(pi);
  });

  it("exports a default function", () => {
    expect(typeof extension).toBe("function");
  });

  it("registers exactly 12 event handlers", () => {
    expect(vi.mocked(pi.on)).toHaveBeenCalledTimes(12);
  });

  it("registers session_start handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("session_start");
  });

  it("registers session_shutdown handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("session_shutdown");
  });

  it("registers before_agent_start handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("before_agent_start");
  });

  it("registers agent_start handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("agent_start");
  });

  it("registers agent_end handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("agent_end");
  });

  it("registers tool_execution_start handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("tool_execution_start");
  });

  it("registers tool_execution_end handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("tool_execution_end");
  });

  it("registers turn_start handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("turn_start");
  });

  it("registers turn_end handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("turn_end");
  });

  it("registers user_bash handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("user_bash");
  });

  it("registers session_compact handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("session_compact");
  });

  it("registers model_select handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("model_select");
  });

  it("registers exactly 8 slash commands", () => {
    expect(vi.mocked(pi.registerCommand)).toHaveBeenCalledTimes(8);
  });

  it("registers instinct-status command", () => {
    const names = vi.mocked(pi.registerCommand).mock.calls.map(([n]) => n);
    expect(names).toContain(STATUS_CMD);
  });

  it("registers instinct-export command", () => {
    const names = vi.mocked(pi.registerCommand).mock.calls.map(([n]) => n);
    expect(names).toContain(EXPORT_CMD);
  });

  it("registers instinct-import command", () => {
    const names = vi.mocked(pi.registerCommand).mock.calls.map(([n]) => n);
    expect(names).toContain(IMPORT_CMD);
  });

  it("registers instinct-promote command", () => {
    const names = vi.mocked(pi.registerCommand).mock.calls.map(([n]) => n);
    expect(names).toContain(PROMOTE_CMD);
  });

  it("registers instinct-evolve command", () => {
    const names = vi.mocked(pi.registerCommand).mock.calls.map(([n]) => n);
    expect(names).toContain(EVOLVE_CMD);
  });

  it("registers instinct-projects command", () => {
    const names = vi.mocked(pi.registerCommand).mock.calls.map(([n]) => n);
    expect(names).toContain(PROJECTS_CMD);
  });

  it("registers instinct-graduate command", () => {
    const names = vi.mocked(pi.registerCommand).mock.calls.map(([n]) => n);
    expect(names).toContain(GRADUATE_CMD);
  });

  it("registers instinct-dream command", () => {
    const names = vi.mocked(pi.registerCommand).mock.calls.map(([n]) => n);
    expect(names).toContain(DREAM_CMD);
  });

  it("each registered command has a handler function", () => {
    const calls = vi.mocked(pi.registerCommand).mock.calls;
    for (const [, opts] of calls) {
      expect(typeof opts.handler).toBe("function");
    }
  });

  it("each registered command has a description string", () => {
    const calls = vi.mocked(pi.registerCommand).mock.calls;
    for (const [, opts] of calls) {
      expect(typeof opts.description).toBe("string");
      expect((opts.description ?? "").length).toBeGreaterThan(0);
    }
  });

  it("returns void (no return value)", () => {
    const pi2 = makeMockPi();
    const result = extension(pi2);
    expect(result).toBeUndefined();
  });
});
