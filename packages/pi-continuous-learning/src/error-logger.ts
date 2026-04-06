/**
 * Error logging utility for pi-continuous-learning.
 * Writes structured error entries to projects/<id>/analyzer.log.
 * All write failures are silently swallowed - the logger must never throw.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { getProjectDir, getBaseDir } from "./storage.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_FILENAME = "analyzer.log";
const PREFIX = "[pi-continuous-learning]";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the analyzer log for the given project.
 * Exported for testing.
 */
export function getLogPath(projectId: string, baseDir?: string): string {
  return join(getProjectDir(projectId, baseDir ?? getBaseDir()), LOG_FILENAME);
}

function formatError(context: string, error: unknown): string {
  const timestamp = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const stack =
    error instanceof Error && error.stack ? `\nStack: ${error.stack}` : "";
  return `[${timestamp}] [${context}] Error: ${message}${stack}\n`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Logs an error to `projects/<projectId>/analyzer.log`.
 *
 * When `projectId` is null (e.g. session_start failed before project detection),
 * falls back to `console.warn` only.
 *
 * Never throws - all I/O failures are silently swallowed.
 */
export function logError(
  projectId: string | null,
  context: string,
  error: unknown,
  baseDir?: string,
): void {
  const line = formatError(context, error);

  if (projectId === null) {
    console.warn(`${PREFIX} ${context}: ${line.trim()}`);
    return;
  }

  const logPath = getLogPath(projectId, baseDir);
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, line, "utf-8");
  } catch {
    // Cannot log the logger failing - fall back to console
    console.warn(`${PREFIX} ${context}: ${line.trim()}`);
  }
}

/**
 * Logs a warning (non-error) message to the analyzer log.
 * Used for subprocess stderr output and other non-fatal warnings.
 *
 * Never throws - all I/O failures are silently swallowed.
 */
export function logWarning(
  projectId: string | null,
  context: string,
  message: string,
  baseDir?: string,
): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${context}] Warning: ${message}\n`;

  if (projectId === null) {
    console.warn(`${PREFIX} ${context}: ${message}`);
    return;
  }

  const logPath = getLogPath(projectId, baseDir);
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, line, "utf-8");
  } catch {
    console.warn(`${PREFIX} ${context}: ${message}`);
  }
}

/**
 * Logs an informational message to the analyzer log.
 * Used for tracking analyzer lifecycle events (started, completed, skipped).
 *
 * Never throws - all I/O failures are silently swallowed.
 */
export function logInfo(
  projectId: string | null,
  context: string,
  message: string,
  baseDir?: string,
): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${context}] Info: ${message}\n`;

  if (projectId === null) {
    return;
  }

  const logPath = getLogPath(projectId, baseDir);
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, line, "utf-8");
  } catch {
    // silently swallow
  }
}
