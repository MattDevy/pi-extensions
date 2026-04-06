import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  filterInstincts,
  loadAndFilterInstincts,
  loadAndFilterFromConfig,
} from "./instinct-loader.js";
import { saveInstinct, invalidateCache } from "./instinct-store.js";
import { getProjectInstinctsDir, getGlobalInstinctsDir } from "./storage.js";
import type { Instinct, Config } from "./types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  const base: Instinct = {
    id: overrides.id ?? "test-instinct",
    title: overrides.title ?? "Test Instinct",
    trigger: overrides.trigger ?? "when something happens",
    action: overrides.action ?? "do something",
    confidence: overrides.confidence ?? 0.7,
    domain: overrides.domain ?? "testing",
    source: overrides.source ?? "personal",
    scope: overrides.scope ?? "project",
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-01-01T00:00:00Z",
    observation_count: overrides.observation_count ?? 5,
    confirmed_count: overrides.confirmed_count ?? 2,
    contradicted_count: overrides.contradicted_count ?? 0,
    inactive_count: overrides.inactive_count ?? 0,
  };
  if (overrides.project_id !== undefined)
    base.project_id = overrides.project_id;
  if (overrides.project_name !== undefined)
    base.project_name = overrides.project_name;
  if (overrides.evidence !== undefined) base.evidence = overrides.evidence;
  if (overrides.flagged_for_removal !== undefined)
    base.flagged_for_removal = overrides.flagged_for_removal;
  return base;
}

const BASE_CONFIG: Config = {
  run_interval_minutes: 5,
  min_observations_to_analyze: 20,
  min_confidence: 0.5,
  max_instincts: 20,
  max_injection_chars: 4000,
  model: "claude-haiku-4-5",
  timeout_seconds: 120,
  active_hours_start: 8,
  active_hours_end: 23,
  max_idle_seconds: 1800,
  max_total_instincts_per_project: 30,
  max_total_instincts_global: 20,
  max_new_instincts_per_run: 3,
  flagged_cleanup_days: 7,
  instinct_ttl_days: 28,
  dreaming_enabled: true,
  consolidation_interval_days: 7,
  consolidation_min_sessions: 10,
  recurring_prompt_min_sessions: 3,
  recurring_prompt_score_boost: 3,
};

// ---------------------------------------------------------------------------
// filterInstincts - pure function tests (no I/O)
// ---------------------------------------------------------------------------

describe("filterInstincts", () => {
  it("filters instincts below min_confidence threshold", () => {
    const instincts = [
      makeInstinct({ id: "high", confidence: 0.8 }),
      makeInstinct({ id: "low", confidence: 0.3 }),
      makeInstinct({ id: "at-threshold", confidence: 0.5 }),
    ];
    const result = filterInstincts(instincts, 0.5, 20);
    const ids = result.map((i) => i.id);
    expect(ids).toContain("high");
    expect(ids).toContain("at-threshold");
    expect(ids).not.toContain("low");
  });

  it("excludes instincts flagged_for_removal", () => {
    const instincts = [
      makeInstinct({ id: "normal", confidence: 0.8 }),
      makeInstinct({
        id: "flagged",
        confidence: 0.9,
        flagged_for_removal: true,
      }),
    ];
    const result = filterInstincts(instincts, 0.1, 20);
    const ids = result.map((i) => i.id);
    expect(ids).toContain("normal");
    expect(ids).not.toContain("flagged");
  });

  it("sorts instincts by confidence descending", () => {
    const instincts = [
      makeInstinct({ id: "mid", confidence: 0.6 }),
      makeInstinct({ id: "high", confidence: 0.9 }),
      makeInstinct({ id: "low", confidence: 0.5 }),
    ];
    const result = filterInstincts(instincts, 0.1, 20);
    expect(result[0]?.id).toBe("high");
    expect(result[1]?.id).toBe("mid");
    expect(result[2]?.id).toBe("low");
  });

  it("caps results to maxInstincts", () => {
    const instincts = Array.from({ length: 10 }, (_, i) =>
      makeInstinct({ id: `inst-${i}`, confidence: 0.5 + i * 0.01 }),
    );
    const result = filterInstincts(instincts, 0.1, 3);
    expect(result).toHaveLength(3);
  });

  it("returns empty array when all instincts are below threshold", () => {
    const instincts = [
      makeInstinct({ id: "a", confidence: 0.2 }),
      makeInstinct({ id: "b", confidence: 0.3 }),
    ];
    const result = filterInstincts(instincts, 0.5, 20);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(filterInstincts([], 0.5, 20)).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const instincts = [
      makeInstinct({ id: "b", confidence: 0.7 }),
      makeInstinct({ id: "a", confidence: 0.8 }),
    ];
    const original = [...instincts];
    filterInstincts(instincts, 0.1, 20);
    expect(instincts[0]?.id).toBe(original[0]?.id);
  });
});

// ---------------------------------------------------------------------------
// loadAndFilterInstincts - I/O-based tests
// ---------------------------------------------------------------------------

describe("loadAndFilterInstincts", () => {
  let baseDir: string;
  const projectId = "test-proj-01";

  beforeAll(() => {
    baseDir = mkdtempSync(join(tmpdir(), "pi-cl-test-"));
    // Create required directories
    mkdirSync(getProjectInstinctsDir(projectId, "personal", baseDir), {
      recursive: true,
    });
    mkdirSync(getGlobalInstinctsDir("personal", baseDir), { recursive: true });
  });

  beforeEach(() => {
    invalidateCache();
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("loads project instincts when projectId is provided", () => {
    const instinct = makeInstinct({
      id: "proj-instinct",
      confidence: 0.7,
      scope: "project",
      project_id: projectId,
    });
    saveInstinct(
      instinct,
      getProjectInstinctsDir(projectId, "personal", baseDir),
    );

    const result = loadAndFilterInstincts({ projectId, baseDir });
    expect(result.some((i) => i.id === "proj-instinct")).toBe(true);
  });

  it("loads global instincts always", () => {
    const instinct = makeInstinct({
      id: "global-instinct",
      confidence: 0.6,
      scope: "global",
    });
    saveInstinct(instinct, getGlobalInstinctsDir("personal", baseDir));

    const result = loadAndFilterInstincts({ projectId, baseDir });
    expect(result.some((i) => i.id === "global-instinct")).toBe(true);
  });

  it("loads only global instincts when projectId is null", () => {
    const result = loadAndFilterInstincts({ projectId: null, baseDir });
    const ids = result.map((i) => i.id);
    expect(ids).not.toContain("proj-instinct");
    expect(ids).toContain("global-instinct");
  });

  it("loads only global instincts when projectId is undefined", () => {
    const result = loadAndFilterInstincts({ baseDir });
    const ids = result.map((i) => i.id);
    expect(ids).not.toContain("proj-instinct");
  });

  it("filters by minConfidence option", () => {
    // Save a low-confidence global instinct
    const low = makeInstinct({
      id: "low-conf",
      confidence: 0.3,
      scope: "global",
    });
    saveInstinct(low, getGlobalInstinctsDir("personal", baseDir));

    const result = loadAndFilterInstincts({
      projectId: null,
      minConfidence: 0.5,
      baseDir,
    });
    expect(result.some((i) => i.id === "low-conf")).toBe(false);
  });

  it("respects maxInstincts cap", () => {
    const result = loadAndFilterInstincts({
      projectId,
      maxInstincts: 1,
      baseDir,
    });
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it("excludes flagged_for_removal instincts", () => {
    const flagged = makeInstinct({
      id: "flagged-global",
      confidence: 0.9,
      scope: "global",
      flagged_for_removal: true,
    });
    saveInstinct(flagged, getGlobalInstinctsDir("personal", baseDir));

    const result = loadAndFilterInstincts({ projectId: null, baseDir });
    expect(result.some((i) => i.id === "flagged-global")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadAndFilterFromConfig
// ---------------------------------------------------------------------------

describe("loadAndFilterFromConfig", () => {
  let baseDir: string;

  beforeAll(() => {
    baseDir = mkdtempSync(join(tmpdir(), "pi-cl-config-test-"));
    mkdirSync(getGlobalInstinctsDir("personal", baseDir), { recursive: true });
  });

  beforeEach(() => {
    invalidateCache();
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("uses config.min_confidence and config.max_instincts", () => {
    const instinct = makeInstinct({
      id: "config-test-instinct",
      confidence: 0.6,
      scope: "global",
    });
    saveInstinct(instinct, getGlobalInstinctsDir("personal", baseDir));

    const config: Config = {
      ...BASE_CONFIG,
      min_confidence: 0.7,
      max_instincts: 5,
    };
    const result = loadAndFilterFromConfig(config, null, baseDir);
    // confidence 0.6 < 0.7 threshold - should be filtered out
    expect(result.some((i) => i.id === "config-test-instinct")).toBe(false);
  });

  it("includes instinct when confidence meets config threshold", () => {
    const instinct = makeInstinct({
      id: "config-meets-threshold",
      confidence: 0.8,
      scope: "global",
    });
    saveInstinct(instinct, getGlobalInstinctsDir("personal", baseDir));

    const config: Config = {
      ...BASE_CONFIG,
      min_confidence: 0.5,
      max_instincts: 20,
    };
    const result = loadAndFilterFromConfig(config, null, baseDir);
    expect(result.some((i) => i.id === "config-meets-threshold")).toBe(true);
  });
});
