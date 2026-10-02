import { describe, it, expect, vi } from "vitest";
import registerExtension from "./index.js";

function makePi() {
  return {
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    on: vi.fn(),
  } as unknown as Parameters<typeof registerExtension>[0];
}

describe("pi-simplify extension", () => {
  it("registers the simplify command", () => {
    const pi = makePi();

    registerExtension(pi);

    expect(pi.registerCommand).toHaveBeenCalledOnce();
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "simplify",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
    );
  });

  it("registers the simplify tool", () => {
    const pi = makePi();

    registerExtension(pi);

    expect(pi.registerTool).toHaveBeenCalledOnce();
    expect(pi.registerTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "simplify",
        parameters: expect.any(Object),
        execute: expect.any(Function),
      }),
    );
  });

  it("does not register any event handlers", () => {
    const pi = makePi();

    registerExtension(pi);

    expect(pi.on).not.toHaveBeenCalled();
  });
});
