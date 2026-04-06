import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Instinct } from "./types.js";
import { COMMAND_NAME, handleInstinctEvolve } from "./instinct-evolve.js";
import { ensureStorageLayout } from "./storage.js";
import { saveInstinct } from "./instinct-store.js";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-cl-evolve-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test instinct",
    trigger: "When testing",
    action: "Do the test thing",
    confidence: 0.7,
    domain: "general",
    source: "personal",
    scope: "project",
    project_id: "abc123",
    project_name: "test-project",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 2,
    contradicted_count: 0,
    inactive_count: 1,
    ...overrides,
  };
}

function makeMockCtx(): ExtensionCommandContext {
  return {
    ui: {
      notify: vi.fn(),
      select: vi.fn(),
      confirm: vi.fn(),
      input: vi.fn(),
      editor: vi.fn(),
      custom: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      setWorkingMessage: vi.fn(),
      setTitle: vi.fn(),
      setEditorText: vi.fn(),
      getEditorText: vi.fn(),
      pasteToEditor: vi.fn(),
      setToolsExpanded: vi.fn(),
      getToolsExpanded: vi.fn(),
      setEditorComponent: vi.fn(),
      setFooter: vi.fn(),
      setHeader: vi.fn(),
      getAllThemes: vi.fn(),
      getTheme: vi.fn(),
      setTheme: vi.fn(),
      theme: {} as ExtensionCommandContext["ui"]["theme"],
    },
    cwd: tmpDir,
    hasUI: true,
    sessionManager: {} as ExtensionCommandContext["sessionManager"],
    modelRegistry: {} as ExtensionCommandContext["modelRegistry"],
    model: {} as ExtensionCommandContext["model"],
    isIdle: vi.fn(),
    abort: vi.fn(),
    hasPendingMessages: vi.fn(),
    shutdown: vi.fn(),
    getContextUsage: vi.fn(),
    compact: vi.fn(),
    getSystemPrompt: vi.fn(),
    waitForIdle: vi.fn(),
    newSession: vi.fn(),
    fork: vi.fn(),
    navigateTree: vi.fn(),
    reload: vi.fn(),
  } as unknown as ExtensionCommandContext;
}

function makeMockPi(): ExtensionAPI {
  return {
    sendUserMessage: vi.fn(),
  } as unknown as ExtensionAPI;
}

describe("instinct-evolve", () => {
  it("exports the correct command name", () => {
    expect(COMMAND_NAME).toBe("instinct-evolve");
  });

  it("notifies when no instincts exist", async () => {
    const ctx = makeMockCtx();
    const pi = makeMockPi();
    await handleInstinctEvolve("", ctx, pi, "nonexistent", tmpDir);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("No instincts"),
      "info",
    );
    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("sends evolve prompt via pi.sendUserMessage when instincts exist", async () => {
    const projectId = "abc123";
    ensureStorageLayout(
      {
        id: projectId,
        name: "test",
        root: tmpDir,
        remote: "git@example.com:test.git",
        created_at: "2026-01-01T00:00:00.000Z",
        last_seen: "2026-01-01T00:00:00.000Z",
      },
      tmpDir,
    );
    const instinct = makeInstinct({
      id: "test-one",
      scope: "project",
      project_id: projectId,
    });
    saveInstinct(
      instinct,
      join(tmpDir, "projects", projectId, "instincts", "personal"),
    );

    const ctx = makeMockCtx();
    const pi = makeMockPi();
    await handleInstinctEvolve("", ctx, pi, projectId, tmpDir, null, []);

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    const [prompt, options] = (pi.sendUserMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, { deliverAs: string }];
    expect(prompt).toContain("test-one");
    expect(prompt).toContain("Merge candidates");
    expect(options).toEqual({ deliverAs: "followUp" });
  });
});
