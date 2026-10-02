import { describe, it, expect, vi } from "vitest";
import { createSimplifyTool, TOOL_NAME, TOOL_PREAMBLE } from "./simplify-tool.js";

type ExecResult = { stdout: string; stderr: string; code: number };

function makePi(exec: (args: string[]) => ExecResult) {
  return {
    exec: vi.fn((_cmd: string, args: string[]) => Promise.resolve(exec(args))),
    sendUserMessage: vi.fn(),
  } as unknown as Parameters<typeof createSimplifyTool>[0];
}

const ctx = { cwd: "/project" };

describe("simplify tool", () => {
  it("exposes the tool contract", () => {
    const tool = createSimplifyTool(makePi(() => ({ stdout: "", stderr: "", code: 1 })));

    expect(TOOL_NAME).toBe("simplify");
    expect(tool.name).toBe("simplify");
    expect(tool.label).toEqual(expect.any(String));
    expect(tool.description).toEqual(expect.any(String));
    expect(tool.promptSnippet).toEqual(expect.any(String));
    expect(tool.promptGuidelines.join(" ")).toMatch(/re-run the relevant checks/);
    expect(tool.parameters).toBeDefined();
  });

  it("uses default options when no params are given", async () => {
    const pi = makePi((args) =>
      args.join(" ") === "diff --name-status HEAD"
        ? { stdout: "M\tsrc/foo.ts\n", stderr: "", code: 0 }
        : { stdout: "@@ -1 +3,2 @@\n", stderr: "", code: 0 },
    );
    const tool = createSimplifyTool(pi);

    await tool.execute("c1", {}, undefined, undefined, ctx);

    expect(pi.exec).toHaveBeenCalledWith("git", ["diff", "--name-status", "HEAD"], { cwd: "/project" });
  });

  it("maps files and ref params to git diff", async () => {
    const pi = makePi(() => ({ stdout: "@@ -1 +1 @@\n", stderr: "", code: 0 }));
    const tool = createSimplifyTool(pi);

    await tool.execute("c1", { files: ["src/a.ts"], ref: "main" }, undefined, undefined, ctx);

    expect(pi.exec).toHaveBeenCalledOnce();
    expect(pi.exec).toHaveBeenCalledWith(
      "git",
      ["diff", "--unified=0", "--no-ext-diff", "main", "--", "src/a.ts"],
      { cwd: "/project" },
    );
  });

  it("maps files and staged params to git diff", async () => {
    const pi = makePi(() => ({ stdout: "@@ -1 +1 @@\n", stderr: "", code: 0 }));
    const tool = createSimplifyTool(pi);

    await tool.execute("c1", { files: ["src/a.ts"], staged: true }, undefined, undefined, ctx);

    expect(pi.exec).toHaveBeenCalledOnce();
    expect(pi.exec).toHaveBeenCalledWith(
      "git",
      ["diff", "--unified=0", "--no-ext-diff", "--cached", "--", "src/a.ts"],
      { cwd: "/project" },
    );
  });

  it("passes ref to git diff when not staged", async () => {
    const pi = makePi(() => ({ stdout: "M\tsrc/foo.ts\n", stderr: "", code: 0 }));
    const tool = createSimplifyTool(pi);

    await tool.execute("c1", { ref: "main" }, undefined, undefined, ctx);

    expect(pi.exec).toHaveBeenCalledWith("git", ["diff", "--name-status", "main"], { cwd: "/project" });
  });

  it("rejects a ref that git would parse as an option", async () => {
    const pi = makePi(() => ({ stdout: "", stderr: "", code: 0 }));
    const tool = createSimplifyTool(pi);

    await expect(
      tool.execute("c1", { ref: "--output=/tmp/x" }, undefined, undefined, ctx),
    ).rejects.toThrow(/must not start with "-"/);
    expect(pi.exec).not.toHaveBeenCalled();
  });

  it("returns preamble, scope and instructions when changes are found", async () => {
    const pi = makePi((args) =>
      args.includes("--name-status")
        ? { stdout: "M\tsrc/foo.ts\n", stderr: "", code: 0 }
        : { stdout: "@@ -1 +3,2 @@\n", stderr: "", code: 0 },
    );
    const tool = createSimplifyTool(pi);

    const result = await tool.execute("c1", {}, undefined, undefined, ctx);
    const text = result.content[0]?.text ?? "";

    expect(text.startsWith(TOOL_PREAMBLE)).toBe(true);
    expect(text).toMatch(/not a completed review/);
    expect(text).toContain("src/foo.ts (modified; changed lines: 3-4)");
    expect(text).toContain("## Principles");
    expect(result.details).toEqual({
      found: true,
      files: [{ path: "src/foo.ts", status: "modified", changedLines: [{ start: 3, end: 4 }] }],
    });
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("reports explicitly when no changes are found", async () => {
    const pi = makePi(() => ({ stdout: "", stderr: "", code: 0 }));
    const tool = createSimplifyTool(pi);

    const result = await tool.execute("c1", {}, undefined, undefined, ctx);

    expect(result.content[0]?.text).toContain("No changed files found");
    expect(result.details).toEqual({ found: false, files: [] });
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });
});
