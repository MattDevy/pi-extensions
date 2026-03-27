import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Instinct } from "./types.js";
import {
  loadProjectInstincts,
  loadGlobalInstincts,
  saveInstinct,
  loadInstinct,
} from "./instinct-store.js";
import {
  getProjectInstinctsDir,
  getGlobalInstinctsDir,
} from "./storage.js";

function getInstinctsDir(
  scope: "project" | "global",
  projectId: string | null,
  baseDir?: string
): string | null {
  if (scope === "project") {
    return projectId ? getProjectInstinctsDir(projectId, "personal", baseDir) : null;
  }
  return getGlobalInstinctsDir("personal", baseDir);
}

function findInstinctFile(
  id: string,
  projectId: string | null,
  baseDir?: string
): { path: string; scope: "project" | "global" } | null {
  if (projectId) {
    const projDir = getProjectInstinctsDir(projectId, "personal", baseDir);
    const projPath = join(projDir, `${id}.md`);
    if (existsSync(projPath)) return { path: projPath, scope: "project" };
  }
  const globalDir = getGlobalInstinctsDir("personal", baseDir);
  const globalPath = join(globalDir, `${id}.md`);
  if (existsSync(globalPath)) return { path: globalPath, scope: "global" };
  return null;
}

function formatInstinct(i: Instinct): string {
  return `[${i.confidence.toFixed(2)}] ${i.id} (${i.domain}, ${i.scope})\n  Trigger: ${i.trigger}\n  Action: ${i.action}`;
}

const ListParams = Type.Object({
  scope: Type.Optional(StringEnum(["project", "global", "all"] as const)),
  domain: Type.Optional(Type.String({ description: "Filter by domain (e.g. typescript, git, workflow)" })),
});

const ReadParams = Type.Object({
  id: Type.String({ description: "Instinct ID (kebab-case)" }),
});

const WriteParams = Type.Object({
  id: Type.String({ description: "Instinct ID (kebab-case)" }),
  title: Type.String(),
  trigger: Type.String({ description: "When this instinct should activate" }),
  action: Type.String({ description: "What the agent should do" }),
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
  id: Type.String({ description: "Instinct ID to delete" }),
  scope: Type.Optional(StringEnum(["project", "global"] as const, {
    description: "Target scope. If omitted, falls back to priority order (project first, then global).",
  })),
});

const MergeParams = Type.Object({
  merged: Type.Object({
    id: Type.String(),
    title: Type.String(),
    trigger: Type.String(),
    action: Type.String(),
    confidence: Type.Number({ minimum: 0.1, maximum: 0.9 }),
    domain: Type.String(),
    scope: StringEnum(["project", "global"] as const),
    evidence: Type.Optional(Type.Array(Type.String())),
  }),
  delete_ids: Type.Array(Type.String(), { description: "IDs of source instincts to remove after merge (uses priority lookup)" }),
  delete_scoped_ids: Type.Optional(Type.Array(
    Type.Object({
      id: Type.String({ description: "Instinct ID" }),
      scope: StringEnum(["project", "global"] as const, { description: "Scope of the copy to delete" }),
    }),
    { description: "Scope-aware deletions: [{id, scope}] to target a specific copy" }
  )),
});

export type InstinctListInput = Static<typeof ListParams>;
export type InstinctReadInput = Static<typeof ReadParams>;
export type InstinctWriteInput = Static<typeof WriteParams>;
export type InstinctDeleteInput = Static<typeof DeleteParams>;
export type InstinctMergeInput = Static<typeof MergeParams>;

export function createInstinctWriteTool(
  projectId: string | null,
  projectName: string | null,
  baseDir?: string
) {
  return {
    name: "instinct_write" as const,
    label: "Write Instinct",
    description: "Create or update a learned behavior instinct",
    promptSnippet: "Create or update a learned behavior instinct (trigger + action pattern)",
    parameters: WriteParams,
    async execute(
      _toolCallId: string,
      params: InstinctWriteInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown
    ) {
      const dir = getInstinctsDir(params.scope, projectId, baseDir);
      if (!dir) {
        throw new Error("Cannot write project-scoped instinct: no project detected");
      }

      const now = new Date().toISOString();
      const existing = findInstinctFile(params.id, projectId, baseDir);

      const instinct: Instinct = {
        id: params.id,
        title: params.title,
        trigger: params.trigger,
        action: params.action,
        confidence: params.confidence,
        domain: params.domain,
        source: "personal",
        scope: params.scope,
        ...(params.scope === "project" && projectId ? { project_id: projectId } : {}),
        ...(params.scope === "project" && projectName ? { project_name: projectName } : {}),
        created_at: existing ? loadInstinct(existing.path).created_at : now,
        updated_at: now,
        observation_count: params.observation_count ?? 1,
        confirmed_count: params.confirmed_count ?? 0,
        contradicted_count: params.contradicted_count ?? 0,
        inactive_count: params.inactive_count ?? 0,
        ...(params.evidence ? { evidence: params.evidence } : {}),
      };

      saveInstinct(instinct, dir);

      return {
        content: [{ type: "text" as const, text: `${existing ? "Updated" : "Created"} instinct: ${params.id}` }],
        details: { id: params.id, action: existing ? "updated" : "created" },
      };
    },
  };
}

export function createInstinctReadTool(
  projectId: string | null,
  baseDir?: string
) {
  return {
    name: "instinct_read" as const,
    label: "Read Instinct",
    description: "Read a specific instinct by ID",
    promptSnippet: "Read the full details of a specific learned instinct by ID",
    parameters: ReadParams,
    async execute(
      _toolCallId: string,
      params: InstinctReadInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown
    ) {
      const found = findInstinctFile(params.id, projectId, baseDir);
      if (!found) {
        throw new Error(`Instinct not found: ${params.id}`);
      }
      const instinct = loadInstinct(found.path);
      return {
        content: [{ type: "text" as const, text: formatInstinct(instinct) }],
        details: instinct,
      };
    },
  };
}

export function createInstinctListTool(
  projectId: string | null,
  baseDir?: string
) {
  return {
    name: "instinct_list" as const,
    label: "List Instincts",
    description: "List learned behavior instincts with optional filters",
    promptSnippet: "List all learned instincts, optionally filtered by scope or domain",
    parameters: ListParams,
    async execute(
      _toolCallId: string,
      params: InstinctListInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown
    ) {
      const scope = params.scope ?? "all";
      let instincts: Instinct[] = [];

      if ((scope === "project" || scope === "all") && projectId) {
        instincts.push(...loadProjectInstincts(projectId, baseDir));
      }
      if (scope === "global" || scope === "all") {
        instincts.push(...loadGlobalInstincts(baseDir));
      }

      if (params.domain) {
        const domain = params.domain.toLowerCase();
        instincts = instincts.filter((i) => i.domain.toLowerCase() === domain);
      }

      instincts.sort((a, b) => b.confidence - a.confidence);

      if (instincts.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No instincts found matching the given filters." }],
          details: { count: 0 },
        };
      }

      const text = instincts.map(formatInstinct).join("\n\n");
      return {
        content: [{ type: "text" as const, text: `${instincts.length} instinct(s):\n\n${text}` }],
        details: { count: instincts.length },
      };
    },
  };
}

export function createInstinctDeleteTool(
  projectId: string | null,
  baseDir?: string
) {
  return {
    name: "instinct_delete" as const,
    label: "Delete Instinct",
    description: "Remove a learned instinct by ID",
    promptSnippet: "Delete a learned instinct permanently by ID",
    parameters: DeleteParams,
    async execute(
      _toolCallId: string,
      params: InstinctDeleteInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown
    ) {
      if (params.scope) {
        const dir = getInstinctsDir(params.scope, projectId, baseDir);
        if (!dir) {
          throw new Error(`Cannot target project scope: no project detected`);
        }
        const path = join(dir, `${params.id}.md`);
        if (!existsSync(path)) {
          throw new Error(`Instinct not found: ${params.id} in ${params.scope} scope`);
        }
        unlinkSync(path);
        return {
          content: [{ type: "text" as const, text: `Deleted instinct: ${params.id} (${params.scope}-scoped)` }],
          details: { id: params.id, scope: params.scope },
        };
      }

      const found = findInstinctFile(params.id, projectId, baseDir);
      if (!found) {
        throw new Error(`Instinct not found: ${params.id}`);
      }
      unlinkSync(found.path);
      return {
        content: [{ type: "text" as const, text: `Deleted instinct: ${params.id} (was ${found.scope}-scoped)` }],
        details: { id: params.id, scope: found.scope },
      };
    },
  };
}

export function createInstinctMergeTool(
  projectId: string | null,
  projectName: string | null,
  baseDir?: string
) {
  return {
    name: "instinct_merge" as const,
    label: "Merge Instincts",
    description: "Merge multiple instincts into one, removing the originals",
    promptSnippet: "Merge multiple related instincts into a single consolidated instinct",
    parameters: MergeParams,
    async execute(
      _toolCallId: string,
      params: InstinctMergeInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown
    ) {
      const { merged, delete_ids } = params;
      const dir = getInstinctsDir(merged.scope, projectId, baseDir);
      if (!dir) {
        throw new Error("Cannot write project-scoped instinct: no project detected");
      }

      const now = new Date().toISOString();
      const instinct: Instinct = {
        ...merged,
        source: "personal",
        ...(merged.scope === "project" && projectId ? { project_id: projectId } : {}),
        ...(merged.scope === "project" && projectName ? { project_name: projectName } : {}),
        created_at: now,
        updated_at: now,
        observation_count: 0,
        confirmed_count: 0,
        contradicted_count: 0,
        inactive_count: 0,
        ...(merged.evidence ? { evidence: merged.evidence } : {}),
      };

      saveInstinct(instinct, dir);

      const deleted: string[] = [];
      for (const id of delete_ids) {
        if (id === merged.id) continue;
        const found = findInstinctFile(id, projectId, baseDir);
        if (found) {
          unlinkSync(found.path);
          deleted.push(id);
        }
      }

      for (const { id, scope } of params.delete_scoped_ids ?? []) {
        // Skip only when both ID and scope match the merged result (already written above)
        if (id === merged.id && scope === merged.scope) continue;
        const dir = getInstinctsDir(scope, projectId, baseDir);
        if (!dir) {
          throw new Error(`Cannot target project scope: no project detected`);
        }
        const path = join(dir, `${id}.md`);
        if (!existsSync(path)) {
          throw new Error(`Instinct not found: ${id} in ${scope} scope`);
        }
        unlinkSync(path);
        deleted.push(`${id}(${scope})`);
      }

      return {
        content: [{
          type: "text" as const,
          text: `Merged into ${merged.id}. Deleted ${deleted.length} source instinct(s): ${deleted.join(", ")}`,
        }],
        details: { mergedId: merged.id, deleted },
      };
    },
  };
}

export function registerAllTools(
  pi: ExtensionAPI,
  projectId: string | null,
  projectName: string | null,
  baseDir?: string
): void {
  const guidelines = [
    "Use instinct tools when the user asks about learned behaviors, patterns, or instincts.",
  ];

  pi.registerTool({ ...createInstinctListTool(projectId, baseDir), promptGuidelines: guidelines });
  pi.registerTool({ ...createInstinctReadTool(projectId, baseDir), promptGuidelines: guidelines });
  pi.registerTool({ ...createInstinctWriteTool(projectId, projectName, baseDir), promptGuidelines: guidelines });
  pi.registerTool({ ...createInstinctDeleteTool(projectId, baseDir), promptGuidelines: guidelines });
  pi.registerTool({ ...createInstinctMergeTool(projectId, projectName, baseDir), promptGuidelines: guidelines });
}
