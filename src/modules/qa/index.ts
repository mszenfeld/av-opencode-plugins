import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode-ai/plugin"
import { buildQATesterAgent } from "./prompt-builder.js"

export { buildQATesterAgent }
export { FE_TOOLS, BE_TOOLS, SHARED_TOOLS, toolsForVariant } from "./allowed-tools.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function loadCommandMarkdown(name: string): string {
  // After absorption into src/modules/qa/, this file is compiled standalone
  // (root tsup uses `bundle: false`) so `moduleDir` resolves to:
  //   Production:                dist/modules/qa/  → reads dist/commands/<name>
  //   Dev (tests against src):   src/modules/qa/   → reads src/commands/<name>
  // Both resolve via the same `../../commands/<name>` relative to moduleDir.
  // Command files land at dist/commands/<name> via copy-root-assets.mjs.
  const filePath = path.resolve(moduleDir, "../../commands", name)
  return readFileSync(filePath, "utf8")
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
      "Execute a QA test plan — Perun dispatches one qa-tester variant per scenario through dispatch_parallel.",
    file: "run-qa.md",
  },
]

export const AppVerkQAPlugin: Plugin = async () => ({
  config: async (config) => {
    config.agent ??= {}
    for (const stack of VARIANTS) {
      // Per-variant lazy cache: build the markdown once per variant at first access.
      let cached: string | undefined
      config.agent[`qa-tester-${stack}`] = {
        description: `QA tester — ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`,
        get prompt() {
          cached ??= buildQATesterAgent(stack).prompt
          return cached
        },
        mode: "subagent",
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
