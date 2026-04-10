import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { createEditTracker } from "./edit-tracker.js";
import {
  handleBeforeAgentStart,
  type BeforeAgentStartEvent,
} from "./review-injector.js";
import { handleReviewCommand, COMMAND_NAME } from "./review-command.js";

export default function (pi: ExtensionAPI): void {
  const tracker = createEditTracker();

  pi.on("tool_execution_end", (event, _ctx) => {
    try {
      const { toolName, result } = event as {
        type: "tool_execution_end";
        toolName: string;
        result: unknown;
      };
      tracker.trackEdit(toolName, result);
    } catch (err) {
      console.error("[pi-code-review] tool_execution_end error:", err);
    }
  });

  pi.on("turn_end", (event, _ctx) => {
    try {
      const { turnIndex } = event as { type: "turn_end"; turnIndex: number };
      tracker.onTurnEnd(turnIndex);
    } catch (err) {
      console.error("[pi-code-review] turn_end error:", err);
    }
  });

  pi.on("before_agent_start", (event, _ctx) => {
    try {
      const lastEdits = tracker.getLastTurnEdits();
      if (!lastEdits || lastEdits.files.length === 0) return;
      const result = handleBeforeAgentStart(event as BeforeAgentStartEvent, lastEdits);
      tracker.clearLastTurnEdits();
      return result;
    } catch (err) {
      console.error("[pi-code-review] before_agent_start error:", err);
    }
  });

  pi.registerCommand(COMMAND_NAME, {
    description:
      "Run a thorough code review on recently changed files",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleReviewCommand(args, ctx, pi),
  });
}
