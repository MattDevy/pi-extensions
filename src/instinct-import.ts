/**
 * /instinct-import command for pi-continuous-learning.
 * Imports instincts from a JSON file into the inherited instincts directory.
 * Destination is determined by each instinct's scope field:
 *   - scope "project" -> projects/<id>/instincts/inherited/
 *   - scope "global"  -> instincts/inherited/
 */

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Instinct } from "./types.js";
import { saveInstinct, listInstincts } from "./instinct-store.js";
import {
  getProjectInstinctsDir,
  getGlobalInstinctsDir,
  getBaseDir,
} from "./storage.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMMAND_NAME = "instinct-import";

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQUIRED_FIELDS = [
  "id",
  "title",
  "trigger",
  "action",
  "confidence",
  "domain",
  "source",
  "scope",
  "created_at",
  "updated_at",
  "observation_count",
  "confirmed_count",
  "contradicted_count",
  "inactive_count",
] as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  index: number;
  reason: string;
}

/**
 * Validates a raw JSON object as an Instinct.
 * Returns an error string if invalid, null if valid.
 */
export function validateImportObject(
  obj: unknown,
  index: number
): ValidationError | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { index, reason: "not an object" };
  }

  const record = obj as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null) {
      return { index, reason: `missing required field "${field}"` };
    }
  }

  const id = String(record["id"]);
  if (!KEBAB_RE.test(id)) {
    return { index, reason: `invalid id "${id}" - must be kebab-case` };
  }

  return null;
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

export interface LoadResult {
  valid: Instinct[];
  invalid: ValidationError[];
}

/**
 * Reads and parses the import JSON file.
 * Returns valid instincts and validation errors separately.
 */
export function loadImportFile(filePath: string): LoadResult {
  const content = readFileSync(filePath, "utf-8");
  const parsed: unknown = JSON.parse(content);

  if (!Array.isArray(parsed)) {
    throw new Error("Import file must contain a JSON array of instinct objects.");
  }

  const valid: Instinct[] = [];
  const invalid: ValidationError[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const err = validateImportObject(parsed[i], i);
    if (err) {
      invalid.push(err);
    } else {
      valid.push(parsed[i] as Instinct);
    }
  }

  return { valid, invalid };
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export interface PartitionResult {
  toImport: Instinct[];
  duplicates: string[];
}

/**
 * Partitions instincts into those to import and those skipped as duplicates.
 * Checks existing inherited instincts in both project and global directories.
 */
export function partitionByDuplicates(
  instincts: Instinct[],
  projectId: string | null | undefined,
  baseDir: string
): PartitionResult {
  const existingIds = new Set<string>();

  const globalDir = getGlobalInstinctsDir("inherited", baseDir);
  for (const inst of listInstincts(globalDir)) {
    existingIds.add(inst.id);
  }

  if (projectId != null) {
    const projectDir = getProjectInstinctsDir(projectId, "inherited", baseDir);
    for (const inst of listInstincts(projectDir)) {
      existingIds.add(inst.id);
    }
  }

  const toImport: Instinct[] = [];
  const duplicates: string[] = [];

  for (const inst of instincts) {
    if (existingIds.has(inst.id)) {
      duplicates.push(inst.id);
    } else {
      toImport.push(inst);
    }
  }

  return { toImport, duplicates };
}

// ---------------------------------------------------------------------------
// Target directory resolution
// ---------------------------------------------------------------------------

/**
 * Returns the inherited instincts directory for the given instinct.
 * Project-scoped instincts go into the project's inherited dir.
 * Global instincts go into the global inherited dir.
 */
export function getTargetDir(
  instinct: Instinct,
  projectId: string | null | undefined,
  baseDir: string
): string {
  if (instinct.scope === "project" && projectId != null) {
    return getProjectInstinctsDir(projectId, "inherited", baseDir);
  }
  return getGlobalInstinctsDir("inherited", baseDir);
}

// ---------------------------------------------------------------------------
// handleInstinctImport
// ---------------------------------------------------------------------------

/**
 * Command handler for /instinct-import.
 * Reads the JSON file at the given path, validates each instinct,
 * skips duplicates, and saves valid instincts to inherited/ directories.
 */
export async function handleInstinctImport(
  args: string,
  ctx: ExtensionCommandContext,
  projectId?: string | null,
  baseDir?: string
): Promise<void> {
  const effectiveBase = baseDir ?? getBaseDir();
  const filePath = resolve(ctx.cwd, args.trim());

  if (!existsSync(filePath)) {
    ctx.ui.notify(`Import failed: file not found: ${filePath}`, "error");
    return;
  }

  let loadResult: LoadResult;
  try {
    loadResult = loadImportFile(filePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`Import failed: ${msg}`, "error");
    return;
  }

  const { valid, invalid } = loadResult;

  const { toImport, duplicates } = partitionByDuplicates(
    valid,
    projectId,
    effectiveBase
  );

  // Ensure target dirs exist before writing
  const globalInheritedDir = getGlobalInstinctsDir("inherited", effectiveBase);
  mkdirSync(globalInheritedDir, { recursive: true });

  if (projectId != null) {
    const projectInheritedDir = getProjectInstinctsDir(
      projectId,
      "inherited",
      effectiveBase
    );
    mkdirSync(projectInheritedDir, { recursive: true });
  }

  // Save each instinct to the correct inherited directory
  for (const instinct of toImport) {
    const targetDir = getTargetDir(instinct, projectId, effectiveBase);
    saveInstinct(instinct, targetDir);
  }

  // Build summary message
  const lines: string[] = [
    `Imported ${toImport.length} instinct${toImport.length !== 1 ? "s" : ""} from ${filePath}`,
  ];

  if (duplicates.length > 0) {
    lines.push(
      `Skipped ${duplicates.length} duplicate${duplicates.length !== 1 ? "s" : ""}: ${duplicates.join(", ")}`
    );
  }

  if (invalid.length > 0) {
    lines.push(
      `Skipped ${invalid.length} invalid entr${invalid.length !== 1 ? "ies" : "y"}: ${invalid.map((e) => `[${e.index}] ${e.reason}`).join("; ")}`
    );
  }

  ctx.ui.notify(lines.join("\n"), "info");
}
