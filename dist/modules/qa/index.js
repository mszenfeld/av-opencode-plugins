import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildQATesterAgent } from "./prompt-builder.js";
import { loadPantheonConfig } from "../pantheon-config/index.js";
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
    description: "Execute a QA test plan \u2014 Perun dispatches one zmora variant per scenario through dispatch_parallel.",
    file: "run-qa.md"
  }
];
const AppVerkQAPlugin = async () => ({
  config: async (config) => {
    config.agent ??= {};
    for (const stack of VARIANTS) {
      let cached;
      config.agent[`zmora-${stack}`] = {
        description: `Zmora \u2014 ${stack.toUpperCase()} QA scenarios (internal variant of zmora)`,
        get prompt() {
          cached ??= buildQATesterAgent(stack).prompt;
          return cached;
        },
        mode: "subagent"
      };
    }
    const zmoraModel = loadPantheonConfig().agents.zmora?.model;
    if (zmoraModel !== void 0) {
      for (const stack of VARIANTS) {
        config.agent[`zmora-${stack}`].model = zmoraModel;
      }
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
