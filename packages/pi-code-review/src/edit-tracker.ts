import { detectLanguage } from "./language-detector.js";
import type { EditedFile, TurnEdits } from "./types.js";

const FILE_PATH_RE = /(?:File|file|path)[:\s]+(\S+)/;

type TrackedTool = "Write" | "Edit";
const TRACKED_TOOLS = new Set<TrackedTool>(["Write", "Edit"]);

function extractFilePath(result: unknown): string | null {
  if (!result) return null;

  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj["file_path"] === "string") return obj["file_path"];
    if (typeof obj["path"] === "string") return obj["path"];
  }

  if (typeof result === "string") {
    const match = result.match(FILE_PATH_RE);
    return match?.[1] ?? null;
  }

  return null;
}

export interface EditTracker {
  trackEdit(toolName: string, result: unknown): void;
  onTurnEnd(turnIndex: number): void;
  getLastTurnEdits(): TurnEdits | null;
  clearLastTurnEdits(): void;
}

export function createEditTracker(): EditTracker {
  const current = new Map<string, EditedFile>();
  let lastTurn: TurnEdits | null = null;

  return {
    trackEdit(toolName: string, result: unknown): void {
      if (!TRACKED_TOOLS.has(toolName as TrackedTool)) return;

      const path = extractFilePath(result);
      if (!path) return;

      const language = detectLanguage(path);
      if (!language) return;
      if (current.has(path)) return;

      current.set(path, { path, language });
    },

    onTurnEnd(turnIndex: number): void {
      if (current.size === 0) {
        lastTurn = null;
      } else {
        lastTurn = { files: [...current.values()], turnIndex };
      }
      current.clear();
    },

    getLastTurnEdits(): TurnEdits | null {
      return lastTurn;
    },

    clearLastTurnEdits(): void {
      lastTurn = null;
    },
  };
}
