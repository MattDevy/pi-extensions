/**
 * /instinct-promote command for pi-continuous-learning.
 * Promotes project-scoped instincts to global scope.
 *
 * With an ID argument: promotes that specific project instinct to global.
 * Without an ID: auto-promotes all qualifying instincts
 *   (confidence >= 0.8, present in 2+ projects).
 */

import { mkdirSync } from "node:fs";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Instinct } from "./types.js";
import {
  loadProjectInstincts,
  loadGlobalInstincts,
  saveInstinct,
  listInstincts,
} from "./instinct-store.js";
import {
  getGlobalInstinctsDir,
  getProjectInstinctsDir,
  getProjectsRegistryPath,
  getBaseDir,
} from "./storage.js";
import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMMAND_NAME = "instinct-promote";

/** Minimum confidence to qualify for auto-promotion. */
export const AUTO_PROMOTE_MIN_CONFIDENCE = 0.8;

/** Minimum number of distinct projects an instinct must appear in for auto-promotion. */
export const AUTO_PROMOTE_MIN_PROJECTS = 2;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Builds a promoted copy of the instinct with scope set to global and
 * project-specific fields removed.
 * Does NOT mutate the original.
 */
export function toGlobalInstinct(instinct: Instinct): Instinct {
  const promoted: Instinct = {
    ...instinct,
    scope: "global",
    updated_at: new Date().toISOString(),
  };
  // Remove project-specific fields
  delete (promoted as Partial<Instinct>).project_id;
  delete (promoted as Partial<Instinct>).project_name;
  return promoted;
}

// ---------------------------------------------------------------------------
// Project registry reading
// ---------------------------------------------------------------------------

/**
 * Returns all known project IDs from the projects.json registry.
 */
export function getKnownProjectIds(baseDir: string): string[] {
  const registryPath = getProjectsRegistryPath(baseDir);
  if (!existsSync(registryPath)) return [];
  try {
    const raw = readFileSync(registryPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.keys(parsed);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Manual promotion
// ---------------------------------------------------------------------------

/**
 * Promotes a single project instinct to global personal/ by ID.
 * Returns the promoted instinct, or null if not found.
 */
export function promoteById(
  id: string,
  projectId: string,
  baseDir: string,
): Instinct | null {
  const projectInstincts = loadProjectInstincts(projectId, baseDir);
  const found = projectInstincts.find((i) => i.id === id);
  if (!found) return null;

  const globalDir = getGlobalInstinctsDir("personal", baseDir);
  mkdirSync(globalDir, { recursive: true });

  const promoted = toGlobalInstinct(found);
  saveInstinct(promoted, globalDir);
  return promoted;
}

// ---------------------------------------------------------------------------
// Auto-promotion
// ---------------------------------------------------------------------------

/**
 * Finds instinct IDs that appear in at least minProjects distinct projects.
 * Returns a map of id -> array of matching instincts across projects.
 */
export function findCrossProjectInstincts(
  projectIds: string[],
  baseDir: string,
): Map<string, Instinct[]> {
  const byId = new Map<string, Instinct[]>();

  for (const projectId of projectIds) {
    const personalDir = getProjectInstinctsDir(projectId, "personal", baseDir);
    const instincts = listInstincts(personalDir);
    for (const instinct of instincts) {
      const existing = byId.get(instinct.id) ?? [];
      byId.set(instinct.id, [...existing, instinct]);
    }
  }

  return byId;
}

/**
 * Auto-promotes all qualifying instincts:
 *   - confidence >= AUTO_PROMOTE_MIN_CONFIDENCE
 *   - present in >= AUTO_PROMOTE_MIN_PROJECTS distinct projects
 * Already-global instincts (same ID in global personal/) are skipped.
 *
 * Returns the list of promoted instincts.
 */
export function autoPromoteInstincts(baseDir: string): Instinct[] {
  const projectIds = getKnownProjectIds(baseDir);
  if (projectIds.length < AUTO_PROMOTE_MIN_PROJECTS) return [];

  const crossProject = findCrossProjectInstincts(projectIds, baseDir);

  const existingGlobal = loadGlobalInstincts(baseDir);
  const existingGlobalIds = new Set(existingGlobal.map((i) => i.id));

  const globalDir = getGlobalInstinctsDir("personal", baseDir);
  mkdirSync(globalDir, { recursive: true });

  const promoted: Instinct[] = [];

  for (const [id, instances] of crossProject) {
    if (instances.length < AUTO_PROMOTE_MIN_PROJECTS) continue;

    // Use the highest-confidence instance as the canonical one
    const sorted = [...instances].sort((a, b) => b.confidence - a.confidence);
    const best = sorted[0];
    if (!best) continue;

    if (best.confidence < AUTO_PROMOTE_MIN_CONFIDENCE) continue;
    if (existingGlobalIds.has(id)) continue;

    const globalInstinct = toGlobalInstinct(best);
    saveInstinct(globalInstinct, globalDir);
    promoted.push(globalInstinct);
  }

  return promoted;
}

// ---------------------------------------------------------------------------
// handleInstinctPromote
// ---------------------------------------------------------------------------

/**
 * Command handler for /instinct-promote.
 * With an ID arg: promotes that specific instinct.
 * Without an ID: auto-promotes qualifying instincts.
 */
export async function handleInstinctPromote(
  args: string,
  ctx: ExtensionCommandContext,
  projectId?: string | null,
  baseDir?: string,
): Promise<void> {
  const effectiveBase = baseDir ?? getBaseDir();
  const id = args.trim();

  if (id.length > 0) {
    // Manual promotion by ID
    if (projectId == null) {
      ctx.ui.notify(
        "Cannot promote by ID: no active project detected.",
        "error",
      );
      return;
    }

    const promoted = promoteById(id, projectId, effectiveBase);
    if (!promoted) {
      ctx.ui.notify(
        `Instinct "${id}" not found in project instincts.`,
        "error",
      );
      return;
    }

    ctx.ui.notify(
      `Promoted instinct "${promoted.id}" ("${promoted.title}") to global scope.`,
      "info",
    );
    return;
  }

  // Auto-promotion
  const promoted = autoPromoteInstincts(effectiveBase);

  if (promoted.length === 0) {
    ctx.ui.notify(
      `No instincts qualify for auto-promotion (confidence >= ${AUTO_PROMOTE_MIN_CONFIDENCE}, present in ${AUTO_PROMOTE_MIN_PROJECTS}+ projects).`,
      "info",
    );
    return;
  }

  const lines = [
    `Auto-promoted ${promoted.length} instinct${promoted.length !== 1 ? "s" : ""} to global scope:`,
    ...promoted.map(
      (i) => `  - ${i.id} (${i.confidence.toFixed(2)}): ${i.title}`,
    ),
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}
