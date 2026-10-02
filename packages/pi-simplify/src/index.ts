import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { handleSimplifyCommand, COMMAND_NAME } from "./simplify-command.js";
import { registerSimplifyTool } from "./simplify-tool.js";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAME, {
    description:
      "Review recently changed code for clarity, consistency, and maintainability improvements",
    handler: (args: string, ctx: ExtensionCommandContext) =>
      handleSimplifyCommand(args, ctx, pi),
  });
  registerSimplifyTool(pi);
}
