import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildQATesterAgent } from "./prompt-builder.js";
import { FE_TOOLS, BE_TOOLS, SHARED_TOOLS, toolsForVariant } from "./allowed-tools.js";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
function loadCommandMarkdown(name) {
  const filePath = path.resolve(moduleDir, "../../commands", name);
  return readFileSync(filePath, "utf8");
}
const VARIANTS = ["fe", "be"];
const COMMANDS = [
  {
    name: "create-qa-plan",
    description: "Analyze code changes and generate a detailed QA test plan with FE and BE scenarios.",
    file: "create-qa-plan.md"
  },
  {
    name: "run-qa",
    description: "Execute a QA test plan \u2014 Perun dispatches one qa-tester variant per scenario through dispatch_parallel.",
    file: "run-qa.md"
  }
];
const AppVerkQAPlugin = async () => ({
  config: async (config) => {
    config.agent ??= {};
    for (const stack of VARIANTS) {
      let cached;
      config.agent[`qa-tester-${stack}`] = {
        description: `QA tester \u2014 ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`,
        get prompt() {
          cached ??= buildQATesterAgent(stack).prompt;
          return cached;
        },
        mode: "subagent"
      };
    }
    config.command ??= {};
    for (const c of COMMANDS) {
      let cached;
      config.command[c.name] = {
        description: c.description,
        get template() {
          cached ??= loadCommandMarkdown(c.file);
          return cached;
        }
      };
    }
  }
});
var qa_default = AppVerkQAPlugin;
export {
  AppVerkQAPlugin,
  BE_TOOLS,
  FE_TOOLS,
  SHARED_TOOLS,
  buildQATesterAgent,
  qa_default as default,
  toolsForVariant
};
