/**
 * Instinct loading and filtering for the injector.
 * Loads project and global instincts, filters by confidence threshold,
 * sorts by confidence descending, and caps to max_instincts.
 */

import type { Instinct, Config } from "./types.js";
import { loadProjectInstincts, loadGlobalInstincts } from "./instinct-store.js";
import { DEFAULT_CONFIG } from "./config.js";

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
  maxInstincts: number
): Instinct[] {
  const eligible = instincts.filter(
    (i) => !i.flagged_for_removal && i.confidence >= minConfidence
  );

  const sorted = [...eligible].sort((a, b) => b.confidence - a.confidence);

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
  options: LoadInstinctsOptions = {}
): Instinct[] {
  const {
    projectId,
    minConfidence = DEFAULT_CONFIG.min_confidence,
    maxInstincts = DEFAULT_CONFIG.max_instincts,
    baseDir,
  } = options;

  const projectInstincts =
    projectId != null
      ? loadProjectInstincts(projectId, baseDir)
      : [];

  const globalInstincts = loadGlobalInstincts(baseDir);

  // Combine: project instincts first, then global (project-scoped are more specific)
  const all = [...projectInstincts, ...globalInstincts];

  return filterInstincts(all, minConfidence, maxInstincts);
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
  baseDir?: string
): Instinct[] {
  const opts: LoadInstinctsOptions = {
    minConfidence: config.min_confidence,
    maxInstincts: config.max_instincts,
  };
  if (projectId !== undefined) opts.projectId = projectId;
  if (baseDir !== undefined) opts.baseDir = baseDir;
  return loadAndFilterInstincts(opts);
}
