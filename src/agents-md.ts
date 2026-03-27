/**
 * Utility for reading AGENTS.md files.
 * Provides a safe wrapper around filesystem access that returns null on any failure.
 */

import { existsSync, readFileSync } from "node:fs";

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
