import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TddState, TddCycleRecord } from "./types.js";

export function getBaseDir(): string {
  return join(homedir(), ".pi", "red-green");
}

export function getStatePath(baseDir = getBaseDir()): string {
  return join(baseDir, "state.json");
}

export function getHistoryPath(baseDir = getBaseDir()): string {
  return join(baseDir, "history.jsonl");
}

export function ensureStorageLayout(baseDir = getBaseDir()): void {
  mkdirSync(baseDir, { recursive: true });
}

export function loadState(baseDir = getBaseDir()): TddState | null {
  const statePath = getStatePath(baseDir);
  try {
    const raw = readFileSync(statePath, "utf-8");
    return JSON.parse(raw) as TddState;
  } catch {
    return null;
  }
}

export function saveState(state: TddState, baseDir = getBaseDir()): void {
  const statePath = getStatePath(baseDir);
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export function clearState(baseDir = getBaseDir()): void {
  const statePath = getStatePath(baseDir);
  try {
    unlinkSync(statePath);
  } catch {
    // Already absent
  }
}

export function appendCycleRecord(
  record: TddCycleRecord,
  baseDir = getBaseDir(),
): void {
  const historyPath = getHistoryPath(baseDir);
  appendFileSync(historyPath, JSON.stringify(record) + "\n", "utf-8");
}
