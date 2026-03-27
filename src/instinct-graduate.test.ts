/**
 * Tests for /instinct-graduate command.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Instinct } from "./types.js";
import { saveInstinct, loadInstinct } from "./instinct-store.js";
import { ensureStorageLayout, getProjectInstinctsDir } from "./storage.js";
import {
  COMMAND_NAME,
  buildGraduationPrompt,
  graduateToAgentsMd,
  graduateToSkill,
  graduateToCommand,
  cullExpiredInstincts,
  decayExpiredInstincts,
  handleInstinctGraduate,
} from "./instinct-graduate.js";
import type { GraduationCandidate, DomainCluster, TtlResult } from "./graduation.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "graduate-test-"));
});

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: "test-instinct",
    title: "Test Instinct",
    trigger: "when testing",
    action: "Do the test thing.",
    confidence: 0.85,
    domain: "testing",
    source: "personal",
    scope: "project",
    project_id: "proj123",
    project_name: "my-project",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-15T00:00:00.000Z",
    observation_count: 5,
    confirmed_count: 5,
    contradicted_count: 0,
    inactive_count: 0,
    ...overrides,
  };
}

function makeCtx(notify = vi.fn()): ExtensionCommandContext {
  return { cwd: baseDir, ui: { notify } } as unknown as ExtensionCommandContext;
}

function makePi(sendUserMessage = vi.fn()): ExtensionAPI {
  return { sendUserMessage } as unknown as ExtensionAPI;
}

function setupProject(projectId = "proj123"): void {
  ensureStorageLayout(
    {
      id: projectId,
      name: "test",
      root: baseDir,
      remote: "git@example.com:test.git",
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen: "2026-03-27T00:00:00.000Z",
    },
    baseDir
  );
}

// ---------------------------------------------------------------------------
// COMMAND_NAME
// ---------------------------------------------------------------------------

describe("COMMAND_NAME", () => {
  it("exports the correct command name", () => {
    expect(COMMAND_NAME).toBe("instinct-graduate");
  });
});

// ---------------------------------------------------------------------------
// buildGraduationPrompt
// ---------------------------------------------------------------------------

describe("buildGraduationPrompt", () => {
  it("includes AGENTS.md candidates when present", () => {
    const candidates: GraduationCandidate[] = [
      { instinct: makeInstinct(), target: "agents-md", reason: "Mature" },
    ];
    const prompt = buildGraduationPrompt(candidates, [], [], { toCull: [], toDecay: [] });
    expect(prompt).toContain("AGENTS.md Graduation Candidates");
    expect(prompt).toContain("test-instinct");
  });

  it("includes skill cluster info when present", () => {
    const clusters: DomainCluster[] = [
      { domain: "git", instincts: [makeInstinct({ id: "a" }), makeInstinct({ id: "b" }), makeInstinct({ id: "c" })] },
    ];
    const prompt = buildGraduationPrompt([], clusters, [], { toCull: [], toDecay: [] });
    expect(prompt).toContain("Skill Scaffold Candidates");
    expect(prompt).toContain("git");
  });

  it("includes command cluster info when present", () => {
    const clusters: DomainCluster[] = [
      { domain: "deploy", instincts: [makeInstinct({ id: "d1" }), makeInstinct({ id: "d2" }), makeInstinct({ id: "d3" })] },
    ];
    const prompt = buildGraduationPrompt([], [], clusters, { toCull: [], toDecay: [] });
    expect(prompt).toContain("Command Scaffold Candidates");
    expect(prompt).toContain("deploy");
  });

  it("includes TTL info when present", () => {
    const ttl: TtlResult = {
      toCull: [makeInstinct({ confidence: 0.2 })],
      toDecay: [makeInstinct({ confidence: 0.5 })],
    };
    const prompt = buildGraduationPrompt([], [], [], ttl);
    expect(prompt).toContain("TTL Enforcement");
    expect(prompt).toContain("deleted");
    expect(prompt).toContain("decayed");
  });

  it("includes next steps", () => {
    const prompt = buildGraduationPrompt([], [], [], { toCull: [], toDecay: [] });
    expect(prompt).toContain("Next Steps");
  });
});

// ---------------------------------------------------------------------------
// graduateToAgentsMd
// ---------------------------------------------------------------------------

describe("graduateToAgentsMd", () => {
  it("writes instincts to AGENTS.md and marks them graduated", () => {
    setupProject();
    const dir = getProjectInstinctsDir("proj123", "personal", baseDir);
    const inst = makeInstinct({ id: "grad-one" });
    saveInstinct(inst, dir);

    const agentsMdPath = join(baseDir, "AGENTS.md");
    const graduated = graduateToAgentsMd([inst], agentsMdPath, baseDir);

    expect(graduated).toHaveLength(1);
    expect(graduated[0]?.graduated_to).toBe("agents-md");
    expect(graduated[0]?.graduated_at).toBeDefined();

    // AGENTS.md should contain the entry
    const content = readFileSync(agentsMdPath, "utf-8");
    expect(content).toContain("### Test Instinct");

    // Instinct file on disk should be marked graduated
    const onDisk = loadInstinct(join(dir, "grad-one.md"));
    expect(onDisk.graduated_to).toBe("agents-md");
  });

  it("returns empty array for empty input", () => {
    const result = graduateToAgentsMd([], join(baseDir, "AGENTS.md"), baseDir);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// graduateToSkill
// ---------------------------------------------------------------------------

describe("graduateToSkill", () => {
  it("writes SKILL.md and marks instincts graduated", () => {
    setupProject();
    const dir = getProjectInstinctsDir("proj123", "personal", baseDir);
    const instincts = Array.from({ length: 3 }, (_, i) => {
      const inst = makeInstinct({ id: `skill-inst-${i}`, domain: "git" });
      saveInstinct(inst, dir);
      return inst;
    });

    const cluster: DomainCluster = { domain: "git", instincts };
    const outputDir = join(baseDir, "skills", "git");
    const scaffold = graduateToSkill(cluster, outputDir, baseDir);

    expect(scaffold.name).toBe("git");
    expect(existsSync(join(outputDir, "SKILL.md"))).toBe(true);

    // All instincts should be marked graduated
    for (const inst of instincts) {
      const onDisk = loadInstinct(join(dir, `${inst.id}.md`));
      expect(onDisk.graduated_to).toBe("skill");
    }
  });
});

// ---------------------------------------------------------------------------
// graduateToCommand
// ---------------------------------------------------------------------------

describe("graduateToCommand", () => {
  it("writes command doc and marks instincts graduated", () => {
    setupProject();
    const dir = getProjectInstinctsDir("proj123", "personal", baseDir);
    const instincts = Array.from({ length: 3 }, (_, i) => {
      const inst = makeInstinct({ id: `cmd-inst-${i}`, domain: "deploy" });
      saveInstinct(inst, dir);
      return inst;
    });

    const cluster: DomainCluster = { domain: "deploy", instincts };
    const outputDir = join(baseDir, "commands");
    const scaffold = graduateToCommand(cluster, outputDir, baseDir);

    expect(scaffold.name).toBe("deploy");
    expect(existsSync(join(outputDir, "deploy-command.md"))).toBe(true);

    for (const inst of instincts) {
      const onDisk = loadInstinct(join(dir, `${inst.id}.md`));
      expect(onDisk.graduated_to).toBe("command");
    }
  });
});

// ---------------------------------------------------------------------------
// cullExpiredInstincts
// ---------------------------------------------------------------------------

describe("cullExpiredInstincts", () => {
  it("deletes instinct files from disk", () => {
    setupProject();
    const dir = getProjectInstinctsDir("proj123", "personal", baseDir);
    const inst = makeInstinct({ id: "to-cull" });
    saveInstinct(inst, dir);
    expect(existsSync(join(dir, "to-cull.md"))).toBe(true);

    const deleted = cullExpiredInstincts([inst], baseDir);
    expect(deleted).toBe(1);
    expect(existsSync(join(dir, "to-cull.md"))).toBe(false);
  });

  it("returns 0 when files already gone", () => {
    const inst = makeInstinct({ id: "already-gone", project_id: "proj123" });
    const deleted = cullExpiredInstincts([inst], baseDir);
    expect(deleted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// decayExpiredInstincts
// ---------------------------------------------------------------------------

describe("decayExpiredInstincts", () => {
  it("halves confidence and flags for removal", () => {
    setupProject();
    const dir = getProjectInstinctsDir("proj123", "personal", baseDir);
    const inst = makeInstinct({ id: "to-decay", confidence: 0.6 });
    saveInstinct(inst, dir);

    const decayed = decayExpiredInstincts([inst], baseDir);
    expect(decayed).toBe(1);

    const onDisk = loadInstinct(join(dir, "to-decay.md"));
    expect(onDisk.confidence).toBeCloseTo(0.3, 1);
    expect(onDisk.flagged_for_removal).toBe(true);
  });

  it("clamps confidence to 0.1 minimum", () => {
    setupProject();
    const dir = getProjectInstinctsDir("proj123", "personal", baseDir);
    const inst = makeInstinct({ id: "very-low", confidence: 0.15 });
    saveInstinct(inst, dir);

    decayExpiredInstincts([inst], baseDir);

    const onDisk = loadInstinct(join(dir, "very-low.md"));
    expect(onDisk.confidence).toBeGreaterThanOrEqual(0.1);
  });
});

// ---------------------------------------------------------------------------
// handleInstinctGraduate
// ---------------------------------------------------------------------------

describe("handleInstinctGraduate", () => {
  it("notifies when no instincts exist", async () => {
    const notify = vi.fn();
    const ctx = makeCtx(notify);
    const pi = makePi();

    await handleInstinctGraduate("", ctx, pi, "nonexistent", baseDir);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("No instincts"),
      "info"
    );
  });

  it("notifies when no candidates are ready", async () => {
    setupProject();
    const dir = getProjectInstinctsDir("proj123", "personal", baseDir);
    // Young instinct with low confidence - won't qualify
    saveInstinct(
      makeInstinct({
        id: "too-young",
        confidence: 0.3,
        confirmed_count: 0,
        created_at: new Date().toISOString(),
      }),
      dir
    );

    const notify = vi.fn();
    const ctx = makeCtx(notify);
    const pi = makePi();

    await handleInstinctGraduate("", ctx, pi, "proj123", baseDir, null);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("No instincts are ready"),
      "info"
    );
  });

  it("sends graduation prompt when candidates exist", async () => {
    setupProject();
    const dir = getProjectInstinctsDir("proj123", "personal", baseDir);
    saveInstinct(
      makeInstinct({
        id: "mature-one",
        confidence: 0.85,
        confirmed_count: 5,
        created_at: "2026-01-01T00:00:00.000Z",
      }),
      dir
    );

    const sendUserMessage = vi.fn();
    const ctx = makeCtx();
    const pi = makePi(sendUserMessage);

    await handleInstinctGraduate("", ctx, pi, "proj123", baseDir, null);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const [prompt, options] = sendUserMessage.mock.calls[0] as [string, { deliverAs: string }];
    expect(prompt).toContain("mature-one");
    expect(options).toEqual({ deliverAs: "followUp" });
  });
});
