/**
 * /instinct-export command for pi-continuous-learning.
 * Exports instincts to a JSON file in the current directory.
 * Optional args: scope (project|global) and domain filter.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Instinct, InstinctScope } from "./types.js";
import { loadProjectInstincts, loadGlobalInstincts } from "./instinct-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMMAND_NAME = "instinct-export";
const SCOPE_PROJECT: InstinctScope = "project";
const SCOPE_GLOBAL: InstinctScope = "global";
const VALID_SCOPES: readonly string[] = [SCOPE_PROJECT, SCOPE_GLOBAL];

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export interface ExportArgs {
  scope: InstinctScope | null;
  domain: string | null;
}

/**
 * Parses space-separated args string.
 * If first token is "project" or "global", it is treated as scope filter.
 * Remaining tokens (if any) are joined as domain filter.
 */
export function parseExportArgs(args: string): ExportArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { scope: null, domain: null };
  }

  const first = tokens[0] ?? "";
  const isScope = VALID_SCOPES.includes(first);

  const scope = isScope ? (first as InstinctScope) : null;
  const domainTokens = isScope ? tokens.slice(1) : tokens;
  const domain = domainTokens.length > 0 ? domainTokens.join(" ") : null;

  return { scope, domain };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Filters instincts by optional scope and domain.
 * Immutable - returns a new array.
 */
export function filterInstinctsForExport(
  instincts: Instinct[],
  scope: InstinctScope | null,
  domain: string | null,
): Instinct[] {
  return instincts.filter((instinct) => {
    if (scope !== null && instinct.scope !== scope) return false;
    if (domain !== null && instinct.domain !== domain) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Filename generation
// ---------------------------------------------------------------------------

/**
 * Generates an export filename with timestamp.
 * Format: instincts-export-<YYYYMMDDTHHmmss>.json
 */
export function buildExportFilename(now: Date = new Date()): string {
  const iso = now.toISOString(); // "2026-03-26T17:12:20.216Z"
  // Compact: remove dashes, colons, milliseconds, and trailing Z
  const compact = iso
    .replace(/-/g, "")
    .replace(/:/g, "")
    .replace(/\.\d+Z$/, "");
  return `instincts-export-${compact}.json`;
}

// ---------------------------------------------------------------------------
// loadAllInstinctsForExport
// ---------------------------------------------------------------------------

/**
 * Loads instincts from disk (project + global) for export.
 * Does NOT apply confidence filtering - export includes everything.
 */
export function loadAllInstinctsForExport(
  projectId?: string | null,
  baseDir?: string,
): Instinct[] {
  const projectInstincts =
    projectId != null ? loadProjectInstincts(projectId, baseDir) : [];
  const globalInstincts = loadGlobalInstincts(baseDir);
  return [...projectInstincts, ...globalInstincts];
}

// ---------------------------------------------------------------------------
// handleInstinctExport
// ---------------------------------------------------------------------------

/**
 * Command handler for /instinct-export.
 * Loads instincts, applies optional filters, writes JSON file to cwd.
 */
export async function handleInstinctExport(
  args: string,
  ctx: ExtensionCommandContext,
  projectId?: string | null,
  baseDir?: string,
): Promise<void> {
  const { scope, domain } = parseExportArgs(args);

  const all = loadAllInstinctsForExport(projectId, baseDir);
  const filtered = filterInstinctsForExport(all, scope, domain);

  const filename = buildExportFilename();
  const outputPath = join(ctx.cwd, filename);

  writeFileSync(outputPath, JSON.stringify(filtered, null, 2), "utf-8");

  ctx.ui.notify(
    `Exported ${filtered.length} instinct${filtered.length !== 1 ? "s" : ""} to ${outputPath}`,
    "info",
  );
}

export { COMMAND_NAME };
