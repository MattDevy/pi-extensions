/**
 * Prompt builder for the interactive /instinct-dream command.
 * Similar to evolve-prompt but focused on holistic consolidation tasks.
 */

import type { Instinct, InstalledSkill } from "../types.js";

interface InstinctSummary {
  id: string;
  title: string;
  trigger: string;
  action: string;
  confidence: number;
  domain: string;
  scope: string;
  confirmed_count: number;
  contradicted_count: number;
  inactive_count: number;
}

function summarizeInstinct(i: Instinct): InstinctSummary {
  return {
    id: i.id,
    title: i.title,
    trigger: i.trigger,
    action: i.action,
    confidence: i.confidence,
    domain: i.domain,
    scope: i.scope,
    confirmed_count: i.confirmed_count,
    contradicted_count: i.contradicted_count,
    inactive_count: i.inactive_count,
  };
}

export function buildDreamPrompt(
  instincts: Instinct[],
  agentsMdProject?: string | null,
  agentsMdGlobal?: string | null,
  installedSkills?: InstalledSkill[],
): string {
  const parts: string[] = [
    "Perform a holistic consolidation review of my learned instincts.",
    "You have access to instinct tools (instinct_merge, instinct_delete, instinct_write) to act on your findings.",
    "",
    "## Full Instinct Corpus",
    "",
    "```json",
    JSON.stringify(instincts.map(summarizeInstinct), null, 2),
    "```",
    "",
    `Total: ${instincts.length} instincts`,
    "",
    "## Consolidation Tasks",
    "",
    "Review the entire corpus and identify:",
    "",
    "1. **Merge candidates**: Instincts with semantically similar triggers or actions (even if worded differently). Merge into a single, stronger instinct using instinct_merge.",
    "2. **Contradictions**: Instincts with similar triggers but opposing actions. Resolve by keeping the stronger one or merging into a nuanced context-dependent instinct.",
    "3. **Stale instincts**: Entries with zero confirmations, high inactive_count, or references to outdated patterns. Delete them.",
    "4. **AGENTS.md duplicates**: Instincts already covered by the guidelines below. Delete them.",
    "5. **Promotion candidates**: Project-scoped instincts with confidence >= 0.7 and confirmed_count >= 3 that apply universally. Promote to global scope.",
    "6. **Skill shadows**: Instincts whose purpose is already served by an installed skill. Delete them.",
    "7. **Quality cleanup**: Instincts with confidence < 0.2, vague triggers, or flagged_for_removal. Clean up or delete.",
    "",
    "Present your findings conversationally. For each suggestion, explain your reasoning and ask if I'd like you to take action using the instinct tools.",
    "If the corpus looks healthy, say so briefly.",
  ];

  if (agentsMdProject || agentsMdGlobal) {
    parts.push("", "## Current Guidelines (AGENTS.md)", "");
    if (agentsMdProject) {
      parts.push("### Project AGENTS.md", "", agentsMdProject, "");
    }
    if (agentsMdGlobal) {
      parts.push("### Global AGENTS.md", "", agentsMdGlobal, "");
    }
  }

  if (installedSkills && installedSkills.length > 0) {
    parts.push("", "## Installed Skills", "");
    for (const skill of installedSkills) {
      parts.push(`- **${skill.name}**: ${skill.description}`);
    }
  }

  return parts.join("\n");
}
