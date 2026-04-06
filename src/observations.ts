/**
 * JSONL observation file writing and archival.
 * Appends observations to per-project observations.jsonl files,
 * archives files at 10MB, and cleans up archives older than 30 days.
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { Observation } from "./types.js";
import { getArchiveDir, getObservationsPath } from "./storage.js";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ARCHIVE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isFileSizeExceeded(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  return statSync(filePath).size >= MAX_FILE_SIZE_BYTES;
}

function archiveFile(observationsPath: string, archiveDir: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = join(archiveDir, `${timestamp}.jsonl`);
  renameSync(observationsPath, archivePath);
}

/**
 * Appends one observation as a JSON line to the project's observations.jsonl.
 * Automatically archives the file if it has grown to or beyond 10MB.
 */
export function appendObservation(
  observation: Observation,
  projectId: string,
  baseDir?: string,
): void {
  const observationsPath = getObservationsPath(projectId, baseDir);
  const archiveDir = getArchiveDir(projectId, baseDir);

  if (isFileSizeExceeded(observationsPath)) {
    archiveFile(observationsPath, archiveDir);
  }

  appendFileSync(observationsPath, JSON.stringify(observation) + "\n", "utf-8");
}

/**
 * Deletes archive files older than 30 days.
 * Should be called once per session_start.
 */
/**
 * Counts non-empty lines in the project's observations.jsonl file.
 * Returns 0 when the file does not exist.
 */
export function countObservations(projectId: string, baseDir?: string): number {
  const obsPath = getObservationsPath(projectId, baseDir);
  if (!existsSync(obsPath)) return 0;
  const content = readFileSync(obsPath, "utf-8") as string;
  return content.split("\n").filter((line) => line.trim() !== "").length;
}

export function cleanOldArchives(projectId: string, baseDir?: string): void {
  const archiveDir = getArchiveDir(projectId, baseDir);
  if (!existsSync(archiveDir)) return;

  const now = Date.now();
  const files = readdirSync(archiveDir).filter((f) => f.endsWith(".jsonl"));

  for (const file of files) {
    const filePath = join(archiveDir, file);
    const { mtimeMs } = statSync(filePath);
    if (now - mtimeMs >= MAX_ARCHIVE_AGE_MS) {
      unlinkSync(filePath);
    }
  }
}
