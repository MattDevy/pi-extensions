import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";

import { loadConfig } from "./config.js";
import { ensureStorageLayout, loadState, saveState } from "./storage.js";
import { advancePhase } from "./state-machine.js";
import { classifyFile } from "./file-classifier.js";
import { isTestRunCommand, parseTestRunResult } from "./test-run-detector.js";
import {
  handleBeforeAgentStart as buildInjection,
  type BeforeAgentStartEvent,
} from "./tdd-injector.js";
import { updateStatusBar } from "./status-bar.js";
import { handleTddCommand, COMMAND_NAME as TDD_CMD } from "./tdd-command.js";
import {
  handleTddStatusCommand,
  COMMAND_NAME as TDD_STATUS_CMD,
} from "./tdd-status-command.js";
import { registerTddTools } from "./tdd-tools.js";
import type { TddConfig, TddState } from "./types.js";
import { createIdleState } from "./state-machine.js";

export default function (pi: ExtensionAPI): void {
  let config: TddConfig | null = null;
  let state: TddState | null = null;

  const stateRef = {
    get: (): TddState | null => state,
    set: (s: TddState) => {
      state = s;
    },
    getConfig: (): TddConfig | null => config,
  };

  pi.on("session_start", (_event, ctx) => {
    try {
      config = loadConfig();
      ensureStorageLayout();
      state = loadState() ?? createIdleState("", "");

      registerTddTools(pi, stateRef);

      if (state.phase !== "idle") {
        updateStatusBar(ctx, state);
      }
    } catch (err) {
      console.error("[pi-red-green] session_start error:", err);
    }
  });

  pi.on("session_shutdown", (_event, _ctx) => {
    try {
      if (state) saveState(state);
    } catch (err) {
      console.error("[pi-red-green] session_shutdown error:", err);
    }
  });

  pi.on("before_agent_start", (event, _ctx) => {
    try {
      if (!state || !config) return;
      return buildInjection(
        event as BeforeAgentStartEvent,
        state,
        config,
      ) ?? undefined;
    } catch (err) {
      console.error("[pi-red-green] before_agent_start error:", err);
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    try {
      if (!state || !config || state.phase === "idle") return;

      const { toolName, result, isError } = event as {
        type: "tool_execution_end";
        toolCallId: string;
        toolName: string;
        result: unknown;
        isError: boolean;
      };

      if (toolName === "Write" || toolName === "Edit") {
        const filePath = extractFilePath(result);
        if (filePath) {
          const classification = classifyFile(filePath, config);
          if (classification === "test" && !state.test_files.includes(filePath)) {
            state = { ...state, test_files: [...state.test_files, filePath] };
          } else if (
            classification === "implementation" &&
            !state.impl_files.includes(filePath)
          ) {
            state = { ...state, impl_files: [...state.impl_files, filePath] };
          }
        }
      }

      if (toolName === "Bash" && !isError) {
        const { stdout, stderr, exitCode, command } = extractBashResult(result);
        if (command && isTestRunCommand(command, config)) {
          const testResult = parseTestRunResult(stdout, stderr, exitCode);
          if (testResult) {
            const updatedResult = {
              ...testResult,
              turn_index: state.current_turn_index,
            };
            state = { ...state, last_test_run: updatedResult };

            if (config.auto_advance) {
              const trigger =
                updatedResult.errors > 0
                  ? "tests_error" as const
                  : updatedResult.failed > 0
                    ? "tests_fail" as const
                    : "tests_pass" as const;

              const previousPhase = state.phase;
              const transition = advancePhase(state, trigger);
              state = transition.state;

              if (transition.warning) {
                ctx.ui.notify(transition.warning, "warning");
              }

              if (state.phase !== previousPhase) {
                ctx.ui.notify(
                  `TDD phase: ${previousPhase.toUpperCase()} -> ${state.phase.toUpperCase()}`,
                  "info",
                );
                updateStatusBar(ctx, state);
              }
            }

            saveState(state);
          }
        }
      }
    } catch (err) {
      console.error("[pi-red-green] tool_execution_end error:", err);
    }
  });

  pi.on("turn_end", (_event, _ctx) => {
    try {
      if (!state || state.phase === "idle") return;
      state = { ...state, current_turn_index: state.current_turn_index + 1 };
      saveState(state);
    } catch (err) {
      console.error("[pi-red-green] turn_end error:", err);
    }
  });

  pi.registerCommand(TDD_CMD, {
    description: "Start, stop, or show TDD mode",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleTddCommand(args, ctx, stateRef, pi),
  });

  pi.registerCommand(TDD_STATUS_CMD, {
    description: "Show detailed TDD status",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleTddStatusCommand(args, ctx, stateRef),
  });
}

const FILE_PATH_RE = /(?:File|file|path)[:\s]+(\S+)/;

function extractFilePath(result: unknown): string | null {
  if (typeof result === "string") {
    const match = result.match(FILE_PATH_RE);
    return match?.[1] ?? null;
  }
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj["file_path"] === "string") return obj["file_path"];
    if (typeof obj["path"] === "string") return obj["path"];
  }
  return null;
}

interface BashResultShape {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

function extractBashResult(result: unknown): BashResultShape {
  const empty = { stdout: "", stderr: "", exitCode: 0, command: "" };
  if (!result || typeof result !== "object") return empty;
  const obj = result as Record<string, unknown>;
  return {
    stdout: typeof obj["stdout"] === "string" ? obj["stdout"] : "",
    stderr: typeof obj["stderr"] === "string" ? obj["stderr"] : "",
    exitCode: typeof obj["exitCode"] === "number" ? obj["exitCode"] : 0,
    command: typeof obj["command"] === "string" ? obj["command"] : "",
  };
}
