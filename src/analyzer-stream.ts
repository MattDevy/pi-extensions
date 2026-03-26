/**
 * Parses the JSON event stream from the Pi analyzer subprocess stdout.
 * Handles newline-delimited JSON, tracks file writes, and detects completion.
 */

import { type Readable } from "node:stream";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result returned after fully parsing the analyzer subprocess output. */
export interface AnalysisResult {
  /** True when an agent_end event was received (clean completion). */
  success: boolean;
  /** Absolute paths of files written by the analyzer. */
  filesWritten: string[];
  /** Error messages collected from tool failures. */
  errors: string[];
}

/** Minimal shape of a Pi JSON-mode event line. */
interface PiEvent {
  event?: string;
  type?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  /** Tool error flag (Pi may use `error` or `is_error`). */
  error?: boolean | string;
  is_error?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_TOOL_END = "tool_execution_end";
const EVENT_AGENT_END = "agent_end";
const WRITE_TOOL_NAME = "write";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the event type string, supporting both `event` and `type` keys
 * since Pi may vary the field name across versions.
 */
function getEventType(ev: PiEvent): string | undefined {
  return ev.event ?? ev.type;
}

/**
 * Extracts the written file path from a `write` tool_execution_end event.
 * Returns undefined for non-write tools or when no path can be resolved.
 */
function extractWrittenFile(ev: PiEvent): string | undefined {
  if (ev.tool !== WRITE_TOOL_NAME) return undefined;
  const args = ev.args;
  if (!args) return undefined;
  // Pi's write tool uses "path"; fall back to alternatives for robustness.
  const pathVal = args["path"] ?? args["file_path"] ?? args["filename"];
  return typeof pathVal === "string" ? pathVal : undefined;
}

/**
 * Returns true when a tool_execution_end event signals a tool failure.
 * Pi may surface errors via `error`, `is_error`, or a truthy string value.
 */
function isToolError(ev: PiEvent): boolean {
  return ev.is_error === true || ev.error === true || typeof ev.error === "string";
}

/**
 * Builds a human-readable error string from a failed tool event.
 */
function buildErrorMessage(ev: PiEvent): string {
  if (typeof ev.error === "string") return ev.error;
  return `Tool "${ev.tool ?? "unknown"}" failed`;
}

/**
 * Parses one line of NDJSON.
 * Returns the parsed object on success, or null for blank/malformed lines
 * (logs a warning on malformed input so callers can skip without crashing).
 */
export function parseEventLine(line: string): PiEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as PiEvent;
  } catch {
    console.warn(`[analyzer-stream] Malformed JSON line (skipped): ${trimmed}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Reads the Pi analyzer subprocess stdout stream line by line, parses JSON
 * events, and accumulates results.
 *
 * - Tracks `tool_execution_end` events for `write` tool calls (files written).
 * - Sets `success = true` when an `agent_end` event is observed.
 * - Collects tool error messages.
 * - Skips malformed lines with a console warning.
 *
 * @param stdout - The readable stdout stream from the spawned subprocess.
 * @returns Resolved AnalysisResult once the stream ends.
 */
export async function parseAnalyzerStream(
  stdout: Readable
): Promise<AnalysisResult> {
  const filesWritten: string[] = [];
  const errors: string[] = [];
  let success = false;

  const rl = createInterface({ input: stdout, crlfDelay: Infinity });

  for await (const line of rl) {
    const ev = parseEventLine(line);
    if (!ev) continue;

    const eventType = getEventType(ev);

    if (eventType === EVENT_AGENT_END) {
      success = true;
      continue;
    }

    if (eventType === EVENT_TOOL_END) {
      if (isToolError(ev)) {
        errors.push(buildErrorMessage(ev));
      }
      const filePath = extractWrittenFile(ev);
      if (filePath) {
        filesWritten.push(filePath);
      }
    }
  }

  return { success, filesWritten, errors };
}
