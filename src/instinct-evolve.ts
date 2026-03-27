/**
 * /instinct-evolve command for pi-continuous-learning.
 * Contains the command handler (handleInstinctEvolve) and formatter
 * (formatEvolveSuggestions). Generator functions live in
 * instinct-evolve-generators.ts.
 */

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { getBaseDir } from "./storage.js";
import { readAgentsMd } from "./agents-md.js";
import {
  loadInstinctsForEvolve,
  generateEvolveSuggestions,
  type MergeSuggestion,
  type CommandSuggestion,
  type PromotionSuggestion,
  type AgentsMdOverlapSuggestion,
  type AgentsMdAdditionSuggestion,
  type EvolveSuggestion,
} from "./instinct-evolve-generators.js";

export const COMMAND_NAME = "instinct-evolve";

// Re-export everything from generators so callers can import from one place.
export {
  MERGE_SIMILARITY_THRESHOLD,
  ACTION_SIMILARITY_THRESHOLD,
  PROMOTION_CONFIDENCE_THRESHOLD,
  AGENTS_MD_OVERLAP_THRESHOLD,
  AGENTS_MD_PROJECT_ADDITION_THRESHOLD,
  AGENTS_MD_GLOBAL_ADDITION_THRESHOLD,
  COMMAND_TRIGGER_KEYWORDS,
  tokenizeText,
  triggerSimilarity,
  actionSimilarity,
  findMergeCandidates,
  findCommandCandidates,
  findPromotionCandidates,
  findAgentsMdOverlaps,
  findAgentsMdAdditions,
  generateEvolveSuggestions,
  loadInstinctsForEvolve,
  type MergeSuggestion,
  type CommandSuggestion,
  type PromotionSuggestion,
  type AgentsMdOverlapSuggestion,
  type AgentsMdAdditionSuggestion,
  type EvolveSuggestion,
} from "./instinct-evolve-generators.js";

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

/**
 * Formats evolution suggestions as a human-readable string.
 */
export function formatEvolveSuggestions(suggestions: EvolveSuggestion[]): string {
  if (suggestions.length === 0) {
    return "No evolution suggestions at this time. Keep using pi to accumulate more instincts!";
  }

  const lines: string[] = ["=== Instinct Evolution Suggestions ===", ""];

  const merges = suggestions.filter((s): s is MergeSuggestion => s.type === "merge");
  const commands = suggestions.filter((s): s is CommandSuggestion => s.type === "command");
  const promotions = suggestions.filter((s): s is PromotionSuggestion => s.type === "promotion");
  const overlaps = suggestions.filter(
    (s): s is AgentsMdOverlapSuggestion => s.type === "agents-md-overlap"
  );
  const projectAdditions = suggestions.filter(
    (s): s is AgentsMdAdditionSuggestion =>
      s.type === "agents-md-addition" && s.scope === "project"
  );
  const globalAdditions = suggestions.filter(
    (s): s is AgentsMdAdditionSuggestion =>
      s.type === "agents-md-addition" && s.scope === "global"
  );

  if (merges.length > 0) {
    lines.push("## Merge Candidates");
    lines.push("Related instincts with similar triggers or actions that could be consolidated:");
    lines.push("");
    for (const s of merges) {
      lines.push(`  * ${s.reason}`);
      lines.push(`    Recommendation: ${s.recommendation} (keep: ${s.keepId})`);
      for (const i of s.instincts) {
        lines.push(`    - [${i.confidence.toFixed(2)}] ${i.id}: ${i.trigger}`);
      }
      lines.push("");
    }
  }

  if (commands.length > 0) {
    lines.push("## Potential Slash Commands");
    lines.push("Workflow instincts that could become reusable commands:");
    lines.push("");
    for (const s of commands) {
      lines.push(`  * [${s.instinct.confidence.toFixed(2)}] ${s.instinct.id}`);
      lines.push(`    Trigger: ${s.instinct.trigger}`);
      lines.push(`    Reason: ${s.reason}`);
      lines.push("");
    }
  }

  if (promotions.length > 0) {
    lines.push("## Promotion Candidates");
    lines.push("Project instincts ready for global promotion:");
    lines.push("");
    for (const s of promotions) {
      lines.push(`  * [${s.instinct.confidence.toFixed(2)}] ${s.instinct.id}: ${s.instinct.title}`);
      lines.push(`    ${s.reason}`);
      lines.push("");
    }
  }

  if (overlaps.length > 0) {
    lines.push("## Duplicates AGENTS.md");
    lines.push("Instincts whose content overlaps with AGENTS.md guidelines:");
    lines.push("");
    for (const s of overlaps) {
      lines.push(`  * [${s.instinct.confidence.toFixed(2)}] ${s.instinct.id}`);
      lines.push(`    Trigger: ${s.instinct.trigger}`);
      lines.push(`    Excerpt: "${s.matchingExcerpt}"`);
      lines.push("");
    }
  }

  if (projectAdditions.length > 0) {
    lines.push("## Suggested Project AGENTS.md Additions");
    lines.push("High-confidence instincts ready to become permanent project guidelines:");
    lines.push("(Edit AGENTS.md manually to add these - no file is written automatically)");
    lines.push("");
    for (const s of projectAdditions) {
      lines.push(`  * [${s.instinct.confidence.toFixed(2)}] ${s.instinct.id}`);
      lines.push(`    Proposed bullet: ${s.proposedBullet}`);
      lines.push("");
    }
  }

  if (globalAdditions.length > 0) {
    lines.push("## Suggested Global AGENTS.md Additions");
    lines.push("High-confidence global instincts ready to become permanent global guidelines:");
    lines.push("(Edit ~/.pi/agent/AGENTS.md manually to add these - no file is written automatically)");
    lines.push("");
    for (const s of globalAdditions) {
      lines.push(`  * [${s.instinct.confidence.toFixed(2)}] ${s.instinct.id}`);
      lines.push(`    Proposed bullet: ${s.proposedBullet}`);
      lines.push("");
    }
  }

  const total = suggestions.length;
  lines.push(
    `Total: ${total} suggestion${total !== 1 ? "s" : ""} (informational only - no changes applied)`
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Command handler for /instinct-evolve.
 * Analyzes instincts and displays evolution suggestions.
 * Does NOT auto-apply any changes.
 */
export async function handleInstinctEvolve(
  _args: string,
  ctx: ExtensionCommandContext,
  projectId?: string | null,
  baseDir?: string,
  projectRoot?: string | null
): Promise<void> {
  const effectiveBase = baseDir ?? getBaseDir();
  const { projectInstincts, globalInstincts } = loadInstinctsForEvolve(
    projectId,
    effectiveBase
  );

  const agentsMdProject =
    projectRoot != null ? readAgentsMd(join(projectRoot, "AGENTS.md")) : null;
  const agentsMdGlobal = readAgentsMd(join(homedir(), ".pi", "agent", "AGENTS.md"));

  const suggestions = generateEvolveSuggestions(
    projectInstincts,
    globalInstincts,
    agentsMdProject,
    agentsMdGlobal
  );
  const output = formatEvolveSuggestions(suggestions);
  ctx.ui.notify(output, "info");
}
