import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { NO_CHANGES_MESSAGE, resolveSimplifyRequest } from "./simplify-command.js";
import type { ChangedFile } from "./types.js";

export const TOOL_NAME = "simplify";

export const TOOL_PREAMBLE =
  "Simplification scope resolved. These are instructions, not a completed review: " +
  "apply any warranted improvements below and run the relevant checks before moving to the next quality gate.";

const SimplifyToolParams = Type.Object({
  files: Type.Optional(
    Type.Array(Type.String(), {
      description: "Specific file paths to review (default: detect changed files via git diff)",
    }),
  ),
  ref: Type.Optional(
    Type.String({ description: "Git ref to diff against (default: HEAD)" }),
  ),
  staged: Type.Optional(
    Type.Boolean({ description: "Only review staged changes (default: false)" }),
  ),
});

type SimplifyToolInput = Static<typeof SimplifyToolParams>;

interface SimplifyToolDetails {
  readonly found: boolean;
  readonly files: readonly ChangedFile[];
}

export function createSimplifyTool(pi: ExtensionAPI) {
  return {
    name: TOOL_NAME,
    label: "Simplify",
    description:
      "Resolves the changed files and line ranges (via git diff) and returns simplification instructions " +
      "scoped to those lines. Returns instructions only; it does not modify any files.",
    promptSnippet:
      "Resolve the changed-file scope and get simplification instructions for recently changed code",
    promptGuidelines: [
      "The simplify tool only returns scope and instructions; you must apply warranted improvements and re-run the relevant checks yourself before treating simplification as done.",
    ],
    parameters: SimplifyToolParams,
    async execute(
      _toolCallId: string,
      params: SimplifyToolInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { readonly cwd: string },
    ) {
      const ref = params.ref ?? "HEAD";
      // ref is passed to git before "--"; reject values git would parse as options (e.g. --output=<file>).
      if (ref.startsWith("-")) {
        throw new Error(`Invalid ref "${ref}": a git ref must not start with "-".`);
      }

      const request = await resolveSimplifyRequest(pi, ctx.cwd, {
        files: params.files ?? [],
        ref,
        staged: params.staged ?? false,
      });

      if (!request) {
        const details: SimplifyToolDetails = { found: false, files: [] };
        return {
          content: [{ type: "text" as const, text: NO_CHANGES_MESSAGE }],
          details,
        };
      }

      const details: SimplifyToolDetails = { found: true, files: request.files };
      return {
        content: [{ type: "text" as const, text: `${TOOL_PREAMBLE}\n\n${request.prompt}` }],
        details,
      };
    },
  };
}

export function registerSimplifyTool(pi: ExtensionAPI): void {
  pi.registerTool(createSimplifyTool(pi));
}
