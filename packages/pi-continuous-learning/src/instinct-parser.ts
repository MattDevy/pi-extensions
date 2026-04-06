/**
 * Instinct file parsing and serialization.
 * Instinct files use YAML frontmatter + a markdown body for the action text.
 *
 * Format:
 * ---
 * id: some-kebab-id
 * title: Human readable title
 * trigger: when condition is met
 * confidence: 0.7
 * ...other metadata...
 * ---
 *
 * Action text describing what to do.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Instinct } from "./types.js";

// Constants
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 0.9;

const REQUIRED_FIELDS = [
  "id",
  "title",
  "trigger",
  "confidence",
  "domain",
  "source",
  "scope",
  "created_at",
  "updated_at",
  "observation_count",
  "confirmed_count",
  "contradicted_count",
  "inactive_count",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampConfidence(value: number): number {
  return Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, value));
}

function assertKebabCase(id: string): void {
  if (!KEBAB_RE.test(id)) {
    throw new Error(
      `Invalid instinct ID "${id}": must be kebab-case (lowercase letters, numbers, hyphens only).`,
    );
  }
}

function splitFrontmatter(content: string): {
  frontmatterStr: string;
  body: string;
} {
  // Expect content starting with ---\n<yaml>\n---
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(
      "Invalid instinct file: content must begin with YAML frontmatter delimiters (---).",
    );
  }
  return { frontmatterStr: match[1] ?? "", body: (match[2] ?? "").trim() };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an instinct markdown file (YAML frontmatter + body) into an Instinct.
 * Throws if required fields are missing or the ID is not kebab-case.
 * Clamps confidence to 0.1–0.9 rather than throwing.
 */
export function parseInstinct(content: string): Instinct {
  const { frontmatterStr, body } = splitFrontmatter(content);

  const fm = parseYaml(frontmatterStr) as Record<string, unknown>;

  if (!fm || typeof fm !== "object") {
    throw new Error(
      "Invalid instinct file: frontmatter is not a valid YAML object.",
    );
  }

  for (const field of REQUIRED_FIELDS) {
    if (fm[field] === null || fm[field] === undefined) {
      throw new Error(
        `Invalid instinct file: missing required field "${field}".`,
      );
    }
  }

  const id = String(fm["id"]);
  assertKebabCase(id);

  const confidence = clampConfidence(Number(fm["confidence"]));

  const instinct: Instinct = {
    id,
    title: String(fm["title"]),
    trigger: String(fm["trigger"]),
    action: body,
    confidence,
    domain: String(fm["domain"]),
    source: fm["source"] as Instinct["source"],
    scope: fm["scope"] as Instinct["scope"],
    created_at: String(fm["created_at"]),
    updated_at: String(fm["updated_at"]),
    observation_count: Number(fm["observation_count"]),
    confirmed_count: Number(fm["confirmed_count"]),
    contradicted_count: Number(fm["contradicted_count"]),
    inactive_count: Number(fm["inactive_count"]),
  };

  if (fm["project_id"] !== undefined && fm["project_id"] !== null) {
    instinct.project_id = String(fm["project_id"]);
  }
  if (fm["project_name"] !== undefined && fm["project_name"] !== null) {
    instinct.project_name = String(fm["project_name"]);
  }
  if (Array.isArray(fm["evidence"])) {
    instinct.evidence = (fm["evidence"] as unknown[]).map(String);
  }
  if (
    fm["flagged_for_removal"] !== undefined &&
    fm["flagged_for_removal"] !== null
  ) {
    instinct.flagged_for_removal = Boolean(fm["flagged_for_removal"]);
  }
  if (fm["graduated_to"] !== undefined && fm["graduated_to"] !== null) {
    (instinct as { graduated_to: string }).graduated_to = String(
      fm["graduated_to"],
    );
  }
  if (fm["graduated_at"] !== undefined && fm["graduated_at"] !== null) {
    instinct.graduated_at = String(fm["graduated_at"]);
  }
  if (
    fm["last_confirmed_session"] !== undefined &&
    fm["last_confirmed_session"] !== null
  ) {
    instinct.last_confirmed_session = String(fm["last_confirmed_session"]);
  }

  return instinct;
}

/**
 * Serialize an Instinct into a YAML-frontmatter markdown string.
 * Confidence is clamped to 0.1–0.9 before writing.
 */
export function serializeInstinct(instinct: Instinct): string {
  const confidence = clampConfidence(instinct.confidence);

  const frontmatter: Record<string, unknown> = {
    id: instinct.id,
    title: instinct.title,
    trigger: instinct.trigger,
    confidence,
    domain: instinct.domain,
    source: instinct.source,
    scope: instinct.scope,
    created_at: instinct.created_at,
    updated_at: instinct.updated_at,
    observation_count: instinct.observation_count,
    confirmed_count: instinct.confirmed_count,
    contradicted_count: instinct.contradicted_count,
    inactive_count: instinct.inactive_count,
  };

  if (instinct.project_id !== undefined) {
    frontmatter["project_id"] = instinct.project_id;
  }
  if (instinct.project_name !== undefined) {
    frontmatter["project_name"] = instinct.project_name;
  }
  if (instinct.evidence !== undefined) {
    frontmatter["evidence"] = instinct.evidence;
  }
  if (instinct.flagged_for_removal !== undefined) {
    frontmatter["flagged_for_removal"] = instinct.flagged_for_removal;
  }
  if (instinct.graduated_to !== undefined) {
    frontmatter["graduated_to"] = instinct.graduated_to;
  }
  if (instinct.graduated_at !== undefined) {
    frontmatter["graduated_at"] = instinct.graduated_at;
  }
  if (instinct.last_confirmed_session !== undefined) {
    frontmatter["last_confirmed_session"] = instinct.last_confirmed_session;
  }

  const yamlStr = stringifyYaml(frontmatter);
  return `---\n${yamlStr}---\n\n${instinct.action}\n`;
}
