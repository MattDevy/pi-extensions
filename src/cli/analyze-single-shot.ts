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
      `Analyzer returned invalid JSON: ${String(e)}\nRaw: ${raw.slice(0, 200)}`
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { changes?: unknown }).changes)
  ) {
    throw new Error(
      `Analyzer response missing 'changes' array. Got: ${JSON.stringify(parsed).slice(0, 200)}`
    );
  }

  return (parsed as { changes: InstinctChange[] }).changes;
}

/**
 * Builds a full Instinct from a create/update change.
 * Returns null for delete changes or changes with missing instinct data.
 */
export function buildInstinctFromChange(
  change: InstinctChange,
  existing: Instinct | null,
  projectId: string
): Instinct | null {
  if (change.action === "delete" || !change.instinct) {
    return null;
  }

  const now = new Date().toISOString();
  const payload = change.instinct;

  return {
    id: payload.id,
    title: payload.title,
    trigger: payload.trigger,
    action: payload.action,
    confidence: Math.max(0.1, Math.min(0.9, payload.confidence)),
    domain: payload.domain,
    scope: payload.scope,
    source: "personal",
    ...(payload.scope === "project" ? { project_id: projectId } : {}),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    observation_count: payload.observation_count ?? 1,
    confirmed_count: payload.confirmed_count ?? 0,
    contradicted_count: payload.contradicted_count ?? 0,
    inactive_count: payload.inactive_count ?? 0,
    ...(payload.evidence !== undefined ? { evidence: payload.evidence } : {}),
  };
}

/**
 * Formats existing instincts as serialized markdown blocks for inline context.
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
  signal?: AbortSignal
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
