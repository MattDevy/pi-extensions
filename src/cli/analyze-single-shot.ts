/**
 * Single-shot (non-agentic) analyzer core.
 *
 * Replaces the multi-turn agentic session with a single complete() call.
 * The model receives all current instincts inline and returns a JSON change-set.
 * Changes are applied client-side, eliminating the ~16x cache-read multiplier.
 */
import type { AssistantMessage, Context } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import type { Instinct } from "../types.js";
import { serializeInstinct } from "../instinct-parser.js";

/** Chars-per-token heuristic for prompt size estimation. */
const CHARS_PER_TOKEN = 4;
import {
  validateInstinct,
  findSimilarInstinct,
} from "../instinct-validator.js";
import { confirmationDelta } from "../confidence.js";

export interface InstinctChangePayload {
  id: string;
  title: string;
  trigger: string;
  action: string;
  confidence: number;
  domain: string;
  scope: "project" | "global";
  observation_count?: number;
  confirmed_count?: number;
  contradicted_count?: number;
  inactive_count?: number;
  evidence?: string[];
  last_confirmed_session?: string;
}

export interface InstinctChange {
  action: "create" | "update" | "delete";
  instinct?: InstinctChangePayload;
  /** For delete: the instinct ID to remove. */
  id?: string;
  /** For delete: the scope to target. */
  scope?: "project" | "global";
}

export interface SingleShotResult {
  changes: InstinctChange[];
  message: AssistantMessage;
}

/**
 * Parses the model's raw text response into an array of InstinctChange.
 * Strips markdown code fences if present. Throws on invalid JSON or schema.
 */
export function parseChanges(raw: string): InstinctChange[] {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    throw new Error(
      `Analyzer returned invalid JSON: ${String(e)}\nRaw: ${raw.slice(0, 200)}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { changes?: unknown }).changes)
  ) {
    throw new Error(
      `Analyzer response missing 'changes' array. Got: ${JSON.stringify(parsed).slice(0, 200)}`,
    );
  }

  return (parsed as { changes: InstinctChange[] }).changes;
}

/**
 * Builds a full Instinct from a create/update change.
 * Returns null for delete changes, changes with missing instinct data,
 * invalid fields, or semantically duplicate actions.
 *
 * @param change        - The change to apply
 * @param existing      - The existing instinct with this ID, if any
 * @param projectId     - Project ID for scoping
 * @param allInstincts  - All current instincts, used for dedup check on creates
 */
export function buildInstinctFromChange(
  change: InstinctChange,
  existing: Instinct | null,
  projectId: string,
  allInstincts: Instinct[] = [],
): Instinct | null {
  if (change.action === "delete" || !change.instinct) {
    return null;
  }

  const payload = change.instinct;

  const validation = validateInstinct({
    action: payload.action,
    trigger: payload.trigger,
    domain: payload.domain,
  });
  if (!validation.valid) {
    return null;
  }

  // On create, reject if semantically similar to an existing instinct (skip self on update)
  if (change.action === "create") {
    const similar = findSimilarInstinct(
      { trigger: payload.trigger, action: payload.action },
      allInstincts,
      payload.id,
    );
    if (similar) {
      return null;
    }
  }

  const now = new Date().toISOString();

  // For updates, recompute confidence client-side to enforce:
  // 1. Per-session deduplication: only one confirmation per unique session_id
  // 2. Diminishing returns: each additional confirmation yields a smaller delta
  let resolvedConfidence: number;
  let resolvedConfirmedCount =
    payload.confirmed_count ?? existing?.confirmed_count ?? 0;
  let resolvedLastConfirmedSession =
    payload.last_confirmed_session ?? existing?.last_confirmed_session;

  if (change.action === "update" && existing !== null) {
    const prevConfirmedCount = existing.confirmed_count;
    const newConfirmedCount = payload.confirmed_count ?? prevConfirmedCount;
    const contradictionsAdded = Math.max(
      0,
      (payload.contradicted_count ?? 0) - existing.contradicted_count,
    );

    // Detect whether the LLM intends to add a confirmation
    const wantsToConfirm = newConfirmedCount > prevConfirmedCount;

    // Session dedup: reject the confirmation if the confirming session is the
    // same as the one that last confirmed this instinct.
    const sessionDuplicate =
      wantsToConfirm &&
      resolvedLastConfirmedSession !== undefined &&
      payload.last_confirmed_session !== undefined &&
      payload.last_confirmed_session === existing.last_confirmed_session;

    if (sessionDuplicate) {
      // Revert to existing count - this session already confirmed the instinct
      resolvedConfirmedCount = prevConfirmedCount;
    }

    // Recompute confidence from existing + explicit deltas (don't trust LLM arithmetic)
    resolvedConfidence = existing.confidence;
    if (wantsToConfirm && !sessionDuplicate) {
      resolvedConfidence += confirmationDelta(prevConfirmedCount);
    }
    if (contradictionsAdded > 0) {
      resolvedConfidence -= 0.15 * contradictionsAdded;
    }
    resolvedConfidence = Math.max(0.1, Math.min(0.9, resolvedConfidence));
  } else {
    // For creates, trust the LLM's initial confidence (no prior state to base delta on)
    resolvedConfidence = Math.max(0.1, Math.min(0.9, payload.confidence));
  }

  return {
    id: payload.id,
    title: payload.title,
    trigger: payload.trigger,
    action: payload.action,
    confidence: resolvedConfidence,
    domain: payload.domain,
    scope: payload.scope,
    source: "personal",
    ...(payload.scope === "project" ? { project_id: projectId } : {}),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    observation_count: payload.observation_count ?? 1,
    confirmed_count: resolvedConfirmedCount,
    contradicted_count: payload.contradicted_count ?? 0,
    inactive_count: payload.inactive_count ?? 0,
    ...(payload.evidence !== undefined ? { evidence: payload.evidence } : {}),
    ...(resolvedLastConfirmedSession !== undefined
      ? { last_confirmed_session: resolvedLastConfirmedSession }
      : {}),
  };
}

/**
 * Returns days elapsed since the given ISO 8601 date string.
 */
function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Formats existing instincts as a compact JSON array for inline context.
 * Reduces token usage by ~70% compared to full YAML+markdown serialization.
 * Includes only the fields the analyzer needs to make decisions.
 */
export function formatInstinctsCompact(instincts: Instinct[]): string {
  if (instincts.length === 0) {
    return "[]";
  }
  const summaries = instincts.map((i) => ({
    id: i.id,
    trigger: i.trigger,
    action: i.action,
    confidence: i.confidence,
    domain: i.domain,
    scope: i.scope,
    confirmed: i.confirmed_count,
    contradicted: i.contradicted_count,
    inactive: i.inactive_count,
    age_days: daysSince(i.created_at),
    ...(i.last_confirmed_session !== undefined
      ? { last_confirmed_session: i.last_confirmed_session }
      : {}),
  }));
  return JSON.stringify(summaries);
}

/**
 * Estimates the token count of a text string using a chars/token heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Formats existing instincts as serialized markdown blocks for inline context.
 * @deprecated Use formatInstinctsCompact for lower token usage.
 */
export function formatInstinctsForPrompt(instincts: Instinct[]): string {
  if (instincts.length === 0) {
    return "(no existing instincts)";
  }
  return instincts.map((i) => serializeInstinct(i)).join("\n---\n");
}

/**
 * Runs a single complete() call with the provided context.
 * Returns parsed changes and the raw AssistantMessage (for usage stats).
 */
export async function runSingleShot(
  context: Context,
  model: Parameters<typeof complete>[0],
  apiKey: string,
  signal?: AbortSignal,
): Promise<SingleShotResult> {
  const opts: Parameters<typeof complete>[2] = { apiKey };
  if (signal !== undefined) opts.signal = signal;
  const message = await complete(model, context, opts);

  const textContent = message.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("");

  if (!textContent.trim()) {
    throw new Error("Analyzer returned empty response");
  }

  const changes = parseChanges(textContent);
  return { changes, message };
}
