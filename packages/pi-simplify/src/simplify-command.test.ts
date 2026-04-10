import { describe, it, expect, vi } from "vitest";
import { handleSimplifyCommand, parseArgs, COMMAND_NAME } from "./simplify-command.js";

describe("COMMAND_NAME", () => {
  it("is 'simplify'", () => {
    expect(COMMAND_NAME).toBe("simplify");
  });
});

describe("parseArgs", () => {
  it("returns defaults for empty string", () => {
    expect(parseArgs("")).toEqual({ files: [], ref: "HEAD", staged: false });
  });

  it("returns defaults for whitespace-only string", () => {
    expect(parseArgs("   ")).toEqual({ files: [], ref: "HEAD", staged: false });
  });

  it("parses --staged flag", () => {
    expect(parseArgs("--staged")).toEqual({ files: [], ref: "HEAD", staged: true });
  });

  it("parses --ref=<value> flag", () => {
    expect(parseArgs("--ref=main")).toEqual({ files: [], ref: "main", staged: false });
  });

  it("parses file paths", () => {
    expect(parseArgs("src/a.ts src/b.ts")).toEqual({
      files: ["src/a.ts", "src/b.ts"],
      ref: "HEAD",
      staged: false,
    });
  });

  it("parses mix of flags and file paths", () => {
    expect(parseArgs("--staged src/a.ts")).toEqual({
      files: ["src/a.ts"],
      ref: "HEAD",
      staged: true,
    });
  });

  it("parses --ref with file paths", () => {
    expect(parseArgs("--ref=develop src/foo.ts")).toEqual({
      files: ["src/foo.ts"],
      ref: "develop",
      staged: false,
    });
  });
});

describe("handleSimplifyCommand", () => {
  function makeMocks(changedFiles: string[]) {
    const execResults: Record<string, { stdout: string; stderr: string; code: number }> = {};

    if (changedFiles.length > 0) {
      const stdout = changedFiles.map((f) => `M\t${f}`).join("\n") + "\n";
      execResults["diff --name-status HEAD"] = { stdout, stderr: "", code: 0 };
    }

    const pi = {
      exec: vi.fn((_cmd: string, args: string[]) => {
        const key = args.join(" ");
        for (const [pattern, result] of Object.entries(execResults)) {
          if (key.includes(pattern)) return Promise.resolve(result);
        }
        return Promise.resolve({ stdout: "", stderr: "", code: 1 });
      }),
      sendUserMessage: vi.fn(),
    } as unknown as Parameters<typeof handleSimplifyCommand>[2];

    const ctx = {
      cwd: "/project",
      ui: {
        notify: vi.fn(),
      },
    } as unknown as Parameters<typeof handleSimplifyCommand>[1];

    return { pi, ctx };
  }

  it("sends user message when changed files are found", async () => {
    const { pi, ctx } = makeMocks(["src/foo.ts"]);

    await handleSimplifyCommand("", ctx, pi);

    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const prompt = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(prompt).toContain("src/foo.ts");
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.any(String),
      { deliverAs: "followUp" },
    );
  });

  it("notifies user when no changed files found", async () => {
    const { pi, ctx } = makeMocks([]);

    await handleSimplifyCommand("", ctx, pi);

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("No changed files"),
      "info",
    );
  });

  it("uses explicit file paths from args", async () => {
    const { pi, ctx } = makeMocks([]);

    await handleSimplifyCommand("src/a.ts src/b.ts", ctx, pi);

    expect(pi.exec).not.toHaveBeenCalled();
    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
    const prompt = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("src/b.ts");
  });

  it("passes --staged to git diff", async () => {
    const pi = {
      exec: vi.fn(() => Promise.resolve({
        stdout: "M\tsrc/staged.ts\n",
        stderr: "",
        code: 0,
      })),
      sendUserMessage: vi.fn(),
    } as unknown as Parameters<typeof handleSimplifyCommand>[2];

    const ctx = {
      cwd: "/project",
      ui: { notify: vi.fn() },
    } as unknown as Parameters<typeof handleSimplifyCommand>[1];

    await handleSimplifyCommand("--staged", ctx, pi);

    expect(pi.exec).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-status", "--cached"],
      { cwd: "/project" },
    );
  });
});
