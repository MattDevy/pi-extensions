/**
 * Project detection via git remote URL hashing.
 * Scopes observations and instincts to the correct project.
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProjectEntry } from "./types.js";

const GLOBAL_PROJECT_ID = "global";
const HASH_LENGTH = 12;

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").substring(0, HASH_LENGTH);
}

/**
 * Detect the current project by inspecting git remote URL.
 *
 * Resolution order:
 *   1. git remote get-url origin  -> hash of remote URL
 *   2. git rev-parse --show-toplevel -> hash of repo root path
 *   3. fallback to project ID "global"
 */
export async function detectProject(
  pi: ExtensionAPI,
  cwd: string
): Promise<ProjectEntry> {
  const now = new Date().toISOString();
  const name = basename(cwd);

  // 1. Try remote URL
  const remoteResult = await pi.exec("git", ["remote", "get-url", "origin"], { cwd });
  if (remoteResult.code === 0) {
    const remote = remoteResult.stdout.trim();
    return {
      id: hashString(remote),
      name,
      root: cwd,
      remote,
      created_at: now,
      last_seen: now,
    };
  }

  // 2. Fallback: repo root path (no remote)
  const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (rootResult.code === 0) {
    const root = rootResult.stdout.trim();
    return {
      id: hashString(root),
      name,
      root,
      remote: "",
      created_at: now,
      last_seen: now,
    };
  }

  // 3. Fallback: not in a git repo
  return {
    id: GLOBAL_PROJECT_ID,
    name,
    root: cwd,
    remote: "",
    created_at: now,
    last_seen: now,
  };
}
