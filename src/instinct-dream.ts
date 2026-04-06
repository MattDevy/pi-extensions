/**
 * /instinct-dream slash command handler.
 *
 * Interactive version of consolidation that runs inside a Pi session.
 * Loads all instincts, builds a consolidation prompt, and sends it as
 * a followUp message for the LLM to review with the user.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { InstalledSkill } from "./types.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { getBaseDir } from "./storage.js";
import { readAgentsMd } from "./agents-md.js";
import { loadProjectInstincts, loadGlobalInstincts } from "./instinct-store.js";
import { filterInstincts } from "./instinct-loader.js";
import { buildDreamPrompt } from "./prompts/dream-prompt.js";

const MAX_DREAM_INSTINCTS = 100;

export const COMMAND_NAME = "instinct-dream";

export async function handleInstinctDream(
  _args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  projectId?: string | null,
  baseDir?: string,
  projectRoot?: string | null,
  installedSkills?: InstalledSkill[],
): Promise<void> {
  const effectiveBase = baseDir ?? getBaseDir();
  const projectInstincts = projectId
    ? loadProjectInstincts(projectId, effectiveBase)
    : [];
  const globalInstincts = loadGlobalInstincts(effectiveBase);
  const allInstincts = filterInstincts(
    [...projectInstincts, ...globalInstincts],
    0.1,
    MAX_DREAM_INSTINCTS,
  );

  if (allInstincts.length === 0) {
    ctx.ui.notify(
      "No instincts to consolidate. Keep using pi to accumulate instincts first.",
      "info",
    );
    return;
  }

  const agentsMdProject =
    projectRoot != null ? readAgentsMd(join(projectRoot, "AGENTS.md")) : null;
  const agentsMdGlobal = readAgentsMd(
    join(homedir(), ".pi", "agent", "AGENTS.md"),
  );

  const prompt = buildDreamPrompt(
    allInstincts,
    agentsMdProject,
    agentsMdGlobal,
    installedSkills,
  );
  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}
