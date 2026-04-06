/**
 * System prompt injection for pi-continuous-learning.
 * Loads filtered instincts and appends them to the system prompt on each
 * before_agent_start event so the agent benefits from learned behaviors.
 * Also bridges injected instinct IDs to shared active-instincts state (US-023).
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  BeforeAgentStartEvent,
  AgentEndEvent,
} from "./prompt-observer.js";
import type { Config, Instinct, Fact } from "./types.js";

/** Subset of BeforeAgentStartEventResult used by this module. */
export interface InjectionResult {
  /** Replacement system prompt to use for this turn. */
  systemPrompt?: string;
}
import { loadAndFilterFromConfig, inferDomains } from "./instinct-loader.js";
import {
  setCurrentActiveInstincts,
  clearActiveInstincts,
} from "./active-instincts.js";
import { loadProjectFacts, loadGlobalFacts } from "./fact-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INSTINCTS_HEADER = "## Learned Behaviors (Instincts)";
export const FACTS_HEADER = "## Project Knowledge";

// ---------------------------------------------------------------------------
// buildInjectionBlock
// ---------------------------------------------------------------------------

/**
 * Builds the injection block string from a list of instincts.
 * Returns null when the list is empty (no block needed).
 */
export function buildInjectionBlock(
  instincts: Instinct[],
  maxChars?: number,
): string | null {
  if (instincts.length === 0) return null;

  const headerLen = `\n\n${INSTINCTS_HEADER}\n`.length;
  const allBullets: string[] = [];
  let charCount = headerLen;
  let omitted = 0;

  for (const i of instincts) {
    const bullet = `- [${i.confidence.toFixed(2)}] ${i.trigger}: ${i.action}`;
    const bulletLen = bullet.length + 1; // +1 for newline

    if (maxChars && charCount + bulletLen > maxChars) {
      omitted = instincts.length - allBullets.length;
      break;
    }

    allBullets.push(bullet);
    charCount += bulletLen;
  }

  if (allBullets.length === 0) return null;

  let result = `\n\n${INSTINCTS_HEADER}\n${allBullets.join("\n")}`;
  if (omitted > 0) {
    result += `\n(${omitted} lower-confidence instinct${omitted > 1 ? "s" : ""} omitted)`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// buildFactsInjectionBlock
// ---------------------------------------------------------------------------

/**
 * Builds the facts injection block string from a list of facts.
 * Returns null when the list is empty (no block needed).
 * Format per bullet: `- [0.75] content text`
 */
export function buildFactsInjectionBlock(
  facts: Fact[],
  maxChars?: number,
): string | null {
  if (facts.length === 0) return null;

  const headerLen = `\n\n${FACTS_HEADER}\n`.length;
  const allBullets: string[] = [];
  let charCount = headerLen;
  let omitted = 0;

  for (const f of facts) {
    const bullet = `- [${f.confidence.toFixed(2)}] ${f.content}`;
    const bulletLen = bullet.length + 1; // +1 for newline

    if (maxChars && charCount + bulletLen > maxChars) {
      omitted = facts.length - allBullets.length;
      break;
    }

    allBullets.push(bullet);
    charCount += bulletLen;
  }

  if (allBullets.length === 0) return null;

  let result = `\n\n${FACTS_HEADER}\n${allBullets.join("\n")}`;
  if (omitted > 0) {
    result += `\n(${omitted} lower-confidence fact${omitted > 1 ? "s" : ""} omitted)`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// injectInstincts (pure, for testing)
// ---------------------------------------------------------------------------

/**
 * Returns a modified system prompt string with injected instincts,
 * or null when no qualifying instincts were found.
 * Pure function - no I/O.
 */
export function injectInstincts(
  systemPrompt: string,
  instincts: Instinct[],
): string | null {
  const block = buildInjectionBlock(instincts);
  if (block === null) return null;
  return systemPrompt + block;
}

// ---------------------------------------------------------------------------
// handleBeforeAgentStartInjection
// ---------------------------------------------------------------------------

/**
 * Handles before_agent_start events.
 * Loads qualifying instincts, appends them to the system prompt, and stores
 * their IDs in shared active-instincts state for observation tagging (US-023).
 * Returns undefined when no instincts qualify (no-op).
 */
export function handleBeforeAgentStartInjection(
  event: BeforeAgentStartEvent,
  _ctx: ExtensionContext,
  config: Config,
  projectId?: string | null,
  baseDir?: string,
): InjectionResult | void {
  const relevantDomains = inferDomains(event.prompt);
  const instincts = loadAndFilterFromConfig(
    config,
    projectId,
    baseDir,
    relevantDomains,
  );

  const instinctsBlock = buildInjectionBlock(
    instincts,
    config.max_injection_chars,
  );

  // Load and filter facts: confidence >= min_confidence, not flagged, sorted by confidence desc
  const allFacts = [
    ...(projectId ? loadProjectFacts(projectId, baseDir) : []),
    ...loadGlobalFacts(baseDir),
  ]
    .filter((f) => f.confidence >= config.min_confidence && !f.flagged_for_removal)
    .sort((a, b) => b.confidence - a.confidence);

  const usedChars = instinctsBlock?.length ?? 0;
  const remainingChars = config.max_injection_chars - usedChars;
  const factsBlock = buildFactsInjectionBlock(
    allFacts,
    remainingChars > 0 ? remainingChars : undefined,
  );

  if (instinctsBlock === null && factsBlock === null) {
    setCurrentActiveInstincts([]);
    return undefined;
  }

  setCurrentActiveInstincts(instincts.map((i) => i.id));
  const addition = (instinctsBlock ?? "") + (factsBlock ?? "");
  return { systemPrompt: event.systemPrompt + addition };
}

// ---------------------------------------------------------------------------
// handleAgentEndClearInstincts
// ---------------------------------------------------------------------------

/**
 * Handles agent_end events.
 * Clears active instincts state so the next prompt starts clean (US-023).
 */
export function handleAgentEndClearInstincts(
  _event: AgentEndEvent,
  _ctx: ExtensionContext,
): void {
  clearActiveInstincts();
}
