import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { getChangedFiles } from "./git-diff.js";
import { buildSimplifyPrompt } from "./prompt-builder.js";
import type { SimplifyOptions } from "./types.js";

export const COMMAND_NAME = "simplify";

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
  const options = parseArgs(args);
  const files = await getChangedFiles(pi, ctx.cwd, options);

  if (files.length === 0) {
    ctx.ui.notify(
      "No changed files found. Specify file paths or make some changes first.",
      "info",
    );
    return;
  }

  const prompt = buildSimplifyPrompt(files);
  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}
