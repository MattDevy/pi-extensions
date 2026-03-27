/**
 * Skill scaffolding from instinct clusters.
 *
 * When 3+ related instincts in the same domain form a cohesive topic,
 * generates a SKILL.md file that can be installed as a Pi skill.
 */

import type { Instinct } from "./types.js";
import type { DomainCluster } from "./graduation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillScaffold {
  name: string;
  description: string;
  domain: string;
  content: string;
  sourceInstinctIds: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSkillName(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatInstinctAsSection(instinct: Instinct, index: number): string {
  return [
    `### ${index + 1}. ${instinct.title}`,
    "",
    `**When:** ${instinct.trigger}`,
    "",
    instinct.action,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a SKILL.md scaffold from a domain cluster of instincts.
 */
export function generateSkillScaffold(cluster: DomainCluster): SkillScaffold {
  const name = toSkillName(cluster.domain);
  const sortedInstincts = [...cluster.instincts].sort(
    (a, b) => b.confidence - a.confidence
  );

  const description = `Learned ${cluster.domain} patterns from coding sessions. ` +
    `Covers ${sortedInstincts.length} practices distilled from instinct observations.`;

  const sections = sortedInstincts.map((inst, i) => formatInstinctAsSection(inst, i));

  const content = [
    `# ${cluster.domain} Skill`,
    "",
    `> Auto-generated from ${sortedInstincts.length} graduated instincts in the "${cluster.domain}" domain.`,
    "",
    `## Description`,
    "",
    description,
    "",
    `## Practices`,
    "",
    ...sections,
  ].join("\n");

  return {
    name,
    description,
    domain: cluster.domain,
    content,
    sourceInstinctIds: sortedInstincts.map((i) => i.id),
  };
}

/**
 * Generates skill scaffolds for all qualifying clusters.
 */
export function generateAllSkillScaffolds(
  clusters: DomainCluster[]
): SkillScaffold[] {
  return clusters.map(generateSkillScaffold);
}
