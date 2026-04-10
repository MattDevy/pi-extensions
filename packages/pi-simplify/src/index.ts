import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { handleSimplifyCommand, COMMAND_NAME } from "./simplify-command.js";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAME, {
    description:
      "Review recently changed files for clarity, consistency, and maintainability improvements",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleSimplifyCommand(args, ctx, pi),
  });
}
