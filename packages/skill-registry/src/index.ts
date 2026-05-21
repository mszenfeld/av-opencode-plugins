import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
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

export const AppVerkSkillRegistryPlugin: Plugin = async () => {
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
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(activationRules)
    },
  }
}

export default AppVerkSkillRegistryPlugin
