/**
 * Storage layout creation for pi-continuous-learning.
 * Creates the directory structure under ~/.pi/continuous-learning/
 * on first use, and maintains the projects.json registry.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ProjectEntry } from "./types.js";

export function getBaseDir(): string {
  return join(homedir(), ".pi", "continuous-learning");
}

export function getProjectDir(
  projectId: string,
  baseDir = getBaseDir(),
): string {
  return join(baseDir, "projects", projectId);
}

export function getObservationsPath(
  projectId: string,
  baseDir = getBaseDir(),
): string {
  return join(getProjectDir(projectId, baseDir), "observations.jsonl");
}

export function getArchiveDir(
  projectId: string,
  baseDir = getBaseDir(),
): string {
  return join(getProjectDir(projectId, baseDir), "observations.archive");
}

export function getProjectInstinctsDir(
  projectId: string,
  source: "personal" | "inherited",
  baseDir = getBaseDir(),
): string {
  return join(getProjectDir(projectId, baseDir), "instincts", source);
}

export function getGlobalInstinctsDir(
  source: "personal" | "inherited",
  baseDir = getBaseDir(),
): string {
  return join(baseDir, "instincts", source);
}

export function getProjectsRegistryPath(baseDir = getBaseDir()): string {
  return join(baseDir, "projects.json");
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function readProjectsRegistry(
  registryPath: string,
): Record<string, ProjectEntry> {
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
 * Ensures the full storage directory layout exists.
 * Idempotent - safe to call multiple times.
 *
 * @param project - Project entry with metadata
 * @param baseDir - Base directory (defaults to ~/.pi/continuous-learning/)
 */
export function ensureStorageLayout(
  project: ProjectEntry,
  baseDir = getBaseDir(),
): void {
  // Global instinct directories
  ensureDir(join(baseDir, "instincts", "personal"));
  ensureDir(join(baseDir, "instincts", "inherited"));

  // Project-scoped directories
  const projectDir = getProjectDir(project.id, baseDir);
  ensureDir(join(projectDir, "instincts", "personal"));
  ensureDir(join(projectDir, "instincts", "inherited"));
  ensureDir(join(projectDir, "observations.archive"));

  // Write project.json only if it does not yet exist
  const projectJsonPath = join(projectDir, "project.json");
  if (!existsSync(projectJsonPath)) {
    writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), "utf-8");
  }

  // Update projects.json registry (always updates the entry)
  const registryPath = getProjectsRegistryPath(baseDir);
  const registry = readProjectsRegistry(registryPath);
  const updated = { ...registry, [project.id]: project };
  writeFileSync(registryPath, JSON.stringify(updated, null, 2), "utf-8");
}
