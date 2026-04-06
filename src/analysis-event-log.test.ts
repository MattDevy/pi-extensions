import { describe, it, expect, beforeEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendAnalysisEvent,
  consumeAnalysisEvents,
  getEventsPath,
  getConsumedPath,
  type AnalysisEvent,
} from "./analysis-event-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "analysis-event-log-test-"));
}

function makeProjectDir(baseDir: string, projectId: string): void {
  mkdirSync(join(baseDir, "projects", projectId), { recursive: true });
}

function makeEvent(overrides: Partial<AnalysisEvent> = {}): AnalysisEvent {
  return {
    timestamp: "2026-03-27T15:00:00Z",
    project_id: "proj-1",
    project_name: "my-app",
    created: [],
    updated: [],
    deleted: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("analysis-event-log", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = makeTmpDir();
    makeProjectDir(baseDir, "proj-1");
  });

  describe("appendAnalysisEvent", () => {
    it("skips writing when all change arrays are empty", () => {
      const event = makeEvent();
      appendAnalysisEvent(event, baseDir);

      expect(existsSync(getEventsPath("proj-1", baseDir))).toBe(false);
    });

    it("writes a single event as one JSONL line", () => {
      const event = makeEvent({
        created: [
          { id: "use-result-type", title: "Use Result type", scope: "project" },
        ],
      });
      appendAnalysisEvent(event, baseDir);

      const content = readFileSync(getEventsPath("proj-1", baseDir), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]!);
      expect(parsed.project_id).toBe("proj-1");
      expect(parsed.created).toHaveLength(1);
      expect(parsed.created[0].id).toBe("use-result-type");
    });

    it("appends multiple events across calls", () => {
      const event1 = makeEvent({
        created: [{ id: "instinct-a", title: "A", scope: "project" }],
      });
      const event2 = makeEvent({
        timestamp: "2026-03-27T16:00:00Z",
        updated: [
          {
            id: "instinct-b",
            title: "B",
            scope: "global",
            confidence_delta: 0.05,
          },
        ],
      });

      appendAnalysisEvent(event1, baseDir);
      appendAnalysisEvent(event2, baseDir);

      const content = readFileSync(getEventsPath("proj-1", baseDir), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);
    });

    it("creates parent directories if needed", () => {
      const event = makeEvent({
        project_id: "proj-new",
        deleted: [{ id: "old-instinct", title: "Old", scope: "project" }],
      });
      // proj-new dir doesn't exist yet
      appendAnalysisEvent(event, baseDir);

      expect(existsSync(getEventsPath("proj-new", baseDir))).toBe(true);
    });
  });

  describe("consumeAnalysisEvents", () => {
    it("returns empty array when no events file exists", () => {
      const events = consumeAnalysisEvents("proj-1", baseDir);
      expect(events).toEqual([]);
    });

    it("returns all events and deletes the file", () => {
      const event1 = makeEvent({
        created: [{ id: "a", title: "A", scope: "project" }],
      });
      const event2 = makeEvent({
        updated: [
          { id: "b", title: "B", scope: "global", confidence_delta: 0.1 },
        ],
      });

      appendAnalysisEvent(event1, baseDir);
      appendAnalysisEvent(event2, baseDir);

      const events = consumeAnalysisEvents("proj-1", baseDir);
      expect(events).toHaveLength(2);
      expect(events[0]!.created).toHaveLength(1);
      expect(events[1]!.updated).toHaveLength(1);

      // Files should be cleaned up
      expect(existsSync(getEventsPath("proj-1", baseDir))).toBe(false);
      expect(existsSync(getConsumedPath("proj-1", baseDir))).toBe(false);
    });

    it("returns empty array on second consume (idempotent)", () => {
      appendAnalysisEvent(
        makeEvent({ created: [{ id: "a", title: "A", scope: "project" }] }),
        baseDir,
      );

      const first = consumeAnalysisEvents("proj-1", baseDir);
      expect(first).toHaveLength(1);

      const second = consumeAnalysisEvents("proj-1", baseDir);
      expect(second).toEqual([]);
    });

    it("recovers orphaned consumed file from prior crash", () => {
      // Simulate: extension renamed file but crashed before deleting .consumed
      const consumedPath = getConsumedPath("proj-1", baseDir);
      const orphanedEvent = makeEvent({
        created: [{ id: "orphan", title: "Orphan", scope: "project" }],
      });
      writeFileSync(
        consumedPath,
        JSON.stringify(orphanedEvent) + "\n",
        "utf-8",
      );

      // Also write a new event to the main file
      appendAnalysisEvent(
        makeEvent({
          updated: [
            {
              id: "new",
              title: "New",
              scope: "global",
              confidence_delta: 0.05,
            },
          ],
        }),
        baseDir,
      );

      const events = consumeAnalysisEvents("proj-1", baseDir);
      expect(events).toHaveLength(2);
      // Orphaned event comes first
      expect(events[0]!.created[0]!.id).toBe("orphan");
      expect(events[1]!.updated[0]!.id).toBe("new");

      // Both files cleaned up
      expect(existsSync(getEventsPath("proj-1", baseDir))).toBe(false);
      expect(existsSync(getConsumedPath("proj-1", baseDir))).toBe(false);
    });

    it("recovers orphaned consumed file even when no new events exist", () => {
      const consumedPath = getConsumedPath("proj-1", baseDir);
      writeFileSync(
        consumedPath,
        JSON.stringify(
          makeEvent({ deleted: [{ id: "x", title: "X", scope: "project" }] }),
        ) + "\n",
        "utf-8",
      );

      const events = consumeAnalysisEvents("proj-1", baseDir);
      expect(events).toHaveLength(1);
      expect(events[0]!.deleted[0]!.id).toBe("x");
    });

    it("skips malformed lines without losing valid events", () => {
      const eventsPath = getEventsPath("proj-1", baseDir);
      const validEvent = makeEvent({
        created: [{ id: "valid", title: "Valid", scope: "project" }],
      });
      writeFileSync(
        eventsPath,
        `not-json\n${JSON.stringify(validEvent)}\n{broken\n`,
        "utf-8",
      );

      const events = consumeAnalysisEvents("proj-1", baseDir);
      expect(events).toHaveLength(1);
      expect(events[0]!.created[0]!.id).toBe("valid");
    });
  });
});
