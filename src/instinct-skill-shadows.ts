/**
 * Skill shadow detection for /instinct-evolve.
 * Checks whether an instinct is already covered by an installed Pi skill.
 */

import type { Instinct, InstalledSkill } from "./types.js";
import { SKILL_DOMAINS } from "./config.js";
import { tokenizeText } from "./instinct-text-utils.js";

/** Jaccard similarity threshold between instinct trigger tokens and skill tokens to flag as shadowed. */
export const SKILL_SHADOW_TOKEN_THRESHOLD = 0.3;

export interface SkillShadowSuggestion {
  type: "skill-shadow";
  instinct: Instinct;
  /** Name of the installed skill that already covers this instinct. */
  skillName: string;
}

/**
 * Flags instincts that are already covered by an installed Pi skill.
 * An instinct is shadowed when:
 *  - its domain is a SKILL_DOMAINS key AND a skill name contains that domain word, OR
 *  - Jaccard(trigger tokens, skill name+description tokens) >= SKILL_SHADOW_TOKEN_THRESHOLD
 */
export function findSkillShadows(
  instincts: Instinct[],
  installedSkills: InstalledSkill[]
): SkillShadowSuggestion[] {
  if (installedSkills.length === 0) return [];

  const suggestions: SkillShadowSuggestion[] = [];

  for (const instinct of instincts) {
    const shadowingSkill = findShadowingSkill(instinct, installedSkills);
    if (shadowingSkill != null) {
      suggestions.push({ type: "skill-shadow", instinct, skillName: shadowingSkill.name });
    }
  }

  return suggestions;
}

/**
 * Returns the first installed skill that shadows the given instinct, or null.
 */
function findShadowingSkill(
  instinct: Instinct,
  installedSkills: InstalledSkill[]
): InstalledSkill | null {
  const domain = instinct.domain?.toLowerCase() ?? "";
  const isDomainKnown =
    domain.length > 0 && Object.prototype.hasOwnProperty.call(SKILL_DOMAINS, domain);

  for (const skill of installedSkills) {
    const skillNameLower = skill.name.toLowerCase();

    // Domain match: instinct domain is a SKILL_DOMAINS key AND skill name contains domain word
    if (isDomainKnown && skillNameLower.includes(domain)) {
      return skill;
    }

    // Token overlap: Jaccard >= SKILL_SHADOW_TOKEN_THRESHOLD
    const instinctTokens = tokenizeText(instinct.trigger);
    const skillTokens = tokenizeText(`${skill.name} ${skill.description}`);
    if (instinctTokens.size === 0 || skillTokens.size === 0) continue;
    const intersection = [...instinctTokens].filter((t) => skillTokens.has(t));
    const union = new Set([...instinctTokens, ...skillTokens]);
    if (intersection.length / union.size >= SKILL_SHADOW_TOKEN_THRESHOLD) {
      return skill;
    }
  }

  return null;
}
