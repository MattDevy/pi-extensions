/**
 * User prompt builder for the consolidation (dream) pass.
 * Embeds all instincts and optional AGENTS.md context.
 */

import type { Instinct, InstalledSkill } from "../types.js";
import { formatInstinctsCompact } from "../cli/analyze-single-shot.js";

export interface ConsolidatePromptOptions {
  agentsMdProject?: string | null;
  agentsMdGlobal?: string | null;
  installedSkills?: InstalledSkill[];
  projectName?: string;
  projectId?: string;
}

/**
 * Builds the user prompt for a consolidation pass.
 * Unlike the observation analyzer, this prompt contains only instincts
 * and guidelines - no observations.
 */
export function buildConsolidateUserPrompt(
  instincts: readonly Instinct[],
  options: ConsolidatePromptOptions = {},
): string {
  const {
    agentsMdProject = null,
    agentsMdGlobal = null,
    installedSkills = [],
    projectName,
    projectId,
  } = options;

  const instinctBlock =
    instincts.length > 0
      ? formatInstinctsCompact([...instincts])
      : "(no instincts)";

  const parts: string[] = [];

  if (projectId || projectName) {
    parts.push("## Project Context", "");
    if (projectId) parts.push(`project_id: ${projectId}`);
    if (projectName) parts.push(`project_name: ${projectName}`);
    parts.push("");
  }

  parts.push(
    "## Full Instinct Corpus",
    "",
    instinctBlock,
    "",
    `Total instincts: ${instincts.length}`,
    "",
  );

  if (agentsMdProject != null || agentsMdGlobal != null) {
    parts.push("## Existing Guidelines (AGENTS.md)", "");
    if (agentsMdProject != null) {
      parts.push("### Project AGENTS.md", "", agentsMdProject, "");
    }
    if (agentsMdGlobal != null) {
      parts.push("### Global AGENTS.md", "", agentsMdGlobal, "");
    }
  }

  if (installedSkills.length > 0) {
    parts.push("## Installed Skills", "");
    for (const skill of installedSkills) {
      parts.push(`- **${skill.name}**: ${skill.description}`);
    }
    parts.push("");
  }

  parts.push(
    "## Instructions",
    "",
    "1. Review ALL instincts above as a complete corpus.",
    "2. Identify merge candidates, contradictions, stale entries, and promotion candidates.",
    "3. Check for instincts duplicated by AGENTS.md guidelines.",
    "4. Return a JSON change-set with your proposed modifications.",
    "5. Prefer conservative changes - only act when the improvement is clear.",
    "",
    "Return ONLY the JSON object. No prose, no markdown fences.",
  );

  return parts.join("\n");
}
