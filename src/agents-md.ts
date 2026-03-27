/**
 * Utility for reading and writing AGENTS.md files.
 * Provides safe wrappers around filesystem access.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Instinct } from "./types.js";

/**
 * Reads an AGENTS.md file and returns its content.
 * Returns null if the file does not exist or cannot be read.
 *
 * @param filePath - Absolute path to the AGENTS.md file
 */
export function readAgentsMd(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Formats an instinct as an AGENTS.md section entry.
 * Produces a markdown block with the instinct title as heading and
 * trigger/action as content.
 */
export function formatInstinctAsAgentsMdEntry(instinct: Instinct): string {
  const lines = [
    `### ${instinct.title}`,
    "",
    `**When:** ${instinct.trigger}`,
    "",
    instinct.action,
    "",
  ];
  return lines.join("\n");
}

/**
 * Generates a complete AGENTS.md diff showing proposed additions.
 * Returns the full new content that would result from appending the entries.
 */
export function generateAgentsMdDiff(
  currentContent: string | null,
  instincts: Instinct[]
): string {
  const entries = instincts.map(formatInstinctAsAgentsMdEntry);
  const graduatedSection = [
    "",
    "## Graduated Instincts",
    "",
    ...entries,
  ].join("\n");

  if (currentContent === null || currentContent.trim().length === 0) {
    return `# Project Guidelines\n${graduatedSection}\n`;
  }

  // If the section already exists, append to it; otherwise add a new section
  if (currentContent.includes("## Graduated Instincts")) {
    return `${currentContent.trimEnd()}\n\n${entries.join("\n")}\n`;
  }

  return `${currentContent.trimEnd()}\n${graduatedSection}\n`;
}

/**
 * Appends graduated instinct entries to an AGENTS.md file.
 * Creates the file and parent directories if they don't exist.
 *
 * @param filePath - Absolute path to AGENTS.md
 * @param instincts - Instincts to append as entries
 * @returns The new file content that was written
 */
export function appendToAgentsMd(
  filePath: string,
  instincts: Instinct[]
): string {
  if (instincts.length === 0) return readAgentsMd(filePath) ?? "";

  const currentContent = readAgentsMd(filePath);
  const newContent = generateAgentsMdDiff(currentContent, instincts);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, newContent, "utf-8");

  return newContent;
}
