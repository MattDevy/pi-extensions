import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  Observation,
  PromptFrequencyEntry,
  PromptFrequencyTable,
  GlobalPromptFrequencyEntry,
  GlobalPromptFrequencyTable,
} from "./types.js";
import { getBaseDir, getProjectDir } from "./storage.js";

// ---------------------------------------------------------------------------
// Normalization & hashing
// ---------------------------------------------------------------------------

const TRAILING_PUNCT = /[.,!?;:]+$/;

export function normalizePrompt(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(TRAILING_PUNCT, "");
}

export function hashPrompt(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

// ---------------------------------------------------------------------------
// Storage paths
// ---------------------------------------------------------------------------

export function getProjectFrequencyPath(
  projectId: string,
  baseDir = getBaseDir(),
): string {
  return join(getProjectDir(projectId, baseDir), "prompt-frequency.json");
}

export function getGlobalFrequencyPath(baseDir = getBaseDir()): string {
  return join(baseDir, "prompt-frequency.json");
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

export function loadProjectFrequencyTable(
  projectId: string,
  baseDir = getBaseDir(),
): PromptFrequencyTable {
  const p = getProjectFrequencyPath(projectId, baseDir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as PromptFrequencyTable;
  } catch {
    return {};
  }
}

export function saveProjectFrequencyTable(
  table: PromptFrequencyTable,
  projectId: string,
  baseDir = getBaseDir(),
): void {
  const p = getProjectFrequencyPath(projectId, baseDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(table, null, 2), "utf-8");
}

export function loadGlobalFrequencyTable(
  baseDir = getBaseDir(),
): GlobalPromptFrequencyTable {
  const p = getGlobalFrequencyPath(baseDir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as GlobalPromptFrequencyTable;
  } catch {
    return {};
  }
}

export function saveGlobalFrequencyTable(
  table: GlobalPromptFrequencyTable,
  baseDir = getBaseDir(),
): void {
  const p = getGlobalFrequencyPath(baseDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(table, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Pure update functions (immutable)
// ---------------------------------------------------------------------------

export function updateFrequencyTable(
  table: PromptFrequencyTable,
  text: string,
  sessionId: string,
  now = new Date(),
): PromptFrequencyTable {
  const normalized = normalizePrompt(text);
  if (!normalized) return table;

  const key = hashPrompt(normalized);
  const existing = table[key];
  const nowIso = now.toISOString();

  const entry: PromptFrequencyEntry = existing
    ? {
        count: existing.count + 1,
        sessions: Array.from(new Set([...existing.sessions, sessionId])),
        last_text: text,
        first_seen: existing.first_seen,
        last_seen: nowIso,
      }
    : {
        count: 1,
        sessions: [sessionId],
        last_text: text,
        first_seen: nowIso,
        last_seen: nowIso,
      };

  return { ...table, [key]: entry };
}

export function updateGlobalFrequencyTable(
  table: GlobalPromptFrequencyTable,
  text: string,
  sessionId: string,
  projectId: string,
  now = new Date(),
): GlobalPromptFrequencyTable {
  const normalized = normalizePrompt(text);
  if (!normalized) return table;

  const key = hashPrompt(normalized);
  const existing = table[key];
  const nowIso = now.toISOString();

  const entry: GlobalPromptFrequencyEntry = existing
    ? {
        count: existing.count + 1,
        sessions: Array.from(new Set([...existing.sessions, sessionId])),
        project_ids: Array.from(new Set([...existing.project_ids, projectId])),
        last_text: text,
        first_seen: existing.first_seen,
        last_seen: nowIso,
      }
    : {
        count: 1,
        sessions: [sessionId],
        project_ids: [projectId],
        last_text: text,
        first_seen: nowIso,
        last_seen: nowIso,
      };

  return { ...table, [key]: entry };
}

// ---------------------------------------------------------------------------
// Batch update from observation lines
// ---------------------------------------------------------------------------

export function updateFrequencyTablesFromLines(
  lines: readonly string[],
  projectTable: PromptFrequencyTable,
  globalTable: GlobalPromptFrequencyTable,
  now = new Date(),
): {
  readonly project: PromptFrequencyTable;
  readonly global: GlobalPromptFrequencyTable;
} {
  let project = projectTable;
  let global = globalTable;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obs: Partial<Observation>;
    try {
      obs = JSON.parse(trimmed) as Partial<Observation>;
    } catch {
      continue;
    }

    if (obs.event !== "user_prompt" || !obs.input) continue;

    const sessionId = obs.session ?? "unknown";
    const projectId = obs.project_id ?? "unknown";

    project = updateFrequencyTable(project, obs.input, sessionId, now);
    global = updateGlobalFrequencyTable(
      global,
      obs.input,
      sessionId,
      projectId,
      now,
    );
  }

  return { project, global };
}
