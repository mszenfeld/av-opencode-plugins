import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@opencode-ai/plugin";
import { classifyBashCommand } from "./bash-policy.js";
import { createControlledCommit } from "./controlled-commit.js";
const COMMIT_COMMAND_DESCRIPTION = "Create a git commit with the AppVerk commit workflow";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const packagedCommandPath = path.resolve(moduleDirectory, "../../commands/commit.md");
const sourceCommandPath = path.resolve(moduleDirectory, "../../../src/commands/commit.md");
function loadCommitCommandTemplate() {
  try {
    return readFileSync(packagedCommandPath, "utf8");
  } catch {
    return readFileSync(sourceCommandPath, "utf8");
  }
}
function createLazyCommitTemplateLoader() {
  let cached;
  return () => {
    if (cached === void 0) {
      cached = loadCommitCommandTemplate();
    }
    return cached;
  };
}
const AppVerkCommitPlugin = async () => {
  const getCommitTemplate = createLazyCommitTemplateLoader();
  return {
    config: async (config) => {
      config.command = config.command ?? {};
      config.command.commit = {
        description: COMMIT_COMMAND_DESCRIPTION,
        get template() {
          return getCommitTemplate();
        }
      };
    },
    tool: {
      av_commit: tool({
        description: "Create a commit through the AppVerk commit workflow",
        args: {
          message: tool.schema.string().describe("The Conventional Commit message to create"),
          files: tool.schema.array(tool.schema.string()).optional().describe("Optional file paths to stage before committing"),
          taskId: tool.schema.string().optional().describe("Optional task ID appended as a Refs footer")
        },
        async execute(args, context) {
          const result = await createControlledCommit({
            cwd: context.worktree ?? context.directory,
            message: args.message,
            files: args.files ?? [],
            taskId: args.taskId
          });
          return JSON.stringify(result, null, 2);
        }
      })
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") {
        return;
      }
      const command = String(output.args.command ?? "");
      const decision = classifyBashCommand(command);
      if (decision === "block-direct-commit") {
        throw new Error("Direct git commit is blocked. Use /commit instead.");
      }
      if (decision === "block-push") {
        throw new Error("git push is blocked by @appverk/opencode-commit.");
      }
    }
  };
};
var commit_default = AppVerkCommitPlugin;
export {
  AppVerkCommitPlugin,
  commit_default as default
};
