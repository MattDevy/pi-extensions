/**
 * Parses the JSON event stream from the Pi analyzer subprocess stdout.
 * Handles newline-delimited JSON, tracks file writes, and detects completion.
 *
 * Pi JSON-mode event format (verified against pi --mode json output):
 *   tool_execution_start: { type, toolCallId, toolName, args: { path, ... } }
 *   tool_execution_end:   { type, toolCallId, toolName, result, isError }
 *   agent_end:            { type: "agent_end" }
 *
 * Note: args are only present on start events, so we correlate by toolCallId.
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
  type?: string;
  /** Legacy key - some Pi versions may use `event` instead of `type`. */
  event?: string;
  /** Tool call correlation ID (present on both start and end events). */
  toolCallId?: string;
  /** Tool name as emitted by Pi (e.g. "read", "write"). */
  toolName?: string;
  /** Tool arguments - only present on tool_execution_start events. */
  args?: Record<string, unknown>;
  /** Tool result - only present on tool_execution_end events. */
  result?: unknown;
  /** Error flag on tool_execution_end (Pi uses camelCase `isError`). */
  isError?: boolean;
  /** Legacy error fields for backward compatibility. */
  is_error?: boolean;
  error?: boolean | string;
  /** Legacy tool field - older Pi versions may use `tool` instead of `toolName`. */
  tool?: string;
}

/** Tracked state for an in-flight tool call. */
interface PendingToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_TOOL_START = "tool_execution_start";
const EVENT_TOOL_END = "tool_execution_end";
const EVENT_AGENT_END = "agent_end";
const WRITE_TOOL_NAME = "write";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the event type string, supporting both `type` and `event` keys
 * since Pi may vary the field name across versions.
 */
function getEventType(ev: PiEvent): string | undefined {
  return ev.type ?? ev.event;
}

/**
 * Returns the tool name, supporting both `toolName` and `tool` keys.
 */
function getToolName(ev: PiEvent): string | undefined {
  return ev.toolName ?? ev.tool;
}

/**
 * Extracts the written file path from a write tool's args.
 * Returns undefined when no path can be resolved.
 */
function extractFilePathFromArgs(args: Record<string, unknown>): string | undefined {
  const pathVal = args["path"] ?? args["file_path"] ?? args["filename"];
  return typeof pathVal === "string" ? pathVal : undefined;
}

/**
 * Returns true when a tool_execution_end event signals a tool failure.
 * Pi uses camelCase `isError`; we also check legacy snake_case and string forms.
 */
function isToolError(ev: PiEvent): boolean {
  return ev.isError === true || ev.is_error === true || ev.error === true || typeof ev.error === "string";
}

/**
 * Builds a human-readable error string from a failed tool event.
 */
function buildErrorMessage(ev: PiEvent): string {
  if (typeof ev.error === "string") return ev.error;
  const toolName = getToolName(ev) ?? "unknown";
  return `Tool "${toolName}" failed`;
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
 * Tracks tool_execution_start events to capture args (including file paths),
 * then correlates with tool_execution_end events via toolCallId.
 *
 * - Tracks `write` tool calls to collect files written by the analyzer.
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

  /** Map of toolCallId -> pending tool call info from start events. */
  const pendingCalls = new Map<string, PendingToolCall>();

  const rl = createInterface({ input: stdout, crlfDelay: Infinity });

  for await (const line of rl) {
    const ev = parseEventLine(line);
    if (!ev) continue;

    const eventType = getEventType(ev);

    if (eventType === EVENT_AGENT_END) {
      success = true;
      continue;
    }

    if (eventType === EVENT_TOOL_START) {
      const toolName = getToolName(ev);
      const callId = ev.toolCallId;
      if (callId && toolName && ev.args) {
        pendingCalls.set(callId, { toolName, args: ev.args });
      }
      continue;
    }

    if (eventType === EVENT_TOOL_END) {
      const toolError = isToolError(ev);
      if (toolError) {
        errors.push(buildErrorMessage(ev));
      }

      const toolName = getToolName(ev);
      const callId = ev.toolCallId;

      // Only track files from successful writes
      if (!toolError) {
        // Try to get file path from correlated start event first
        if (callId && pendingCalls.has(callId)) {
          const pending = pendingCalls.get(callId)!;
          pendingCalls.delete(callId);
          if (pending.toolName === WRITE_TOOL_NAME) {
            const filePath = extractFilePathFromArgs(pending.args);
            if (filePath) {
              filesWritten.push(filePath);
            }
          }
        } else if (toolName === WRITE_TOOL_NAME && ev.args) {
          // Fallback: args directly on end event (legacy format)
          const filePath = extractFilePathFromArgs(ev.args);
          if (filePath) {
            filesWritten.push(filePath);
          }
        }
      } else if (callId) {
        // Clean up pending state even on error
        pendingCalls.delete(callId);
      }
    }
  }

  return { success, filesWritten, errors };
}
