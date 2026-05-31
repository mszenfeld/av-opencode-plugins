import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { COORDINATOR_AGENT_NAME, getSessionAgent } from "@appverk/opencode-skill-utils"
import { buildSkillCatalog } from "./skill-catalog.js"
import { createSkillLoader } from "./load-skill.js"
import { generateActivationRules } from "./prompt-injector.js"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

const skillDirectories = [
  path.resolve(moduleDirectory, "../../python-developer/dist/skills"),
  path.resolve(moduleDirectory, "../../frontend-developer/dist/skills"),
  path.resolve(moduleDirectory, "../../code-review/dist/skills"),
  path.resolve(moduleDirectory, "../../../dist/skills/qa"),
  path.resolve(moduleDirectory, "../../swift-developer/dist/skills"),
]

export const AppVerkSkillRegistryPlugin: Plugin = async ({ client }) => {
  const catalog = buildSkillCatalog(skillDirectories)
  const loadSkill = createSkillLoader(catalog)
  const activationRules = generateActivationRules(catalog)

  return {
    config: async (config: any) => {
      // Register skill directories so OpenCode discovers them natively.
      config.skills = config.skills || {}
      config.skills.paths = config.skills.paths || []
      for (const dir of skillDirectories) {
        if (!config.skills.paths.includes(dir)) {
          config.skills.paths.push(dir)
        }
      }
    },
    tool: {
      load_appverk_skill: tool({
        description:
          "Load an AppVerk development skill by name. Returns the full markdown content of the skill's rules and patterns. Available skills include python-coding-standards, frontend-coding-standards, python-tdd-workflow, frontend-tdd-workflow, fastapi-patterns, sqlalchemy-patterns, tailwind-patterns, and more.",
        args: {
          name: tool.schema
            .string()
            .describe("Skill name (e.g., python-coding-standards, fastapi-patterns)"),
        },
        async execute(args: { name: string }) {
          try {
            return loadSkill(args.name)
          } catch (error) {
            return `Error: ${(error as Error).message}`
          }
        },
      }),
    },
    "experimental.chat.system.transform": async (input, output) => {
      // Suppress the skill-activation injection for the coordinator (Perun): these are
      // executor coding-standards, irrelevant to orchestration and a documented pressure
      // pulling the coordinator toward self-execution.
      // Fail-CLOSED on a missing sessionID (the Agent.generate scaffolding path needs no rules).
      if (!input.sessionID) return
      // Precise positive identification: only the coordinator is suppressed — every other
      // agent (dispatched specialists, developer-as-primary) keeps its rules. On the
      // coordinator's very first turn getSessionAgent may be unresolvable (messages not yet
      // queryable); in that window the rules are injected but harmless, because Perun's
      // skill-loading tools are already disabled (Task 5 coordinator config).
      if ((await getSessionAgent(input.sessionID, client)) === COORDINATOR_AGENT_NAME) return
      output.system.push(activationRules)
    },
  }
}

export default AppVerkSkillRegistryPlugin
