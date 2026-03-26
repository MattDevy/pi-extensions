import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { detectProject } from "./project.js";

function makeHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").substring(0, 12);
}

function makeExecResult(code: number, stdout: string) {
  return { code, stdout, stderr: "", killed: false };
}

function makePi(execImpl: (...args: unknown[]) => unknown): ExtensionAPI {
  return { exec: vi.fn(execImpl) } as unknown as ExtensionAPI;
}

describe("detectProject", () => {
  it("returns hashed remote URL when git remote origin is available", async () => {
    const remote = "git@github.com:user/repo.git";
    const pi = makePi(() => Promise.resolve(makeExecResult(0, `${remote}\n`)));

    const result = await detectProject(pi, "/home/user/projects/myrepo");

    expect(result.id).toBe(makeHash(remote));
    expect(result.name).toBe("myrepo");
    expect(result.remote).toBe(remote);
    expect(result.root).toBe("/home/user/projects/myrepo");
    expect(result.created_at).toBeTruthy();
    expect(result.last_seen).toBeTruthy();
    expect(pi.exec).toHaveBeenCalledWith(
      "git",
      ["remote", "get-url", "origin"],
      { cwd: "/home/user/projects/myrepo" }
    );
  });

  it("falls back to hashed repo root when no remote exists", async () => {
    const repoRoot = "/home/user/projects/myrepo";
    const pi = makePi(
      vi.fn()
        .mockResolvedValueOnce(makeExecResult(128, "")) // remote fails
        .mockResolvedValueOnce(makeExecResult(0, `${repoRoot}\n`)) // show-toplevel ok
    );

    const result = await detectProject(pi, repoRoot);

    expect(result.id).toBe(makeHash(repoRoot));
    expect(result.remote).toBe("");
    expect(result.root).toBe(repoRoot);
    expect(result.name).toBe("myrepo");
  });

  it("falls back to global project ID when not in a git repo", async () => {
    const pi = makePi(() => Promise.resolve(makeExecResult(128, "")));

    const result = await detectProject(pi, "/tmp/notarepo");

    expect(result.id).toBe("global");
    expect(result.name).toBe("notarepo");
    expect(result.remote).toBe("");
    expect(result.root).toBe("/tmp/notarepo");
  });

  it("trims whitespace from remote URL before hashing", async () => {
    const remote = "https://github.com/org/project.git";
    const pi = makePi(() => Promise.resolve(makeExecResult(0, `  ${remote}  \n`)));

    const result = await detectProject(pi, "/some/project");

    expect(result.id).toBe(makeHash(remote));
    expect(result.remote).toBe(remote);
  });

  it("trims whitespace from repo root path before hashing", async () => {
    const repoRoot = "/home/user/projects/norepo";
    const pi = makePi(
      vi.fn()
        .mockResolvedValueOnce(makeExecResult(128, ""))
        .mockResolvedValueOnce(makeExecResult(0, `  ${repoRoot}  \n`))
    );

    const result = await detectProject(pi, repoRoot);

    expect(result.id).toBe(makeHash(repoRoot));
    expect(result.root).toBe(repoRoot);
  });
});
