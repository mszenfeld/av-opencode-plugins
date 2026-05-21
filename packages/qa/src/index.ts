import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode-ai/plugin"
import { buildQATesterAgent } from "./modules/prompt-builder.js"

export { buildQATesterAgent }
export { FE_TOOLS, BE_TOOLS, SHARED_TOOLS, toolsForVariant } from "./modules/allowed-tools.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function loadMarkdownFile(name: string): string {
  const filePath = path.resolve(moduleDir, name)
  const baseDir = path.resolve(moduleDir, "..")
  if (!filePath.startsWith(baseDir)) {
    throw new Error("Invalid path: traversal detected")
  }
  return readFileSync(filePath, "utf8")
}

function createLazyMarkdownLoader(name: string): () => string {
  let cached: string | undefined
  return () => {
    if (cached === undefined) cached = loadMarkdownFile(name)
    return cached
  }
}

const VARIANTS = ["fe", "be"] as const

const COMMANDS = [
  {
    name: "create-qa-plan",
    description:
      "Analyze code changes (PR, branch, commits) and generate a detailed QA test plan with FE and BE scenarios, edge cases, and tool detection.",
    path: "commands/create-qa-plan.md",
  },
  {
    name: "run-qa",
    description:
      "Execute a QA test plan — Perun parses scenarios, dispatches one qa-tester variant per scenario through dispatch_parallel.",
    path: "commands/run-qa.md",
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
      const getTemplate = createLazyMarkdownLoader(c.path)
      config.command[c.name] = {
        description: c.description,
        get template() {
          return getTemplate()
        },
      }
    }
  },
})

export default AppVerkQAPlugin
