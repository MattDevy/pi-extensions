/**
 * /instinct-status command for pi-continuous-learning.
 * Displays all instincts grouped by domain with confidence scores,
 * trend arrows, and feedback ratios.
 */

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Instinct } from "./types.js";
import { loadProjectInstincts, loadGlobalInstincts } from "./instinct-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TREND_UP = "↑";
const TREND_DOWN = "↓";
const TREND_STABLE = "→";
const FLAG_REMOVAL = "⚠ FLAGGED FOR REMOVAL";
const COMMAND_NAME = "instinct-status";
const NO_INSTINCTS_MSG = "No instincts found.";

// ---------------------------------------------------------------------------
// Trend and formatting helpers
// ---------------------------------------------------------------------------

/**
 * Returns a trend arrow based on confirmed vs contradicted counts.
 * ↑ when confirmed > contradicted, ↓ when contradicted > confirmed, → when equal.
 */
export function getTrendArrow(instinct: Instinct): string {
  if (instinct.confirmed_count > instinct.contradicted_count) return TREND_UP;
  if (instinct.contradicted_count > instinct.confirmed_count) return TREND_DOWN;
  return TREND_STABLE;
}

/**
 * Formats a single instinct line for display.
 * Format: [confidence] title trend feedback_ratio [⚠ FLAGGED FOR REMOVAL]
 */
export function formatInstinct(instinct: Instinct): string {
  const confidence = `[${instinct.confidence.toFixed(2)}]`;
  const trend = getTrendArrow(instinct);
  const feedbackRatio =
    `✓${instinct.confirmed_count} ✗${instinct.contradicted_count} ○${instinct.inactive_count}`;

  const parts = [`  ${confidence} ${instinct.title} ${trend} (${feedbackRatio})`];
  if (instinct.flagged_for_removal) {
    parts.push(`    ${FLAG_REMOVAL}`);
  }
  return parts.join("\n");
}

/**
 * Groups instincts by domain. Returns a sorted record (sorted by domain name).
 */
export function groupByDomain(instincts: Instinct[]): Record<string, Instinct[]> {
  const groups: Record<string, Instinct[]> = {};
  for (const instinct of instincts) {
    const domain = instinct.domain || "uncategorized";
    if (!groups[domain]) {
      groups[domain] = [];
    }
    groups[domain].push(instinct);
  }
  return groups;
}

/**
 * Formats the full status output string from a list of instincts.
 * Returns a header message when no instincts exist.
 */
export function formatStatusOutput(instincts: Instinct[]): string {
  if (instincts.length === 0) return NO_INSTINCTS_MSG;

  const groups = groupByDomain(instincts);
  const sortedDomains = Object.keys(groups).sort();

  const lines: string[] = ["=== Instinct Status ===", ""];

  for (const domain of sortedDomains) {
    const domainInstincts = groups[domain];
    if (!domainInstincts || domainInstincts.length === 0) continue;

    lines.push(`## ${domain}`);
    for (const instinct of domainInstincts) {
      lines.push(formatInstinct(instinct));
    }
    lines.push("");
  }

  const total = instincts.length;
  const flagged = instincts.filter((i) => i.flagged_for_removal).length;
  lines.push(`Total: ${total} instinct${total !== 1 ? "s" : ""} (${flagged} flagged for removal)`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// loadAllInstincts
// ---------------------------------------------------------------------------

/**
 * Loads all instincts from disk (project + global), including flagged ones.
 * Does NOT apply confidence filtering - status command shows everything.
 */
export function loadAllInstincts(
  projectId?: string | null,
  baseDir?: string
): Instinct[] {
  const projectInstincts =
    projectId != null ? loadProjectInstincts(projectId, baseDir) : [];
  const globalInstincts = loadGlobalInstincts(baseDir);
  return [...projectInstincts, ...globalInstincts];
}

// ---------------------------------------------------------------------------
// handleInstinctStatus
// ---------------------------------------------------------------------------

/**
 * Command handler for /instinct-status.
 * Loads all instincts, formats them grouped by domain, and notifies the user.
 */
export async function handleInstinctStatus(
  _args: string,
  ctx: ExtensionCommandContext,
  projectId?: string | null,
  baseDir?: string
): Promise<void> {
  const instincts = loadAllInstincts(projectId, baseDir);
  const output = formatStatusOutput(instincts);
  ctx.ui.notify(output, "info");
}

export { COMMAND_NAME };
