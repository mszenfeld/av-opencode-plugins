import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import { VELES_AGENT_KEY, velesSpecialistInfo } from "./veles.metadata.js"
import { buildVelesPrompt } from "./prompt.js"
import { isSerenaAvailable } from "../explore/serena-detect.js"

export const AppVerkPlanPlugin: Plugin = async ({ client }) => {
  registerAgentMetadata(velesSpecialistInfo)

  let serenaMissing = false
  let toastShown = false

  return {
    config: async (config) => {
      config.agent ??= {}
      config.agent[VELES_AGENT_KEY] = {
        description: velesSpecialistInfo.description,
        mode: "all",
        get prompt() {
          return buildVelesPrompt()
        },
        // Plugin tools are opt-in per agent. Veles orchestrates read-only
        // helpers (triglav now), so it needs the dispatch tools. These are
        // the coordinator's process-wide tools — enabling here, not in the
        // markdown allow-list (which is a no-op for plugin tools).
        tools: {
          dispatch_parallel: true,
          dispatch_background: true,
          poll_background: true,
          wait_background: true,
        },
      }
      // Inject model AFTER registration (mirrors triglav/zmora/perun). Model
      // already validated by MODEL_REGEX — see pantheon-config/schema.ts.
      const velesModel = loadPantheonConfig().agents.veles?.model
      if (velesModel !== undefined) {
        config.agent[VELES_AGENT_KEY].model = velesModel
      }
      serenaMissing = !isSerenaAvailable(config)
    },
    event: async ({ event }) => {
      if (event.type !== "session.created") return
      if (toastShown || !serenaMissing) return
      const message =
        "Veles registered but serena MCP not found — planning runs in degraded mode (Grep/Glob). Install serena for semantic context."
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

export default AppVerkPlanPlugin
