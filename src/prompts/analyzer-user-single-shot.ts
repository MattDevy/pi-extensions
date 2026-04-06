/**
 * User prompt builder for the single-shot background analyzer.
 * Includes current instincts inline (no tool calls needed) and filtered observations.
 */
import type { InstalledSkill, Instinct, ProjectEntry } from "../types.js";
import { formatInstinctsCompact } from "../cli/analyze-single-shot.js";

export interface SingleShotPromptOptions {
  agentsMdProject?: string | null;
  agentsMdGlobal?: string | null;
  installedSkills?: InstalledSkill[];
}

/**
 * Builds the user prompt for the single-shot analyzer.
 * Embeds all current instincts inline so the model has full context
 * without making any tool calls.
 *
 * @param project          - Project metadata
 * @param existingInstincts - All current instincts (project + global)
 * @param observationLines  - Preprocessed observation lines (JSONL strings)
 * @param options           - Optional AGENTS.md content and installed skills
 */
export function buildSingleShotUserPrompt(
  project: ProjectEntry,
  existingInstincts: Instinct[],
  observationLines: string[],
  options: SingleShotPromptOptions = {},
): string {
  const {
    agentsMdProject = null,
    agentsMdGlobal = null,
    installedSkills = [],
  } = options;

  const observationBlock =
    observationLines.length > 0
      ? observationLines.join("\n")
      : "(no observations recorded yet)";

  const instinctBlock =
    existingInstincts.length > 0
      ? formatInstinctsCompact(existingInstincts)
      : "(no existing instincts)";

  const parts: string[] = [
    "## Project Context",
    "",
    `project_id: ${project.id}`,
    `project_name: ${project.name}`,
    "",
    "## Existing Instincts",
    "",
    instinctBlock,
    "",
    "## New Observations (preprocessed)",
    "",
    "```",
    observationBlock,
    "```",
  ];

  if (agentsMdProject != null || agentsMdGlobal != null) {
    parts.push("", "## Existing Guidelines", "");
    if (agentsMdProject != null) {
      parts.push("### Project AGENTS.md", "", agentsMdProject, "");
    }
    if (agentsMdGlobal != null) {
      parts.push("### Global AGENTS.md", "", agentsMdGlobal, "");
    }
  }

  if (installedSkills.length > 0) {
    parts.push("", "## Installed Skills", "");
    for (const skill of installedSkills) {
      parts.push(`- **${skill.name}**: ${skill.description}`);
    }
    parts.push("");
  }

  parts.push(
    "",
    "## Instructions",
    "",
    "1. Review the existing instincts above.",
    "2. Analyze the new observations for patterns per the system prompt rules.",
    "3. Return a JSON change-set: create new instincts, update existing ones, or delete obsolete ones.",
    "4. Apply feedback analysis using the active_instincts field in each observation.",
    "5. Passive confidence decay has already been applied before this analysis.",
    "6. Before creating any instinct, check the Existing Guidelines section above.",
    "   If the pattern is already covered by AGENTS.md, do NOT create an instinct for it.",
    "7. Apply the Quality Tier rules from the system prompt:",
    "   - Generic agent behaviors (read-before-edit, clarify-before-implement) -> skip entirely",
    "   - Project-specific patterns -> project-scoped instinct",
    "   - Universal workflow patterns -> global-scoped instinct",
    "8. Check existing instincts for contradictions (similar triggers, opposing actions).",
    "   Resolve by deleting the weaker instinct or merging into a nuanced one.",
    "",
    "Return ONLY the JSON object. No prose, no markdown fences.",
  );

  return parts.join("\n");
}
