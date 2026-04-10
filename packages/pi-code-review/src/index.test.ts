import { describe, it, expect, vi } from "vitest";
import registerExtension from "./index.js";

describe("pi-code-review extension", () => {
  function makePi() {
    return {
      on: vi.fn(),
      registerCommand: vi.fn(),
    } as unknown as Parameters<typeof registerExtension>[0];
  }

  it("registers the review command", () => {
    const pi = makePi();

    registerExtension(pi);

    expect(pi.registerCommand).toHaveBeenCalledOnce();
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "review",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
  });

  it("registers tool_execution_end handler", () => {
    const pi = makePi();

    registerExtension(pi);

    const calls = (pi.on as ReturnType<typeof vi.fn>).mock.calls;
    const events = calls.map((c) => c[0]);
    expect(events).toContain("tool_execution_end");
  });

  it("registers turn_end handler", () => {
    const pi = makePi();

    registerExtension(pi);

    const calls = (pi.on as ReturnType<typeof vi.fn>).mock.calls;
    const events = calls.map((c) => c[0]);
    expect(events).toContain("turn_end");
  });

  it("registers before_agent_start handler", () => {
    const pi = makePi();

    registerExtension(pi);

    const calls = (pi.on as ReturnType<typeof vi.fn>).mock.calls;
    const events = calls.map((c) => c[0]);
    expect(events).toContain("before_agent_start");
  });

  it("registers exactly 3 event handlers", () => {
    const pi = makePi();

    registerExtension(pi);

    expect(pi.on).toHaveBeenCalledTimes(3);
  });
});
