import { buildLanguageSection } from "./language-detector.js";
import type { TurnEdits } from "./types.js";

export interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
  systemPrompt: string;
}

export interface InjectionResult {
  systemPrompt: string;
}

export function buildReviewInjectionBlock(edits: TurnEdits): string | null {
  if (edits.files.length === 0) return null;

  const fileList = edits.files.map((f) => f.path).join(", ");
  const languages = [
    ...new Set(
      edits.files.map((f) => f.language).filter((l): l is string => l !== null),
    ),
  ];

  const checklist = buildLanguageSection(languages);

  return `\n\n## Code Review

You edited: ${fileList}. Before proceeding, briefly verify:${checklist}

Fix any issues found, then continue.`;
}

export function handleBeforeAgentStart(
  event: BeforeAgentStartEvent,
  edits: TurnEdits,
): InjectionResult | undefined {
  const block = buildReviewInjectionBlock(edits);
  if (!block) return undefined;
  return { systemPrompt: event.systemPrompt + block };
}
