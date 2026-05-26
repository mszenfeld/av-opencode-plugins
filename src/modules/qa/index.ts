import type { Plugin } from "@opencode-ai/plugin"
import { buildQATesterAgent } from "./prompt-builder.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import { loadModuleAsset } from "../_shared/load-asset.js"

export { buildQATesterAgent }
export { FE_TOOLS, BE_TOOLS, SHARED_TOOLS, toolsForVariant } from "./allowed-tools.js"

function loadCommandMarkdown(name: string): string {
  return loadModuleAsset(import.meta.url, `../../commands/${name}`)
}

const VARIANTS = ["fe", "be"] as const

const COMMANDS = [
  {
    name: "create-qa-plan",
    description:
      "Analyze code changes and generate a detailed QA test plan with FE and BE scenarios.",
    file: "create-qa-plan.md",
  },
  {
    name: "run-qa",
    description:
      "Execute a QA test plan — Perun dispatches one zmora variant per scenario through dispatch_parallel.",
    file: "run-qa.md",
  },
]

export const AppVerkQAPlugin: Plugin = async () => ({
  config: async (config) => {
    config.agent ??= {}
    for (const stack of VARIANTS) {
      // Per-variant lazy cache: build the markdown once per variant at first access.
      let cached: string | undefined
      config.agent[`zmora-${stack}`] = {
        description: `Zmora — ${stack.toUpperCase()} QA scenarios (internal variant of zmora)`,
        get prompt() {
          cached ??= buildQATesterAgent(stack).prompt
          return cached
        },
        mode: "subagent",
      }
    }

    // Inject model AFTER registration so we don't merge it into every literal
    // above — the non-null assertion is safe because the loop above just set
    // each `zmora-${stack}` key. The model string is also restricted to a
    // printable-ASCII allow-list by `MODEL_REGEX` in pantheon-config/schema.ts,
    // so no control characters can reach this TUI sink (CWE-117).
    const zmoraModel = loadPantheonConfig().agents.zmora?.model
    if (zmoraModel !== undefined) {
      for (const stack of VARIANTS) {
        config.agent[`zmora-${stack}`]!.model = zmoraModel
      }
    }

    config.command ??= {}
    for (const c of COMMANDS) {
      let cached: string | undefined
      config.command[c.name] = {
        description: c.description,
        get template() {
          cached ??= loadCommandMarkdown(c.file)
          return cached
        },
      }
    }
  },
})

export default AppVerkQAPlugin
