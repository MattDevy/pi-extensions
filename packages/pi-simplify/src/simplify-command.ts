import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getChangedFiles } from "./git-diff.js";
import { buildSimplifyPrompt } from "./prompt-builder.js";
import type { ChangedFile, SimplifyOptions } from "./types.js";

export const COMMAND_NAME = "simplify";

export const NO_CHANGES_MESSAGE =
  "No changed files found. Specify file paths or make some changes first.";

export interface SimplifyRequest {
  readonly files: readonly ChangedFile[];
  readonly prompt: string;
}

/** Resolves the changed-file scope and builds the simplify prompt; null when nothing changed. */
export async function resolveSimplifyRequest(
  pi: ExtensionAPI,
  cwd: string,
  options: SimplifyOptions,
): Promise<SimplifyRequest | null> {
  const files = await getChangedFiles(pi, cwd, options);
  if (files.length === 0) return null;
  return { files, prompt: buildSimplifyPrompt(files) };
}

export function parseArgs(args: string): SimplifyOptions {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const files: string[] = [];
  let ref = "HEAD";
  let staged = false;

  for (const token of tokens) {
    if (token === "--staged") {
      staged = true;
    } else if (token.startsWith("--ref=")) {
      ref = token.slice("--ref=".length);
    } else {
      files.push(token);
    }
  }

  return { files, ref, staged };
}

export async function handleSimplifyCommand(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const request = await resolveSimplifyRequest(pi, ctx.cwd, parseArgs(args));

  if (!request) {
    ctx.ui.notify(NO_CHANGES_MESSAGE, "info");
    return;
  }

  pi.sendUserMessage(request.prompt, { deliverAs: "followUp" });
}
