/**
 * /instinct-graduate command for pi-continuous-learning.
 *
 * Scans instincts for graduation candidates, presents proposals to the user,
 * and writes to AGENTS.md / scaffolds skills / scaffolds commands on approval.
 * Also enforces TTL - culling or decaying stale instincts.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { unlinkSync } from "node:fs";
import { writeFileSync, mkdirSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Instinct } from "./types.js";
import { getBaseDir, getProjectInstinctsDir, getGlobalInstinctsDir } from "./storage.js";
import { loadProjectInstincts, loadGlobalInstincts, saveInstinct } from "./instinct-store.js";
import { readAgentsMd, appendToAgentsMd } from "./agents-md.js";
import {
  findAgentsMdCandidates,
  findSkillCandidates,
  findCommandCandidates,
  enforceTtl,
  markGraduated,
} from "./graduation.js";
import type { GraduationCandidate, DomainCluster, TtlResult } from "./graduation.js";
import { generateSkillScaffold } from "./skill-scaffold.js";
import type { SkillScaffold } from "./skill-scaffold.js";
import { generateCommandScaffold } from "./command-scaffold.js";
import type { CommandScaffold } from "./command-scaffold.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMMAND_NAME = "instinct-graduate";

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function formatAgentsMdCandidates(candidates: GraduationCandidate[]): string {
  if (candidates.length === 0) return "";

  const lines = [
    "## AGENTS.md Graduation Candidates",
    "",
    `Found ${candidates.length} instinct${candidates.length !== 1 ? "s" : ""} ready for AGENTS.md:`,
    "",
  ];

  for (const candidate of candidates) {
    const inst = candidate.instinct;
    lines.push(
      `- **${inst.id}** - "${inst.title}" (${inst.confidence.toFixed(2)} confidence, ${inst.confirmed_count} confirmations)`,
      `  Trigger: ${inst.trigger}`,
      `  ${candidate.reason}`,
      ""
    );
  }

  return lines.join("\n");
}

function formatSkillClusters(clusters: DomainCluster[]): string {
  if (clusters.length === 0) return "";

  const lines = [
    "## Skill Scaffold Candidates",
    "",
    `Found ${clusters.length} domain cluster${clusters.length !== 1 ? "s" : ""} that could become skills:`,
    "",
  ];

  for (const cluster of clusters) {
    lines.push(
      `- **${cluster.domain}** domain (${cluster.instincts.length} instincts):`,
      ...cluster.instincts.map((i) => `  - ${i.id}: "${i.title}"`),
      ""
    );
  }

  return lines.join("\n");
}

function formatCommandClusters(clusters: DomainCluster[]): string {
  if (clusters.length === 0) return "";

  // Filter out clusters already covered by skill candidates (same domain)
  const lines = [
    "## Command Scaffold Candidates",
    "",
    `Found ${clusters.length} domain cluster${clusters.length !== 1 ? "s" : ""} that could become commands:`,
    "",
  ];

  for (const cluster of clusters) {
    lines.push(
      `- **/${cluster.domain}** command (${cluster.instincts.length} instincts):`,
      ...cluster.instincts.map((i) => `  - ${i.id}: "${i.title}"`),
      ""
    );
  }

  return lines.join("\n");
}

function formatTtlResults(ttl: TtlResult): string {
  if (ttl.toCull.length === 0 && ttl.toDecay.length === 0) return "";

  const lines = ["## TTL Enforcement", ""];

  if (ttl.toCull.length > 0) {
    lines.push(
      `${ttl.toCull.length} instinct${ttl.toCull.length !== 1 ? "s" : ""} exceeded TTL with low confidence (will be deleted):`,
      ""
    );
    for (const inst of ttl.toCull) {
      lines.push(`- ${inst.id}: "${inst.title}" (${inst.confidence.toFixed(2)})`);
    }
    lines.push("");
  }

  if (ttl.toDecay.length > 0) {
    lines.push(
      `${ttl.toDecay.length} instinct${ttl.toDecay.length !== 1 ? "s" : ""} exceeded TTL but still have moderate confidence (will be aggressively decayed):`,
      ""
    );
    for (const inst of ttl.toDecay) {
      lines.push(`- ${inst.id}: "${inst.title}" (${inst.confidence.toFixed(2)})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Builds the full graduation prompt to send to the LLM for user-facing review.
 */
export function buildGraduationPrompt(
  agentsMdCandidates: GraduationCandidate[],
  skillClusters: DomainCluster[],
  commandClusters: DomainCluster[],
  ttl: TtlResult
): string {
  const sections = [
    "I've analyzed your instincts for graduation readiness. Here's what I found:",
    "",
    formatAgentsMdCandidates(agentsMdCandidates),
    formatSkillClusters(skillClusters),
    formatCommandClusters(commandClusters),
    formatTtlResults(ttl),
    "## Next Steps",
    "",
    "For each category above, I can:",
    "1. **Graduate to AGENTS.md** - Write approved instincts as permanent guidelines",
    "2. **Scaffold a skill** - Generate a SKILL.md for a domain cluster",
    "3. **Scaffold a command** - Generate a slash command for a workflow cluster",
    "4. **Enforce TTL** - Delete or decay stale instincts",
    "",
    "Tell me which actions you'd like me to take. I'll use the instinct tools to execute.",
    "You can approve all, pick specific instincts, or skip any category.",
  ].filter((s) => s.length > 0);

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Action helpers (called by LLM via tools, or directly)
// ---------------------------------------------------------------------------

/**
 * Resolves the instinct directory for a given instinct.
 */
function getInstinctDir(instinct: Instinct, baseDir: string): string {
  if (instinct.scope === "project" && instinct.project_id) {
    return getProjectInstinctsDir(instinct.project_id, "personal", baseDir);
  }
  return getGlobalInstinctsDir("personal", baseDir);
}

/**
 * Graduates instincts to AGENTS.md. Writes entries and marks instincts as graduated.
 */
export function graduateToAgentsMd(
  instincts: Instinct[],
  agentsMdPath: string,
  baseDir: string
): Instinct[] {
  if (instincts.length === 0) return [];

  appendToAgentsMd(agentsMdPath, instincts);

  const graduated: Instinct[] = [];
  for (const instinct of instincts) {
    const updated = markGraduated(instinct, "agents-md");
    const dir = getInstinctDir(instinct, baseDir);
    saveInstinct(updated, dir);
    graduated.push(updated);
  }

  return graduated;
}

/**
 * Graduates instincts to a skill scaffold. Writes SKILL.md and marks instincts.
 */
export function graduateToSkill(
  cluster: DomainCluster,
  outputDir: string,
  baseDir: string
): SkillScaffold {
  const scaffold = generateSkillScaffold(cluster);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "SKILL.md"), scaffold.content, "utf-8");

  for (const instinct of cluster.instincts) {
    const updated = markGraduated(instinct, "skill");
    const dir = getInstinctDir(instinct, baseDir);
    saveInstinct(updated, dir);
  }

  return scaffold;
}

/**
 * Graduates instincts to a command scaffold. Writes command doc and marks instincts.
 */
export function graduateToCommand(
  cluster: DomainCluster,
  outputDir: string,
  baseDir: string
): CommandScaffold {
  const scaffold = generateCommandScaffold(cluster);

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, `${scaffold.name}-command.md`), scaffold.content, "utf-8");

  for (const instinct of cluster.instincts) {
    const updated = markGraduated(instinct, "command");
    const dir = getInstinctDir(instinct, baseDir);
    saveInstinct(updated, dir);
  }

  return scaffold;
}

/**
 * Deletes TTL-expired instincts from disk.
 */
export function cullExpiredInstincts(
  instincts: Instinct[],
  baseDir: string
): number {
  let deleted = 0;
  for (const instinct of instincts) {
    const dir = getInstinctDir(instinct, baseDir);
    const filePath = join(dir, `${instinct.id}.md`);
    try {
      unlinkSync(filePath);
      deleted++;
    } catch {
      // File may already be gone
    }
  }
  return deleted;
}

/**
 * Aggressively decays TTL-expired instincts by halving their confidence.
 */
export function decayExpiredInstincts(
  instincts: Instinct[],
  baseDir: string
): number {
  let decayed = 0;
  for (const instinct of instincts) {
    const updated: Instinct = {
      ...instinct,
      confidence: Math.max(0.1, instinct.confidence * 0.5),
      updated_at: new Date().toISOString(),
      flagged_for_removal: true,
    };
    const dir = getInstinctDir(instinct, baseDir);
    saveInstinct(updated, dir);
    decayed++;
  }
  return decayed;
}

// ---------------------------------------------------------------------------
// handleInstinctGraduate
// ---------------------------------------------------------------------------

/**
 * Command handler for /instinct-graduate.
 * Scans for graduation candidates and sends a prompt for user review.
 */
export async function handleInstinctGraduate(
  _args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  projectId?: string | null,
  baseDir?: string,
  projectRoot?: string | null
): Promise<void> {
  const effectiveBase = baseDir ?? getBaseDir();

  // Load all instincts
  const projectInstincts = projectId
    ? loadProjectInstincts(projectId, effectiveBase)
    : [];
  const globalInstincts = loadGlobalInstincts(effectiveBase);
  const allInstincts = [...projectInstincts, ...globalInstincts];

  if (allInstincts.length === 0) {
    ctx.ui.notify(
      "No instincts to analyze. Keep using pi to accumulate instincts first.",
      "info"
    );
    return;
  }

  // Read AGENTS.md for dedup
  const agentsMdProject =
    projectRoot != null ? readAgentsMd(join(projectRoot, "AGENTS.md")) : null;
  const agentsMdGlobal = readAgentsMd(
    join(homedir(), ".pi", "agent", "AGENTS.md")
  );
  const combinedAgentsMd = [agentsMdProject, agentsMdGlobal]
    .filter(Boolean)
    .join("\n");

  // Find candidates
  const agentsMdCandidates = findAgentsMdCandidates(
    allInstincts,
    combinedAgentsMd.length > 0 ? combinedAgentsMd : null
  );

  // Find clusters for skills and commands
  // Only consider non-graduated, non-flagged instincts
  const activeInstincts = allInstincts.filter(
    (i) => i.graduated_to === undefined && !i.flagged_for_removal
  );
  const skillClusters = findSkillCandidates(activeInstincts);
  const commandClusters = findCommandCandidates(activeInstincts);

  // Enforce TTL
  const ttl = enforceTtl(allInstincts);

  // Check if there's anything to report
  const hasWork =
    agentsMdCandidates.length > 0 ||
    skillClusters.length > 0 ||
    commandClusters.length > 0 ||
    ttl.toCull.length > 0 ||
    ttl.toDecay.length > 0;

  if (!hasWork) {
    ctx.ui.notify(
      "No instincts are ready for graduation and no TTL violations found. " +
        "Instincts need >= 7 days age, >= 0.75 confidence, and >= 3 confirmations.",
      "info"
    );
    return;
  }

  const prompt = buildGraduationPrompt(
    agentsMdCandidates,
    skillClusters,
    commandClusters,
    ttl
  );

  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}
