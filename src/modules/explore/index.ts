import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import { triglavSpecialistInfo } from "./triglav.metadata.js"
import { buildTriglavPrompt } from "./prompt.js"
import { isSerenaAvailable } from "./serena-detect.js"

export const AppVerkExplorePlugin: Plugin = async ({ client }) => {
  registerAgentMetadata(triglavSpecialistInfo)

  let serenaMissing = false
  let toastShown = false

  return {
    config: async (config) => {
      config.agent ??= {}
      config.agent["triglav"] = {
        description: triglavSpecialistInfo.description,
        mode: "subagent",
        get prompt() {
          return buildTriglavPrompt()
        },
      }
      // Inject model AFTER registration (mirrors perun/zmora). The model string
      // is restricted to a printable-ASCII allow-list by `MODEL_REGEX` in
      // pantheon-config/schema.ts, so no control characters can reach this TUI
      // sink (CWE-117). When the user has not configured `agents.triglav.model`
      // the field is left unset and Triglav inherits OpenCode's session default —
      // same behaviour as perun/zmora.
      const triglavModel = loadPantheonConfig().agents.triglav?.model
      if (triglavModel !== undefined) {
        config.agent["triglav"].model = triglavModel
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
