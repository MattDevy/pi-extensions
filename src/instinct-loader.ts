/**
 * Instinct loading and filtering for the injector.
 * Loads project and global instincts, filters by confidence threshold,
 * sorts by confidence descending, and caps to max_instincts.
 */

import type { Instinct, Config } from "./types.js";
import { loadProjectInstincts, loadGlobalInstincts } from "./instinct-store.js";
import { DEFAULT_CONFIG } from "./config.js";

// ---------------------------------------------------------------------------
// Domain inference
// ---------------------------------------------------------------------------

const UNIVERSAL_DOMAINS = new Set(["workflow", "git"]);

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  typescript: ["typescript", ".ts", "type ", "interface ", "generic"],
  css: ["css", "style", "tailwind", "classname", "scss", "sass"],
  testing: ["test", "spec", "vitest", "jest", "coverage", "assert"],
  git: ["git", "commit", "branch", "merge", "rebase", "stash"],
  debugging: ["debug", "error", "stack trace", "exception", "breakpoint"],
  performance: ["performance", "slow", "memory", "profil", "latency", "cache"],
  security: ["security", "auth", "token", "secret", "csrf", "xss", "injection"],
  documentation: ["documentation", "readme", "jsdoc", "docstring"],
  design: ["component", "ui ", "layout", "responsive", "accessibility"],
  workflow: ["workflow", "ci", "pipeline", "deploy", "automat"],
};

export function inferDomains(userPrompt: string): Set<string> {
  const lower = userPrompt.toLowerCase();
  const matched = new Set<string>();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matched.add(domain);
    }
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadInstinctsOptions {
  /** Project ID, or undefined/null when running outside a project. */
  projectId?: string | null;
  /** Minimum confidence threshold (default: DEFAULT_CONFIG.min_confidence). */
  minConfidence?: number;
  /** Maximum number of instincts to return (default: DEFAULT_CONFIG.max_instincts). */
  maxInstincts?: number;
  /** Optional base directory for storage (used in tests). */
  baseDir?: string;
  /** Domains relevant to the current context — matched instincts sort first. */
  relevantDomains?: Set<string>;
}

// ---------------------------------------------------------------------------
// filterInstincts
// ---------------------------------------------------------------------------

/**
 * Filters, sorts, and caps a flat list of instincts.
 * Pure function - no I/O.
 */
export function filterInstincts(
  instincts: Instinct[],
  minConfidence: number,
  maxInstincts: number,
  relevantDomains?: Set<string>,
): Instinct[] {
  const eligible = instincts.filter(
    (i) => !i.flagged_for_removal && i.confidence >= minConfidence,
  );

  const sorted = [...eligible].sort((a, b) => {
    // When relevantDomains are provided, prioritize domain-matched instincts
    if (relevantDomains && relevantDomains.size > 0) {
      const aRelevant =
        relevantDomains.has(a.domain) || UNIVERSAL_DOMAINS.has(a.domain);
      const bRelevant =
        relevantDomains.has(b.domain) || UNIVERSAL_DOMAINS.has(b.domain);
      if (aRelevant && !bRelevant) return -1;
      if (!aRelevant && bRelevant) return 1;
    }
    return b.confidence - a.confidence;
  });

  return sorted.slice(0, maxInstincts);
}

// ---------------------------------------------------------------------------
// loadAndFilterInstincts
// ---------------------------------------------------------------------------

/**
 * Loads instincts from disk, filters by confidence threshold, sorts by
 * confidence descending, and caps to max_instincts.
 *
 * When projectId is provided (and non-null), loads both project-scoped
 * instincts and global instincts. Otherwise loads only global instincts.
 */
export function loadAndFilterInstincts(
  options: LoadInstinctsOptions = {},
): Instinct[] {
  const {
    projectId,
    minConfidence = DEFAULT_CONFIG.min_confidence,
    maxInstincts = DEFAULT_CONFIG.max_instincts,
    baseDir,
    relevantDomains,
  } = options;

  const projectInstincts =
    projectId != null ? loadProjectInstincts(projectId, baseDir) : [];

  const globalInstincts = loadGlobalInstincts(baseDir);

  // Combine: project instincts first, then global (project-scoped are more specific)
  const all = [...projectInstincts, ...globalInstincts];

  return filterInstincts(all, minConfidence, maxInstincts, relevantDomains);
}

// ---------------------------------------------------------------------------
// loadAndFilterFromConfig
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper - uses thresholds from a Config object.
 */
export function loadAndFilterFromConfig(
  config: Config,
  projectId?: string | null,
  baseDir?: string,
  relevantDomains?: Set<string>,
): Instinct[] {
  const opts: LoadInstinctsOptions = {
    minConfidence: config.min_confidence,
    maxInstincts: config.max_instincts,
  };
  if (projectId !== undefined) opts.projectId = projectId;
  if (baseDir !== undefined) opts.baseDir = baseDir;
  if (relevantDomains !== undefined) opts.relevantDomains = relevantDomains;
  return loadAndFilterInstincts(opts);
}
