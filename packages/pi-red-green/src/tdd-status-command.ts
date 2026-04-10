import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { StateRef } from "./tdd-command.js";
import { isTestRunStale } from "./tdd-injector.js";

export const COMMAND_NAME = "tdd-status";

export async function handleTddStatusCommand(
  _args: string,
  ctx: ExtensionCommandContext,
  stateRef: StateRef,
): Promise<void> {
  const state = stateRef.get();

  if (!state || state.phase === "idle") {
    ctx.ui.notify("TDD is not active. Use /tdd <task description> to start.", "info");
    return;
  }

  const lines: string[] = [
    `## TDD Status`,
    `**Phase:** ${state.phase.toUpperCase()}`,
    `**Task:** ${state.task}`,
    `**Started:** ${state.started_at}`,
    `**Turn:** ${state.current_turn_index}`,
    "",
    `**Test files:** ${state.test_files.length > 0 ? state.test_files.join(", ") : "(none)"}`,
    `**Impl files:** ${state.impl_files.length > 0 ? state.impl_files.join(", ") : "(none)"}`,
  ];

  if (state.last_test_run) {
    const run = state.last_test_run;
    const stale = isTestRunStale(state);
    lines.push(
      "",
      `**Last test run:**`,
      `  Passed: ${run.passed}, Failed: ${run.failed}, Errors: ${run.errors}`,
      `  Exit code: ${run.exit_code}`,
      `  Turn: ${run.turn_index}${stale ? " (STALE)" : ""}`,
    );
  } else {
    lines.push("", "**Last test run:** (none)");
  }

  if (state.phase_history.length > 0) {
    lines.push("", "**Phase history:**");
    for (const entry of state.phase_history) {
      lines.push(`  ${entry.phase.toUpperCase()} at ${entry.entered_at}`);
    }
  }

  ctx.ui.notify(lines.join("\n"), "info");
}
