/**
 * Analyzer user prompt construction.
 * Returns the user prompt string used by the Haiku background analyzer
 * to locate observations and instinct files for the current project.
 */

import { existsSync, readFileSync } from "node:fs";
import type { InstalledSkill, ProjectEntry } from "../types.js";

/** Maximum number of observation lines to include in analysis. */
const MAX_TAIL_ENTRIES = 500;

/**
 * Reads the last `maxEntries` lines from a JSONL observations file.
 * Returns an empty array if the file does not exist.
 *
 * @param observationsPath - Absolute path to observations.jsonl
 * @param maxEntries - Maximum number of lines to return (default 500)
 */
export function tailObservations(
  observationsPath: string,
  maxEntries = MAX_TAIL_ENTRIES
): string[] {
  if (!existsSync(observationsPath)) {
    return [];
  }
  const content = readFileSync(observationsPath, "utf-8");
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.slice(-maxEntries);
}

export interface AnalyzerUserPromptOptions {
  agentsMdProject?: string | null;
  agentsMdGlobal?: string | null;
  installedSkills?: InstalledSkill[];
}

/**
 * Builds the user prompt for the background Haiku analyzer.
 * Includes observation and instinct file paths plus project context.
 * Optionally includes AGENTS.md content and installed skills for deduplication.
 * Template construction only - no subprocess I/O.
 *
 * @param observationsPath - Absolute path to the project's observations.jsonl
 * @param instinctsDir     - Absolute path to the project's instincts directory
 * @param project          - ProjectEntry with id and name
 * @param options          - Optional AGENTS.md content and installed skills
 */
export function buildAnalyzerUserPrompt(
  observationsPath: string,
  instinctsDir: string,
  project: ProjectEntry,
  options: AnalyzerUserPromptOptions = {}
): string {
  const { agentsMdProject = null, agentsMdGlobal = null, installedSkills = [] } = options;

  const tailedLines = tailObservations(observationsPath);
  const observationBlock =
    tailedLines.length > 0
      ? tailedLines.join("\n")
      : "(no observations recorded yet)";

  const parts: string[] = [
    "## Analysis Task",
    "",
    "Analyze the following session observations and update the instinct files accordingly.",
    "",
    "## Project Context",
    "",
    `project_id: ${project.id}`,
    `project_name: ${project.name}`,
    "",
    "## File Paths",
    "",
    `Observations file: ${observationsPath}`,
    `Instincts directory: ${instinctsDir}`,
    "",
    `The following observations are the most recent entries (up to ${MAX_TAIL_ENTRIES}):`,
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
    "1. Read existing instinct files from the instincts directory.",
    "2. Analyze the observations above for patterns following the system prompt rules.",
    "3. Create new instinct files or update existing ones in the instincts directory.",
    "4. Apply feedback analysis using the active_instincts field in each observation.",
    "5. Apply passive confidence decay to existing instincts before updating.",
    "6. Do not delete any instinct files - only create or update."
  );

  return parts.join("\n");
}
