import { registerAgentMetadata } from "../agent-registry/index.js";
import { triglavSpecialistInfo } from "./triglav.metadata.js";
import { buildTriglavPrompt } from "./prompt.js";
import { isSerenaAvailable } from "./serena-detect.js";
const AppVerkExplorePlugin = async ({ client }) => {
  registerAgentMetadata(triglavSpecialistInfo);
  let serenaMissing = false;
  let toastShown = false;
  return {
    config: async (config) => {
      config.agent ??= {};
      config.agent["triglav"] = {
        description: triglavSpecialistInfo.description,
        mode: "subagent",
        get prompt() {
          return buildTriglavPrompt();
        }
      };
      serenaMissing = !isSerenaAvailable(config);
    },
    event: async ({ event }) => {
      if (event.type !== "session.created") return;
      if (toastShown || !serenaMissing) return;
      const message = "Triglav registered but serena MCP not found \u2014 exploration runs in degraded mode (Grep/Glob). Install serena for semantic search.";
      try {
        console.error(`Pantheon: ${message}`);
        await client.tui.showToast({
          body: { variant: "warning", title: "Pantheon", message }
        });
      } catch {
      }
      toastShown = true;
    }
  };
};
var explore_default = AppVerkExplorePlugin;
export {
  AppVerkExplorePlugin,
  explore_default as default
};
