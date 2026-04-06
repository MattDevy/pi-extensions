/**
 * Append-only analysis event log with atomic rename for safe consumption.
 *
 * The background analyzer appends events to `analysis-events.jsonl`.
 * The extension consumes events by atomically renaming the file to
 * `.consumed`, reading it, then deleting it. On POSIX, rename is atomic -
 * any in-flight appends follow the inode to the renamed file.
 *
 * Multiple analyzer runs can append before the extension reads. No events
 * are lost because each run only appends; the file is never truncated by
 * the analyzer.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getProjectDir } from "./storage.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENTS_FILENAME = "analysis-events.jsonl";
const CONSUMED_FILENAME = "analysis-events.consumed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstinctChangeSummary {
  readonly id: string;
  readonly title: string;
  readonly scope: "project" | "global";
  readonly trigger?: string;
  readonly action?: string;
  readonly confidence_delta?: number;
}

export interface AnalysisEvent {
  readonly timestamp: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly created: readonly InstinctChangeSummary[];
  readonly updated: readonly InstinctChangeSummary[];
  readonly deleted: readonly InstinctChangeSummary[];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getEventsPath(projectId: string, baseDir?: string): string {
  return join(getProjectDir(projectId, baseDir), EVENTS_FILENAME);
}

export function getConsumedPath(projectId: string, baseDir?: string): string {
  return join(getProjectDir(projectId, baseDir), CONSUMED_FILENAME);
}

// ---------------------------------------------------------------------------
// Write (analyzer side)
// ---------------------------------------------------------------------------

/**
 * Appends an analysis event to the project's event log.
 * Skips writing if nothing changed (all arrays empty).
 * Creates the parent directory if needed.
 */
export function appendAnalysisEvent(
  event: AnalysisEvent,
  baseDir?: string,
): void {
  if (
    event.created.length === 0 &&
    event.updated.length === 0 &&
    event.deleted.length === 0
  ) {
    return;
  }

  const eventsPath = getEventsPath(event.project_id, baseDir);
  mkdirSync(dirname(eventsPath), { recursive: true });
  appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Read and clear (extension side)
// ---------------------------------------------------------------------------

/**
 * Atomically consumes all pending analysis events for a project.
 *
 * Strategy:
 * 1. Check for orphaned `.consumed` file from a prior crash - read it first
 * 2. Rename `analysis-events.jsonl` to `.consumed` (atomic on POSIX)
 * 3. Read and parse all lines from `.consumed`
 * 4. Delete `.consumed`
 *
 * Returns an empty array if no events exist or rename fails (e.g. file
 * doesn't exist, or another consumer raced us).
 */
export function consumeAnalysisEvents(
  projectId: string,
  baseDir?: string,
): readonly AnalysisEvent[] {
  const eventsPath = getEventsPath(projectId, baseDir);
  const consumedPath = getConsumedPath(projectId, baseDir);

  const allEvents: AnalysisEvent[] = [];

  // Step 1: recover orphaned consumed file from prior crash
  if (existsSync(consumedPath)) {
    allEvents.push(...parseEventsFile(consumedPath));
    safeUnlink(consumedPath);
  }

  // Step 2: atomically rename the events file
  if (existsSync(eventsPath)) {
    try {
      renameSync(eventsPath, consumedPath);
    } catch {
      // Rename failed (race with another consumer, or OS issue).
      // Return whatever we recovered from step 1.
      return allEvents;
    }

    // Step 3: read the renamed file
    allEvents.push(...parseEventsFile(consumedPath));

    // Step 4: delete consumed file
    safeUnlink(consumedPath);
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEventsFile(filePath: string): AnalysisEvent[] {
  const events: AnalysisEvent[] = [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);

    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as AnalysisEvent);
      } catch {
        // Skip malformed lines - don't lose other events
      }
    }
  } catch {
    // File read failed - return empty
  }

  return events;
}

function safeUnlink(filePath: string): void {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Best effort cleanup
  }
}
