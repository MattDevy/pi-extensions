import type { Instinct, InstalledSkill } from "../types.js";

interface InstinctSummary {
  id: string;
  title: string;
  trigger: string;
  action: string;
  confidence: number;
  domain: string;
  scope: string;
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
  };
}

export function buildEvolvePrompt(
  instincts: Instinct[],
  agentsMdProject?: string | null,
  agentsMdGlobal?: string | null,
  installedSkills?: InstalledSkill[],
): string {
  const parts: string[] = [
    "Analyze the following learned instincts and identify opportunities for improvement.",
    "You have access to instinct tools (instinct_merge, instinct_delete, instinct_write) to act on your findings.",
    "",
    "## Instincts",
    "",
    "```json",
    JSON.stringify(instincts.map(summarizeInstinct), null, 2),
    "```",
    "",
    "## Analysis Tasks",
    "",
    "1. **Contradictions**: Find instincts with similar triggers but opposing actions (e.g., 'prefer X' vs 'avoid X', 'always do Y' vs 'never do Y'). Offer to delete the weaker one, or merge both into a nuanced context-dependent instinct.",
    "2. **Merge candidates**: Find instincts with semantically similar triggers or actions (even if worded differently). Offer to merge them using the instinct_merge tool.",
    "3. **Duplicates of AGENTS.md**: Flag instincts already covered by the guidelines below. Offer to delete them.",
    "4. **Promotion candidates**: Project-scoped instincts with confidence >= 0.7 that could become global.",
    "5. **Skill shadows**: Instincts whose purpose is already served by an installed skill (listed below). Offer to delete them.",
    "6. **Low-confidence cleanup**: Instincts with confidence < 0.3 or flagged_for_removal that should be deleted.",
    "",
    "Present your findings conversationally. For each suggestion, explain your reasoning and ask if I'd like you to take action using the instinct tools.",
    "If there are no issues, say so briefly.",
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
