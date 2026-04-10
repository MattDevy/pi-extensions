import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import extension from "./index.js";

function makeMockPi(): ExtensionAPI {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    exec: vi.fn(),
  } as unknown as ExtensionAPI;
}

describe("extension entry point", () => {
  let pi: ExtensionAPI;

  beforeEach(() => {
    pi = makeMockPi();
    extension(pi);
  });

  it("registers 5 event handlers", () => {
    expect(vi.mocked(pi.on)).toHaveBeenCalledTimes(5);
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

  it("registers tool_execution_end handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("tool_execution_end");
  });

  it("registers turn_end handler", () => {
    const events = vi.mocked(pi.on).mock.calls.map(([e]) => e);
    expect(events).toContain("turn_end");
  });

  it("registers 2 commands", () => {
    expect(vi.mocked(pi.registerCommand)).toHaveBeenCalledTimes(2);
  });

  it("registers tdd command", () => {
    const commands = vi.mocked(pi.registerCommand).mock.calls.map(([name]) => name);
    expect(commands).toContain("tdd");
  });

  it("registers tdd-status command", () => {
    const commands = vi.mocked(pi.registerCommand).mock.calls.map(([name]) => name);
    expect(commands).toContain("tdd-status");
  });
});
