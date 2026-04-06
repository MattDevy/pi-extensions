/**
 * /instinct-projects command for pi-continuous-learning.
 * Displays all known projects with their instinct counts and last seen dates.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { ProjectEntry } from "./types.js";
import {
  getProjectsRegistryPath,
  getProjectInstinctsDir,
  getBaseDir,
} from "./storage.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMMAND_NAME = "instinct-projects";
const NO_PROJECTS_MSG = "No projects found.";

// ---------------------------------------------------------------------------
// Data loading helpers
// ---------------------------------------------------------------------------

/**
 * Reads the projects.json registry. Returns an empty record on missing/invalid file.
 */
export function readProjectsRegistry(
  baseDir?: string,
): Record<string, ProjectEntry> {
  const registryPath = getProjectsRegistryPath(baseDir ?? getBaseDir());
  if (!existsSync(registryPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(registryPath, "utf-8")) as Record<
      string,
      ProjectEntry
    >;
  } catch {
    return {};
  }
}

/**
 * Counts .md files in a project's personal instincts directory.
 * Returns 0 if the directory does not exist.
 */
export function countProjectInstincts(
  projectId: string,
  baseDir?: string,
): number {
  const dir = getProjectInstinctsDir(
    projectId,
    "personal",
    baseDir ?? getBaseDir(),
  );
  if (!existsSync(dir)) {
    return 0;
  }
  try {
    const entries = readdirSync(dir);
    return entries.filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Formats an ISO 8601 date string as a human-readable local date.
 * Falls back to the raw string on parse failure.
 */
export function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString();
  } catch {
    return isoDate;
  }
}

/**
 * Formats the full projects output string from a registry.
 * Returns a fallback message when no projects exist.
 */
export function formatProjectsOutput(
  registry: Record<string, ProjectEntry>,
  baseDir?: string,
): string {
  const entries = Object.values(registry);
  if (entries.length === 0) {
    return NO_PROJECTS_MSG;
  }

  const sorted = [...entries].sort((a, b) =>
    b.last_seen.localeCompare(a.last_seen),
  );

  const lines: string[] = ["=== Known Projects ===", ""];

  for (const project of sorted) {
    const count = countProjectInstincts(project.id, baseDir);
    const lastSeen = formatDate(project.last_seen);
    lines.push(`${project.name} (${project.id})`);
    lines.push(`  Instincts: ${count}  |  Last seen: ${lastSeen}`);
    lines.push("");
  }

  const total = entries.length;
  lines.push(`Total: ${total} project${total !== 1 ? "s" : ""}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Command handler for /instinct-projects.
 * Reads the project registry, counts instincts per project, and displays results.
 */
export async function handleInstinctProjects(
  _args: string,
  ctx: ExtensionCommandContext,
  baseDir?: string,
): Promise<void> {
  const registry = readProjectsRegistry(baseDir);
  const output = formatProjectsOutput(registry, baseDir);
  ctx.ui.notify(output, "info");
}
