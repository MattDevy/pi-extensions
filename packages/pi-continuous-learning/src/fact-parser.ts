/**
 * Fact file parsing and serialization.
 * Fact files use YAML frontmatter + a markdown body for the content text.
 *
 * Format:
 * ---
 * id: some-kebab-id
 * title: Human readable title
 * confidence: 0.7
 * ...other metadata...
 * ---
 *
 * The declarative statement (e.g. "The test DB port is 3306").
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Fact } from "./types.js";

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 0.9;

const REQUIRED_FIELDS = [
  "id",
  "title",
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

function clampConfidence(value: number): number {
  return Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, value));
}

function assertKebabCase(id: string): void {
  if (!KEBAB_RE.test(id)) {
    throw new Error(
      `Invalid fact ID "${id}": must be kebab-case (lowercase letters, numbers, hyphens only).`,
    );
  }
}

function splitFrontmatter(content: string): {
  frontmatterStr: string;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(
      "Invalid fact file: content must begin with YAML frontmatter delimiters (---).",
    );
  }
  return { frontmatterStr: match[1] ?? "", body: (match[2] ?? "").trim() };
}

export function parseFact(content: string): Fact {
  const { frontmatterStr, body } = splitFrontmatter(content);

  const fm = parseYaml(frontmatterStr) as Record<string, unknown>;

  if (!fm || typeof fm !== "object") {
    throw new Error(
      "Invalid fact file: frontmatter is not a valid YAML object.",
    );
  }

  for (const field of REQUIRED_FIELDS) {
    if (fm[field] === null || fm[field] === undefined) {
      throw new Error(
        `Invalid fact file: missing required field "${field}".`,
      );
    }
  }

  const id = String(fm["id"]);
  assertKebabCase(id);

  const confidence = clampConfidence(Number(fm["confidence"]));

  const fact: Fact = {
    id,
    title: String(fm["title"]),
    content: body,
    confidence,
    domain: String(fm["domain"]),
    source: fm["source"] as Fact["source"],
    scope: fm["scope"] as Fact["scope"],
    created_at: String(fm["created_at"]),
    updated_at: String(fm["updated_at"]),
    observation_count: Number(fm["observation_count"]),
    confirmed_count: Number(fm["confirmed_count"]),
    contradicted_count: Number(fm["contradicted_count"]),
    inactive_count: Number(fm["inactive_count"]),
  };

  if (fm["project_id"] !== undefined && fm["project_id"] !== null) {
    fact.project_id = String(fm["project_id"]);
  }
  if (fm["project_name"] !== undefined && fm["project_name"] !== null) {
    fact.project_name = String(fm["project_name"]);
  }
  if (Array.isArray(fm["evidence"])) {
    fact.evidence = (fm["evidence"] as unknown[]).map(String);
  }
  if (
    fm["flagged_for_removal"] !== undefined &&
    fm["flagged_for_removal"] !== null
  ) {
    fact.flagged_for_removal = Boolean(fm["flagged_for_removal"]);
  }

  return fact;
}

export function serializeFact(fact: Fact): string {
  const confidence = clampConfidence(fact.confidence);

  const frontmatter: Record<string, unknown> = {
    id: fact.id,
    title: fact.title,
    confidence,
    domain: fact.domain,
    source: fact.source,
    scope: fact.scope,
    created_at: fact.created_at,
    updated_at: fact.updated_at,
    observation_count: fact.observation_count,
    confirmed_count: fact.confirmed_count,
    contradicted_count: fact.contradicted_count,
    inactive_count: fact.inactive_count,
  };

  if (fact.project_id !== undefined) {
    frontmatter["project_id"] = fact.project_id;
  }
  if (fact.project_name !== undefined) {
    frontmatter["project_name"] = fact.project_name;
  }
  if (fact.evidence !== undefined) {
    frontmatter["evidence"] = fact.evidence;
  }
  if (fact.flagged_for_removal !== undefined) {
    frontmatter["flagged_for_removal"] = fact.flagged_for_removal;
  }

  const yamlStr = stringifyYaml(frontmatter);
  return `---\n${yamlStr}---\n\n${fact.content}\n`;
}
