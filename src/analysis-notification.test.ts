import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatNotification,
  checkAnalysisNotifications,
} from "./analysis-notification.js";
import {
  appendAnalysisEvent,
  type AnalysisEvent,
} from "./analysis-event-log.js";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeMockCtx(): ExtensionContext {
  return {
    ui: {
      notify: vi.fn(),
      select: vi.fn(),
      confirm: vi.fn(),
      input: vi.fn(),
      onTerminalInput: vi.fn(),
      setStatus: vi.fn(),
      setWorkingMessage: vi.fn(),
      setWidget: vi.fn(),
      setFooter: vi.fn(),
      setHeader: vi.fn(),
      setTitle: vi.fn(),
      custom: vi.fn(),
      pasteToEditor: vi.fn(),
      setEditorText: vi.fn(),
      getEditorText: vi.fn(),
      editor: vi.fn(),
      setEditorComponent: vi.fn(),
      theme: {} as ExtensionContext["ui"]["theme"],
      getAllThemes: vi.fn(),
      getTheme: vi.fn(),
      setTheme: vi.fn(),
      getToolsExpanded: vi.fn(),
      setToolsExpanded: vi.fn(),
    },
    hasUI: true,
    cwd: "/tmp",
    sessionManager: {
      getSessionId: vi.fn().mockReturnValue("session-1"),
    } as unknown as ExtensionContext["sessionManager"],
    modelRegistry: {} as unknown as ExtensionContext["modelRegistry"],
    model: undefined,
    isIdle: vi.fn(),
    abort: vi.fn(),
    hasPendingMessages: vi.fn(),
    shutdown: vi.fn(),
    getContextUsage: vi.fn(),
    compact: vi.fn(),
    getSystemPrompt: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// formatNotification
// ---------------------------------------------------------------------------

describe("formatNotification", () => {
  it("returns null for empty events array", () => {
    expect(formatNotification([])).toBeNull();
  });

  it("returns null when all change arrays are empty", () => {
    expect(formatNotification([makeEvent()])).toBeNull();
  });

  it("formats created instincts with IDs", () => {
    const events = [
      makeEvent({
        created: [
          { id: "use-result-type", title: "Use Result type", scope: "project" },
        ],
      }),
    ];
    const result = formatNotification(events);
    expect(result).toBe(
      "[instincts] Background analysis: +1 new (use-result-type)",
    );
  });

  it("formats multiple change types", () => {
    const events = [
      makeEvent({
        created: [{ id: "a", title: "A", scope: "project" }],
        updated: [
          { id: "b", title: "B", scope: "global", confidence_delta: 0.05 },
          { id: "c", title: "C", scope: "project", confidence_delta: -0.1 },
        ],
        deleted: [{ id: "d", title: "D", scope: "project" }],
      }),
    ];
    const result = formatNotification(events);
    expect(result).toBe(
      "[instincts] Background analysis: +1 new (a), 2 updated, 1 deleted",
    );
  });

  it("aggregates across multiple events", () => {
    const events = [
      makeEvent({
        created: [{ id: "x", title: "X", scope: "project" }],
      }),
      makeEvent({
        created: [{ id: "y", title: "Y", scope: "global" }],
        updated: [
          { id: "z", title: "Z", scope: "project", confidence_delta: 0.1 },
        ],
      }),
    ];
    const result = formatNotification(events);
    expect(result).toBe(
      "[instincts] Background analysis: +2 new (x, y), 1 updated",
    );
  });

  it("truncates created IDs list beyond 3", () => {
    const events = [
      makeEvent({
        created: [
          { id: "a", title: "A", scope: "project" },
          { id: "b", title: "B", scope: "project" },
          { id: "c", title: "C", scope: "project" },
          { id: "d", title: "D", scope: "project" },
        ],
      }),
    ];
    const result = formatNotification(events);
    expect(result).toBe(
      "[instincts] Background analysis: +4 new (a, b, c, ...)",
    );
  });
});

// ---------------------------------------------------------------------------
// checkAnalysisNotifications
// ---------------------------------------------------------------------------

describe("checkAnalysisNotifications", () => {
  let baseDir: string;
  let ctx: ExtensionContext;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "analysis-notif-test-"));
    mkdirSync(join(baseDir, "projects", "proj-1"), { recursive: true });
    ctx = makeMockCtx();
  });

  it("does nothing when projectId is null", () => {
    checkAnalysisNotifications(ctx, null, baseDir);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("does nothing when no events exist", () => {
    checkAnalysisNotifications(ctx, "proj-1", baseDir);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("shows notification and consumes events", () => {
    appendAnalysisEvent(
      makeEvent({
        created: [
          { id: "new-instinct", title: "New instinct", scope: "project" },
        ],
      }),
      baseDir,
    );

    checkAnalysisNotifications(ctx, "proj-1", baseDir);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "[instincts] Background analysis: +1 new (new-instinct)",
      "info",
    );

    // Second call should not notify (events consumed)
    checkAnalysisNotifications(ctx, "proj-1", baseDir);
    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
  });

  it("aggregates events from multiple analyzer runs", () => {
    appendAnalysisEvent(
      makeEvent({
        created: [{ id: "a", title: "A", scope: "project" }],
      }),
      baseDir,
    );
    appendAnalysisEvent(
      makeEvent({
        updated: [
          { id: "b", title: "B", scope: "global", confidence_delta: 0.05 },
        ],
        deleted: [{ id: "c", title: "C", scope: "project" }],
      }),
      baseDir,
    );

    checkAnalysisNotifications(ctx, "proj-1", baseDir);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "[instincts] Background analysis: +1 new (a), 1 updated, 1 deleted",
      "info",
    );
  });
});
