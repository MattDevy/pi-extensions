import { describe, it, expect, vi } from "vitest";
import { getChangedFiles } from "./git-diff.js";
import type { SimplifyOptions } from "./types.js";

function makePi(execResults: Record<string, { stdout: string; stderr: string; code: number }>) {
  return {
    exec: vi.fn((_cmd: string, args: string[]) => {
      const key = args.join(" ");
      for (const [pattern, result] of Object.entries(execResults)) {
        if (key.includes(pattern)) return Promise.resolve(result);
      }
      return Promise.resolve({ stdout: "", stderr: "", code: 1 });
    }),
  } as unknown as Parameters<typeof getChangedFiles>[0];
}

const defaultOptions: SimplifyOptions = { files: [], ref: "HEAD", staged: false };

describe("getChangedFiles", () => {
  it("parses modified, added, renamed, and copied lines", async () => {
    const pi = makePi({
      "diff --name-status HEAD": {
        stdout: "M\tsrc/foo.ts\nA\tsrc/bar.ts\nR100\tsrc/old.ts\tsrc/new.ts\nC100\tsrc/a.ts\tsrc/b.ts\n",
        stderr: "",
        code: 0,
      },
    });

    const files = await getChangedFiles(pi, "/project", defaultOptions);

    expect(files).toEqual([
      { path: "src/foo.ts", status: "modified" },
      { path: "src/bar.ts", status: "added" },
      { path: "src/new.ts", status: "renamed" },
      { path: "src/b.ts", status: "copied" },
    ]);
  });

  it("filters out deleted files", async () => {
    const pi = makePi({
      "diff --name-status HEAD": {
        stdout: "M\tsrc/keep.ts\nD\tsrc/gone.ts\n",
        stderr: "",
        code: 0,
      },
    });

    const files = await getChangedFiles(pi, "/project", defaultOptions);

    expect(files).toEqual([{ path: "src/keep.ts", status: "modified" }]);
  });

  it("falls back to HEAD~1 when HEAD diff is empty", async () => {
    const pi = makePi({
      "diff --name-status HEAD~1": {
        stdout: "M\tsrc/recent.ts\n",
        stderr: "",
        code: 0,
      },
    });

    const files = await getChangedFiles(pi, "/project", defaultOptions);

    expect(files).toEqual([{ path: "src/recent.ts", status: "modified" }]);
  });

  it("returns empty array when both HEAD and HEAD~1 diffs are empty", async () => {
    const pi = makePi({});

    const files = await getChangedFiles(pi, "/project", defaultOptions);

    expect(files).toEqual([]);
  });

  it("uses --cached when staged option is true", async () => {
    const pi = makePi({
      "diff --name-status --cached": {
        stdout: "M\tsrc/staged.ts\n",
        stderr: "",
        code: 0,
      },
    });

    const options: SimplifyOptions = { files: [], ref: "HEAD", staged: true };
    const files = await getChangedFiles(pi, "/project", options);

    expect(files).toEqual([{ path: "src/staged.ts", status: "modified" }]);
    expect(pi.exec).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-status", "--cached"],
      { cwd: "/project" },
    );
  });

  it("uses custom ref when provided", async () => {
    const pi = makePi({
      "diff --name-status main": {
        stdout: "A\tsrc/feature.ts\n",
        stderr: "",
        code: 0,
      },
    });

    const options: SimplifyOptions = { files: [], ref: "main", staged: false };
    const files = await getChangedFiles(pi, "/project", options);

    expect(files).toEqual([{ path: "src/feature.ts", status: "added" }]);
  });

  it("returns explicit file list directly without running git", async () => {
    const pi = makePi({});

    const options: SimplifyOptions = {
      files: ["src/a.ts", "src/b.ts"],
      ref: "HEAD",
      staged: false,
    };
    const files = await getChangedFiles(pi, "/project", options);

    expect(files).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "modified" },
    ]);
    expect(pi.exec).not.toHaveBeenCalled();
  });

  it("handles blank lines in git output", async () => {
    const pi = makePi({
      "diff --name-status HEAD": {
        stdout: "M\tsrc/foo.ts\n\n\nA\tsrc/bar.ts\n",
        stderr: "",
        code: 0,
      },
    });

    const files = await getChangedFiles(pi, "/project", defaultOptions);

    expect(files).toEqual([
      { path: "src/foo.ts", status: "modified" },
      { path: "src/bar.ts", status: "added" },
    ]);
  });
});
