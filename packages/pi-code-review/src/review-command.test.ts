import { describe, it, expect, vi } from "vitest";
import { handleReviewCommand, parseArgs, COMMAND_NAME } from "./review-command.js";

describe("COMMAND_NAME", () => {
  it("is 'review'", () => {
    expect(COMMAND_NAME).toBe("review");
  });
});

describe("parseArgs", () => {
  it("returns defaults for empty string", () => {
    expect(parseArgs("")).toEqual({ files: [], ref: "HEAD", staged: false });
  });

  it("parses --staged flag", () => {
    expect(parseArgs("--staged")).toEqual({ files: [], ref: "HEAD", staged: true });
  });

  it("parses --ref=<value>", () => {
    expect(parseArgs("--ref=main")).toEqual({ files: [], ref: "main", staged: false });
  });

  it("parses file paths", () => {
    expect(parseArgs("src/a.ts src/b.ts")).toEqual({
      files: ["src/a.ts", "src/b.ts"],
      ref: "HEAD",
      staged: false,
    });
  });

  it("parses mix of flags and paths", () => {
    expect(parseArgs("--staged src/a.ts")).toEqual({
      files: ["src/a.ts"],
      ref: "HEAD",
      staged: true,
    });
  });
});

describe("handleReviewCommand", () => {
  function makeMocks(options: {
    changedFiles?: string[];
    fileContents?: Record<string, string>;
    apiKey?: string | undefined;
    llmResponse?: string;
  }) {
    const {
      changedFiles = [],
      fileContents = {},
      apiKey = undefined,
      llmResponse = '{"findings": []}',
    } = options;

    const diffStdout = changedFiles.map((f) => `M\t${f}`).join("\n") + "\n";

    const pi = {
      exec: vi.fn((_cmd: string, args: string[]) => {
        if (args[0] === "diff") {
          if (changedFiles.length > 0) {
            return Promise.resolve({ stdout: diffStdout, stderr: "", code: 0 });
          }
          return Promise.resolve({ stdout: "", stderr: "", code: 1 });
        }
        // cat command for reading files
        const filePath = args[args.length - 1] ?? "";
        const content = fileContents[filePath] ?? "file content";
        return Promise.resolve({ stdout: content, stderr: "", code: 0 });
      }),
      sendUserMessage: vi.fn(),
    } as unknown as Parameters<typeof handleReviewCommand>[2];

    const ctx = {
      cwd: "/project",
      ui: { notify: vi.fn() },
      modelRegistry: {
        getApiKeyForProvider: vi.fn(() => Promise.resolve(apiKey)),
      },
    } as unknown as Parameters<typeof handleReviewCommand>[1];

    // Mock the complete function via the module
    const mockComplete = vi.fn(() =>
      Promise.resolve({
        content: [{ type: "text", text: llmResponse }],
      }),
    );

    return { pi, ctx, mockComplete };
  }

  it("notifies when no changed files found", async () => {
    const { pi, ctx } = makeMocks({});

    await handleReviewCommand("", ctx, pi);

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("No changed files"),
      "info",
    );
  });

  it("falls back to prompt-only when no API key", async () => {
    const { pi, ctx } = makeMocks({
      changedFiles: ["src/foo.ts"],
      apiKey: undefined,
    });

    await handleReviewCommand("", ctx, pi);

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const prompt = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("CRITICAL");
  });

  it("uses explicit file paths from args without git", async () => {
    const { pi, ctx } = makeMocks({ apiKey: undefined });

    await handleReviewCommand("src/a.ts src/b.ts", ctx, pi);

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const prompt = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("src/b.ts");
  });

  it("sends with deliverAs followUp", async () => {
    const { pi, ctx } = makeMocks({
      changedFiles: ["src/foo.ts"],
      apiKey: undefined,
    });

    await handleReviewCommand("", ctx, pi);

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.any(String),
      { deliverAs: "followUp" },
    );
  });
});
