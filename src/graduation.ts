/**
 * Graduation pipeline - pure functions for instinct lifecycle management.
 *
 * Determines which instincts are mature enough to graduate into permanent
 * knowledge (AGENTS.md, skills, or commands), and which have exceeded
 * their TTL and should be culled.
 */

import type { Instinct, GraduationTarget } from "./types.js";
import {
  GRADUATION_MIN_AGE_DAYS,
  GRADUATION_MIN_CONFIDENCE,
  GRADUATION_MIN_CONFIRMED,
  GRADUATION_MAX_CONTRADICTED,
  GRADUATION_SKILL_CLUSTER_SIZE,
  GRADUATION_COMMAND_CLUSTER_SIZE,
  GRADUATION_TTL_MAX_DAYS,
  GRADUATION_TTL_CULL_CONFIDENCE,
} from "./config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaturityCheck {
  eligible: boolean;
  reasons: string[];
}

export interface GraduationCandidate {
  instinct: Instinct;
  target: GraduationTarget;
  reason: string;
}

export interface DomainCluster {
  domain: string;
  instincts: Instinct[];
}

export interface TtlResult {
  toCull: Instinct[];
  toDecay: Instinct[];
}

// ---------------------------------------------------------------------------
// Age helpers
// ---------------------------------------------------------------------------

/**
 * Returns the age of an instinct in days based on created_at.
 * Uses a reference date for testability.
 */
export function getAgeDays(instinct: Instinct, now = Date.now()): number {
  const createdAt = new Date(instinct.created_at).getTime();
  return Math.max(0, (now - createdAt) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// Maturity check
// ---------------------------------------------------------------------------

/**
 * Checks whether an instinct meets all graduation maturity criteria.
 * Returns structured result with reasons for any failures.
 */
export function checkMaturity(
  instinct: Instinct,
  agentsMdContent: string | null,
  now = Date.now(),
): MaturityCheck {
  const reasons: string[] = [];

  if (instinct.graduated_to !== undefined) {
    return {
      eligible: false,
      reasons: [`Already graduated to ${instinct.graduated_to}`],
    };
  }

  if (instinct.flagged_for_removal) {
    return { eligible: false, reasons: ["Flagged for removal"] };
  }

  const ageDays = getAgeDays(instinct, now);
  if (ageDays < GRADUATION_MIN_AGE_DAYS) {
    reasons.push(
      `Age ${ageDays.toFixed(1)}d < ${GRADUATION_MIN_AGE_DAYS}d minimum`,
    );
  }

  if (instinct.confidence < GRADUATION_MIN_CONFIDENCE) {
    reasons.push(
      `Confidence ${instinct.confidence.toFixed(2)} < ${GRADUATION_MIN_CONFIDENCE} minimum`,
    );
  }

  if (instinct.confirmed_count < GRADUATION_MIN_CONFIRMED) {
    reasons.push(
      `Confirmed ${instinct.confirmed_count} < ${GRADUATION_MIN_CONFIRMED} minimum`,
    );
  }

  if (instinct.contradicted_count > GRADUATION_MAX_CONTRADICTED) {
    reasons.push(
      `Contradicted ${instinct.contradicted_count} > ${GRADUATION_MAX_CONTRADICTED} maximum`,
    );
  }

  // Check for duplicates in AGENTS.md (simple substring match on title/trigger)
  if (agentsMdContent !== null) {
    const lowerContent = agentsMdContent.toLowerCase();
    const titleMatch = lowerContent.includes(instinct.title.toLowerCase());
    const triggerMatch = lowerContent.includes(instinct.trigger.toLowerCase());
    if (titleMatch && triggerMatch) {
      reasons.push("Appears to duplicate existing AGENTS.md content");
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Candidate scanning
// ---------------------------------------------------------------------------

/**
 * Finds all instincts that qualify for graduation to AGENTS.md.
 */
export function findAgentsMdCandidates(
  instincts: Instinct[],
  agentsMdContent: string | null,
  now = Date.now(),
): GraduationCandidate[] {
  const candidates: GraduationCandidate[] = [];

  for (const instinct of instincts) {
    const check = checkMaturity(instinct, agentsMdContent, now);
    if (check.eligible) {
      candidates.push({
        instinct,
        target: "agents-md",
        reason: `Mature instinct (${instinct.confidence.toFixed(2)} confidence, ${instinct.confirmed_count} confirmations)`,
      });
    }
  }

  return candidates;
}

/**
 * Groups instincts by domain, returning only clusters meeting the size threshold.
 */
export function findDomainClusters(
  instincts: Instinct[],
  minSize: number,
): DomainCluster[] {
  const byDomain = new Map<string, Instinct[]>();

  for (const instinct of instincts) {
    if (instinct.graduated_to !== undefined) continue;
    if (instinct.flagged_for_removal) continue;

    const existing = byDomain.get(instinct.domain) ?? [];
    byDomain.set(instinct.domain, [...existing, instinct]);
  }

  const clusters: DomainCluster[] = [];
  for (const [domain, domainInstincts] of byDomain) {
    if (domainInstincts.length >= minSize) {
      clusters.push({ domain, instincts: domainInstincts });
    }
  }

  return clusters.sort((a, b) => b.instincts.length - a.instincts.length);
}

/**
 * Finds instinct clusters that qualify for skill scaffolding.
 */
export function findSkillCandidates(instincts: Instinct[]): DomainCluster[] {
  return findDomainClusters(instincts, GRADUATION_SKILL_CLUSTER_SIZE);
}

/**
 * Finds instinct clusters that qualify for command scaffolding.
 */
export function findCommandCandidates(instincts: Instinct[]): DomainCluster[] {
  return findDomainClusters(instincts, GRADUATION_COMMAND_CLUSTER_SIZE);
}

// ---------------------------------------------------------------------------
// TTL enforcement
// ---------------------------------------------------------------------------

/**
 * Identifies instincts that have exceeded the TTL without graduating.
 * - Instincts with confidence < cull threshold are marked for outright deletion
 * - Others are marked for aggressive decay
 */
export function enforceTtl(instincts: Instinct[], now = Date.now()): TtlResult {
  const toCull: Instinct[] = [];
  const toDecay: Instinct[] = [];

  for (const instinct of instincts) {
    // Skip already-graduated instincts
    if (instinct.graduated_to !== undefined) continue;

    const ageDays = getAgeDays(instinct, now);
    if (ageDays < GRADUATION_TTL_MAX_DAYS) continue;

    if (instinct.confidence < GRADUATION_TTL_CULL_CONFIDENCE) {
      toCull.push(instinct);
    } else {
      toDecay.push(instinct);
    }
  }

  return { toCull, toDecay };
}

/**
 * Marks an instinct as graduated. Returns a new instinct with graduated_to
 * and graduated_at set. Does not mutate the original.
 */
export function markGraduated(
  instinct: Instinct,
  target: GraduationTarget,
  now = new Date(),
): Instinct {
  return {
    ...instinct,
    graduated_to: target,
    graduated_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}
