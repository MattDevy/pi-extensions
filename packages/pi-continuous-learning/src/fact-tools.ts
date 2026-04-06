import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Fact } from "./types.js";
import {
  loadProjectFacts,
  loadGlobalFacts,
  saveFact,
  loadFact,
} from "./fact-store.js";
import { getProjectFactsDir, getGlobalFactsDir } from "./storage.js";

function getFactsDir(
  scope: "project" | "global",
  projectId: string | null,
  baseDir?: string,
): string | null {
  if (scope === "project") {
    return projectId ? getProjectFactsDir(projectId, "personal", baseDir) : null;
  }
  return getGlobalFactsDir("personal", baseDir);
}

function findFactFile(
  id: string,
  projectId: string | null,
  baseDir?: string,
): { path: string; scope: "project" | "global" } | null {
  if (projectId) {
    const projDir = getProjectFactsDir(projectId, "personal", baseDir);
    const projPath = join(projDir, `${id}.md`);
    if (existsSync(projPath)) return { path: projPath, scope: "project" };
  }
  const globalDir = getGlobalFactsDir("personal", baseDir);
  const globalPath = join(globalDir, `${id}.md`);
  if (existsSync(globalPath)) return { path: globalPath, scope: "global" };
  return null;
}

function formatFact(f: Fact): string {
  return `[${f.confidence.toFixed(2)}] ${f.id} (${f.domain}, ${f.scope})\n  ${f.content}`;
}

const ListParams = Type.Object({
  scope: Type.Optional(StringEnum(["project", "global", "all"] as const)),
  domain: Type.Optional(
    Type.String({
      description: "Filter by domain (e.g. typescript, git, workflow)",
    }),
  ),
});

const ReadParams = Type.Object({
  id: Type.String({ description: "Fact ID (kebab-case)" }),
});

const WriteParams = Type.Object({
  id: Type.String({ description: "Fact ID (kebab-case)" }),
  title: Type.String(),
  content: Type.String({ description: "The declarative statement to remember" }),
  confidence: Type.Number({ minimum: 0.1, maximum: 0.9 }),
  domain: Type.String(),
  scope: StringEnum(["project", "global"] as const),
  observation_count: Type.Optional(Type.Number({ default: 1 })),
  confirmed_count: Type.Optional(Type.Number({ default: 0 })),
  contradicted_count: Type.Optional(Type.Number({ default: 0 })),
  inactive_count: Type.Optional(Type.Number({ default: 0 })),
  evidence: Type.Optional(Type.Array(Type.String())),
});

const DeleteParams = Type.Object({
  id: Type.String({ description: "Fact ID to delete" }),
  scope: Type.Optional(
    StringEnum(["project", "global"] as const, {
      description:
        "Target scope. If omitted, falls back to priority order (project first, then global).",
    }),
  ),
});

export type FactListInput = Static<typeof ListParams>;
export type FactReadInput = Static<typeof ReadParams>;
export type FactWriteInput = Static<typeof WriteParams>;
export type FactDeleteInput = Static<typeof DeleteParams>;

export function createFactWriteTool(
  projectId: string | null,
  projectName: string | null,
  baseDir?: string,
) {
  return {
    name: "fact_write" as const,
    label: "Write Fact",
    description: "Create or update a knowledge fact (declarative statement)",
    promptSnippet:
      "Create or update a fact — a declarative knowledge note with no trigger/action structure",
    parameters: WriteParams,
    async execute(
      _toolCallId: string,
      params: FactWriteInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      const dir = getFactsDir(params.scope, projectId, baseDir);
      if (!dir) {
        throw new Error(
          "Cannot write project-scoped fact: no project detected",
        );
      }

      const now = new Date().toISOString();
      const existing = findFactFile(params.id, projectId, baseDir);

      const fact: Fact = {
        id: params.id,
        title: params.title,
        content: params.content,
        confidence: params.confidence,
        domain: params.domain,
        source: "personal",
        scope: params.scope,
        ...(params.scope === "project" && projectId
          ? { project_id: projectId }
          : {}),
        ...(params.scope === "project" && projectName
          ? { project_name: projectName }
          : {}),
        created_at: existing ? loadFact(existing.path).created_at : now,
        updated_at: now,
        observation_count: params.observation_count ?? 1,
        confirmed_count: params.confirmed_count ?? 0,
        contradicted_count: params.contradicted_count ?? 0,
        inactive_count: params.inactive_count ?? 0,
        ...(params.evidence ? { evidence: params.evidence } : {}),
      };

      saveFact(fact, dir);

      return {
        content: [
          {
            type: "text" as const,
            text: `${existing ? "Updated" : "Created"} fact: ${params.id}`,
          },
        ],
        details: { id: params.id, action: existing ? "updated" : "created" },
      };
    },
  };
}

export function createFactReadTool(
  projectId: string | null,
  baseDir?: string,
) {
  return {
    name: "fact_read" as const,
    label: "Read Fact",
    description: "Read a specific knowledge fact by ID",
    promptSnippet: "Read the full details of a specific fact by ID",
    parameters: ReadParams,
    async execute(
      _toolCallId: string,
      params: FactReadInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      const found = findFactFile(params.id, projectId, baseDir);
      if (!found) {
        throw new Error(`Fact not found: ${params.id}`);
      }
      const fact = loadFact(found.path);
      return {
        content: [{ type: "text" as const, text: formatFact(fact) }],
        details: fact,
      };
    },
  };
}

export function createFactListTool(
  projectId: string | null,
  baseDir?: string,
) {
  return {
    name: "fact_list" as const,
    label: "List Facts",
    description: "List knowledge facts with optional filters",
    promptSnippet:
      "List all knowledge facts, optionally filtered by scope or domain",
    parameters: ListParams,
    async execute(
      _toolCallId: string,
      params: FactListInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      const scope = params.scope ?? "all";
      let facts: Fact[] = [];

      if ((scope === "project" || scope === "all") && projectId) {
        facts.push(...loadProjectFacts(projectId, baseDir));
      }
      if (scope === "global" || scope === "all") {
        facts.push(...loadGlobalFacts(baseDir));
      }

      if (params.domain) {
        const domain = params.domain.toLowerCase();
        facts = facts.filter((f) => f.domain.toLowerCase() === domain);
      }

      facts.sort((a, b) => b.confidence - a.confidence);

      if (facts.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No facts found matching the given filters.",
            },
          ],
          details: { count: 0 },
        };
      }

      const text = facts.map(formatFact).join("\n\n");
      return {
        content: [
          {
            type: "text" as const,
            text: `${facts.length} fact(s):\n\n${text}`,
          },
        ],
        details: { count: facts.length },
      };
    },
  };
}

export function createFactDeleteTool(
  projectId: string | null,
  baseDir?: string,
) {
  return {
    name: "fact_delete" as const,
    label: "Delete Fact",
    description: "Remove a knowledge fact by ID",
    promptSnippet: "Delete a knowledge fact permanently by ID",
    parameters: DeleteParams,
    async execute(
      _toolCallId: string,
      params: FactDeleteInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      if (params.scope) {
        const dir = getFactsDir(params.scope, projectId, baseDir);
        if (!dir) {
          throw new Error(`Cannot target project scope: no project detected`);
        }
        const path = join(dir, `${params.id}.md`);
        if (!existsSync(path)) {
          throw new Error(
            `Fact not found: ${params.id} in ${params.scope} scope`,
          );
        }
        unlinkSync(path);
        return {
          content: [
            {
              type: "text" as const,
              text: `Deleted fact: ${params.id} (${params.scope}-scoped)`,
            },
          ],
          details: { id: params.id, scope: params.scope },
        };
      }

      const found = findFactFile(params.id, projectId, baseDir);
      if (!found) {
        throw new Error(`Fact not found: ${params.id}`);
      }
      unlinkSync(found.path);
      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted fact: ${params.id} (was ${found.scope}-scoped)`,
          },
        ],
        details: { id: params.id, scope: found.scope },
      };
    },
  };
}

export function registerAllFactTools(
  pi: ExtensionAPI,
  projectId: string | null,
  projectName: string | null,
  baseDir?: string,
): void {
  const guidelines = [
    "Use fact tools when the user asks to remember, store, or look up project facts or knowledge notes.",
    "A fact is a declarative statement (e.g. 'The test DB port is 3306'), not a behavioral pattern.",
  ];

  pi.registerTool({
    ...createFactListTool(projectId, baseDir),
    promptGuidelines: guidelines,
  });
  pi.registerTool({
    ...createFactReadTool(projectId, baseDir),
    promptGuidelines: guidelines,
  });
  pi.registerTool({
    ...createFactWriteTool(projectId, projectName, baseDir),
    promptGuidelines: guidelines,
  });
  pi.registerTool({
    ...createFactDeleteTool(projectId, baseDir),
    promptGuidelines: guidelines,
  });
}
