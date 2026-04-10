import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { complete, getModel } from "@mariozechner/pi-ai";
import { detectLanguage } from "./language-detector.js";
import { buildReviewPrompt, buildFallbackPrompt } from "./review-prompt.js";
import { parseReviewFindings, formatFindings } from "./review-parser.js";
import type { EditedFile } from "./types.js";

export const COMMAND_NAME = "review";

const HAIKU_MODEL_ID = "claude-haiku-4-5-20251001";
const MAX_FILES = 10;

interface ReviewOptions {
  readonly files: readonly string[];
  readonly ref: string;
  readonly staged: boolean;
}

export function parseArgs(args: string): ReviewOptions {
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

interface ChangedFile {
  readonly path: string;
  readonly status: string;
}

const STATUS_MAP: Record<string, string> = {
  M: "modified",
  A: "added",
  R: "renamed",
  C: "copied",
};

function parseDiffOutput(stdout: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const statusCode = parts[0]?.[0];
    if (!statusCode) continue;
    const status = STATUS_MAP[statusCode];
    if (!status) continue;
    const path = (statusCode === "R" || statusCode === "C") ? parts[2] : parts[1];
    if (path) files.push({ path, status });
  }
  return files;
}

async function getChangedFiles(
  pi: ExtensionAPI,
  cwd: string,
  options: ReviewOptions,
): Promise<string[]> {
  if (options.files.length > 0) {
    return [...options.files];
  }

  const args = ["diff", "--name-status"];
  if (options.staged) {
    args.push("--cached");
  } else {
    args.push(options.ref);
  }

  const result = await pi.exec("git", args, { cwd });
  if (result.code === 0) {
    const files = parseDiffOutput(result.stdout).map((f) => f.path);
    if (files.length > 0) return files;
  }

  const fallback = await pi.exec("git", ["diff", "--name-status", "HEAD~1"], { cwd });
  if (fallback.code === 0) {
    return parseDiffOutput(fallback.stdout).map((f) => f.path);
  }

  return [];
}

async function readFileContent(
  pi: ExtensionAPI,
  cwd: string,
  filePath: string,
): Promise<string> {
  const result = await pi.exec("cat", [filePath], { cwd });
  if (result.code === 0) return result.stdout;
  return "";
}

export async function handleReviewCommand(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const options = parseArgs(args);
  const filePaths = await getChangedFiles(pi, ctx.cwd, options);

  if (filePaths.length === 0) {
    ctx.ui.notify(
      "No changed files found. Specify file paths or make some changes first.",
      "info",
    );
    return;
  }

  const capped = filePaths.slice(0, MAX_FILES);
  if (filePaths.length > MAX_FILES) {
    ctx.ui.notify(
      `Reviewing first ${MAX_FILES} of ${filePaths.length} changed files.`,
      "info",
    );
  }

  const editedFiles: EditedFile[] = capped.map((path) => ({
    path,
    language: detectLanguage(path),
  }));

  const apiKey = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
  if (apiKey) {
    try {
      const filesWithContent = await Promise.all(
        editedFiles.map(async (f) => ({
          ...f,
          content: await readFileContent(pi, ctx.cwd, f.path),
        })),
      );

      const prompt = buildReviewPrompt(filesWithContent);
      const model = getModel("anthropic", HAIKU_MODEL_ID);
      const context = {
        messages: [{ role: "user" as const, content: prompt, timestamp: Date.now() }],
      };

      const message = await complete(model, context, { apiKey });
      const text = message.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { type: "text"; text: string }).text)
        .join("");

      const findings = parseReviewFindings(text);
      const formatted = formatFindings(findings);

      pi.sendUserMessage(
        `Code review complete for ${capped.length} file(s):\n\n${formatted}`,
        { deliverAs: "followUp" },
      );
      return;
    } catch (err) {
      console.warn("[pi-code-review] Haiku review failed, falling back to prompt:", err);
    }
  }

  const fallbackPrompt = buildFallbackPrompt(editedFiles);
  pi.sendUserMessage(fallbackPrompt, { deliverAs: "followUp" });
}
