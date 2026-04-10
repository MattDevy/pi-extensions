import { describe, it, expect } from "vitest";
import {
  buildReviewInjectionBlock,
  handleBeforeAgentStart,
} from "./review-injector.js";
import type { TurnEdits } from "./types.js";

describe("buildReviewInjectionBlock", () => {
  it("includes file paths in the injection", () => {
    const edits: TurnEdits = {
      files: [
        { path: "src/foo.ts", language: "typescript" },
        { path: "src/bar.ts", language: "typescript" },
      ],
      turnIndex: 0,
    };

    const block = buildReviewInjectionBlock(edits);

    expect(block).toContain("src/foo.ts");
    expect(block).toContain("src/bar.ts");
  });

  it("includes language-specific checklist items", () => {
    const edits: TurnEdits = {
      files: [{ path: "src/foo.ts", language: "typescript" }],
      turnIndex: 0,
    };

    const block = buildReviewInjectionBlock(edits);

    expect(block).toMatch(/type safety/i);
    expect(block).toMatch(/error handling/i);
  });

  it("includes checklists for multiple languages", () => {
    const edits: TurnEdits = {
      files: [
        { path: "src/foo.ts", language: "typescript" },
        { path: "main.py", language: "python" },
      ],
      turnIndex: 0,
    };

    const block = buildReviewInjectionBlock(edits);

    expect(block).toMatch(/typescript/i);
    expect(block).toMatch(/python/i);
  });

  it("handles files with null language", () => {
    const edits: TurnEdits = {
      files: [{ path: "src/unknown.xyz", language: null }],
      turnIndex: 0,
    };

    const block = buildReviewInjectionBlock(edits);

    expect(block).toContain("src/unknown.xyz");
  });

  it("returns null for empty files list", () => {
    const edits: TurnEdits = { files: [], turnIndex: 0 };

    expect(buildReviewInjectionBlock(edits)).toBeNull();
  });
});

describe("handleBeforeAgentStart", () => {
  it("appends injection block to system prompt", () => {
    const event = {
      type: "before_agent_start" as const,
      prompt: "user prompt",
      systemPrompt: "base system prompt",
    };
    const edits: TurnEdits = {
      files: [{ path: "src/foo.ts", language: "typescript" }],
      turnIndex: 0,
    };

    const result = handleBeforeAgentStart(event, edits);

    expect(result).toBeDefined();
    expect(result?.systemPrompt).toContain("base system prompt");
    expect(result?.systemPrompt).toContain("src/foo.ts");
  });

  it("returns undefined for empty edits", () => {
    const event = {
      type: "before_agent_start" as const,
      prompt: "user prompt",
      systemPrompt: "base system prompt",
    };
    const edits: TurnEdits = { files: [], turnIndex: 0 };

    expect(handleBeforeAgentStart(event, edits)).toBeUndefined();
  });
});
