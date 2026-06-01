import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import { TRIGLAV_AGENT_KEY, triglavSpecialistInfo } from "./triglav.metadata.js"
import { buildTriglavPrompt } from "./prompt.js"
import { isSerenaAvailable } from "../_shared/serena-detect.js"

export const AppVerkExplorePlugin: Plugin = async ({ client }) => {
  registerAgentMetadata(triglavSpecialistInfo)

  let serenaMissing = false
  let toastShown = false

  return {
    config: async (config) => {
      config.agent ??= {}
      config.agent[TRIGLAV_AGENT_KEY] = {
        description: triglavSpecialistInfo.description,
        mode: "subagent",
        get prompt() {
          return buildTriglavPrompt()
        },
      }
      // Inject model AFTER registration (mirrors perun/zmora). When
      // `agents.triglav.model` is unset, Triglav inherits OpenCode's session
      // default. Model already validated by MODEL_REGEX — see
      // src/modules/pantheon-config/schema.ts for the CWE-117 rationale.
      const triglavModel = loadPantheonConfig().agents.triglav?.model
      if (triglavModel !== undefined) {
        config.agent[TRIGLAV_AGENT_KEY].model = triglavModel
      }
      serenaMissing = !isSerenaAvailable(config)
    },
    event: async ({ event }) => {
      if (event.type !== "session.created") return
      if (toastShown || !serenaMissing) return
      const message =
        "Triglav registered but serena MCP not found — exploration runs in degraded mode (Grep/Glob). Install serena for semantic search."
      try {
        console.error(`Pantheon: ${message}`)
        await client.tui.showToast({
          body: { variant: "warning", title: "Pantheon", message },
        })
      } catch {
        // best-effort: headless / non-TUI invocations must not crash.
      }
      toastShown = true
    },
  }
}

export default AppVerkExplorePlugin
