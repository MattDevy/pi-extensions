import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Instinct } from "./types.js";
import {
  getTrendArrow,
  formatInstinct,
  groupByDomain,
  formatStatusOutput,
  handleInstinctStatus,
} from "./instinct-status.js";
import { ensureStorageLayout } from "./storage.js";
import { saveInstinct } from "./instinct-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-cl-status-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test Instinct",
    trigger: "when testing",
    action: "run the tests",
    confidence: 0.7,
    domain: "testing",
    source: "personal",
    scope: "project",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 3,
    contradicted_count: 1,
    inactive_count: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getTrendArrow
// ---------------------------------------------------------------------------

describe("getTrendArrow", () => {
  it("returns ↑ when confirmed > contradicted", () => {
    const instinct = makeInstinct({
      confirmed_count: 5,
      contradicted_count: 2,
    });
    expect(getTrendArrow(instinct)).toBe("↑");
  });

  it("returns ↓ when contradicted > confirmed", () => {
    const instinct = makeInstinct({
      confirmed_count: 1,
      contradicted_count: 4,
    });
    expect(getTrendArrow(instinct)).toBe("↓");
  });

  it("returns → when confirmed equals contradicted", () => {
    const instinct = makeInstinct({
      confirmed_count: 3,
      contradicted_count: 3,
    });
    expect(getTrendArrow(instinct)).toBe("→");
  });

  it("returns → when both are zero", () => {
    const instinct = makeInstinct({
      confirmed_count: 0,
      contradicted_count: 0,
    });
    expect(getTrendArrow(instinct)).toBe("→");
  });
});

// ---------------------------------------------------------------------------
// formatInstinct
// ---------------------------------------------------------------------------

describe("formatInstinct", () => {
  it("includes confidence, title, trend arrow, and feedback ratio", () => {
    const instinct = makeInstinct({
      confidence: 0.75,
      title: "My Instinct",
      confirmed_count: 4,
      contradicted_count: 1,
      inactive_count: 2,
    });
    const line = formatInstinct(instinct);
    expect(line).toContain("[0.75]");
    expect(line).toContain("My Instinct");
    expect(line).toContain("↑");
    expect(line).toContain("✓4");
    expect(line).toContain("✗1");
    expect(line).toContain("○2");
  });

  it("does NOT include removal warning for normal instinct", () => {
    const instinct = makeInstinct({ flagged_for_removal: false });
    const line = formatInstinct(instinct);
    expect(line).not.toContain("FLAGGED FOR REMOVAL");
  });

  it("highlights instincts flagged for removal", () => {
    const instinct = makeInstinct({ flagged_for_removal: true });
    const line = formatInstinct(instinct);
    expect(line).toContain("FLAGGED FOR REMOVAL");
  });
});

// ---------------------------------------------------------------------------
// groupByDomain
// ---------------------------------------------------------------------------

describe("groupByDomain", () => {
  it("groups instincts by domain", () => {
    const instincts = [
      makeInstinct({ id: "a", domain: "testing" }),
      makeInstinct({ id: "b", domain: "git" }),
      makeInstinct({ id: "c", domain: "testing" }),
    ];
    const groups = groupByDomain(instincts);
    expect(Object.keys(groups)).toHaveLength(2);
    expect(groups["testing"]).toHaveLength(2);
    expect(groups["git"]).toHaveLength(1);
  });

  it("returns empty object for empty input", () => {
    expect(groupByDomain([])).toEqual({});
  });

  it("uses 'uncategorized' for missing domain", () => {
    const instinct = makeInstinct({ domain: "" });
    const groups = groupByDomain([instinct]);
    expect(groups["uncategorized"]).toHaveLength(1);
  });

  it("places each instinct in exactly one group", () => {
    const instincts = [
      makeInstinct({ id: "x", domain: "alpha" }),
      makeInstinct({ id: "y", domain: "beta" }),
      makeInstinct({ id: "z", domain: "alpha" }),
    ];
    const groups = groupByDomain(instincts);
    const total = Object.values(groups).flat().length;
    expect(total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// formatStatusOutput
// ---------------------------------------------------------------------------

describe("formatStatusOutput", () => {
  it("returns no-instincts message for empty list", () => {
    expect(formatStatusOutput([])).toBe("No instincts found.");
  });

  it("includes domain headers", () => {
    const instincts = [makeInstinct({ domain: "workflow" })];
    const output = formatStatusOutput(instincts);
    expect(output).toContain("## workflow");
  });

  it("includes total count summary", () => {
    const instincts = [makeInstinct({ id: "a" }), makeInstinct({ id: "b" })];
    const output = formatStatusOutput(instincts);
    expect(output).toContain("Total: 2 instincts");
  });

  it("includes flagged count in summary", () => {
    const instincts = [
      makeInstinct({ id: "a", flagged_for_removal: false }),
      makeInstinct({ id: "b", flagged_for_removal: true }),
    ];
    const output = formatStatusOutput(instincts);
    expect(output).toContain("1 flagged for removal");
  });

  it("sorts domains alphabetically", () => {
    const instincts = [
      makeInstinct({ id: "z", domain: "zebra" }),
      makeInstinct({ id: "a", domain: "alpha" }),
    ];
    const output = formatStatusOutput(instincts);
    const alphaIdx = output.indexOf("## alpha");
    const zebraIdx = output.indexOf("## zebra");
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });

  it("contains title of instincts in output", () => {
    const instincts = [makeInstinct({ title: "My Special Instinct" })];
    const output = formatStatusOutput(instincts);
    expect(output).toContain("My Special Instinct");
  });
});

// ---------------------------------------------------------------------------
// handleInstinctStatus (integration with real files)
// ---------------------------------------------------------------------------

describe("handleInstinctStatus", () => {
  it("notifies with no-instincts message when storage is empty", async () => {
    const notifyMock = vi.fn();
    const ctx = { ui: { notify: notifyMock } } as unknown as Parameters<
      typeof handleInstinctStatus
    >[1];

    await handleInstinctStatus("", ctx, null, tmpDir);
    expect(notifyMock).toHaveBeenCalledOnce();
    expect(notifyMock.mock.calls[0]?.[0]).toContain("No instincts found");
  });

  it("notifies with formatted output when instincts exist", async () => {
    const project = {
      id: "proj123456ab",
      name: "my-project",
      root: "/tmp/my-project",
      remote: "https://github.com/user/repo",
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    };
    ensureStorageLayout(project, tmpDir);

    const instinct = makeInstinct({
      id: "test-format",
      domain: "formatting",
      title: "Format Output",
    });

    const instinctsDir = join(
      tmpDir,
      "projects",
      project.id,
      "instincts",
      "personal",
    );
    saveInstinct(instinct, instinctsDir);

    const notifyMock = vi.fn();
    const ctx = { ui: { notify: notifyMock } } as unknown as Parameters<
      typeof handleInstinctStatus
    >[1];

    await handleInstinctStatus("", ctx, project.id, tmpDir);
    expect(notifyMock).toHaveBeenCalledOnce();
    const msg = notifyMock.mock.calls[0]?.[0] as string;
    expect(msg).toContain("## formatting");
    expect(msg).toContain("Format Output");
  });
});
