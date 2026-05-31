import { readFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export interface CreateSkillPluginOptions {
  namespace: string
  agentName: string
  commandName: string
  agentDescription: string
  commandDescription: string
  loadSkill: ((name: string) => string) | null
  availableSkills: readonly string[]
  moduleDirectory: string
  mode?: "primary" | "subagent"
}

function loadFile(packaged: string, source: string): string {
  try {
    return readFileSync(packaged, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        return readFileSync(source, "utf8")
      } catch (innerError) {
        throw new Error(
          `Failed to load plugin template. Attempted paths: ${packaged}, ${source}. Original error: ${(innerError as Error).message}`,
          { cause: innerError },
        )
      }
    }
    throw new Error(
      `Failed to load plugin template. Attempted path: ${packaged}. Original error: ${(error as Error).message}`,
      { cause: error },
    )
  }
}

function createLazyFileLoader(packaged: string, source: string): () => string {
  let cached: string | undefined
  return () => {
    if (cached === undefined) {
      cached = loadFile(packaged, source)
    }
    return cached
  }
}

export interface CreateSkillLoaderOptions {
  namespace: string
  availableSkills: readonly string[]
  moduleDirectory: string
}

export function createSkillLoader(options: CreateSkillLoaderOptions): (name: string) => string {
  const { namespace, availableSkills, moduleDirectory } = options

  const skillCache = new Map<string, string>()

  function loadSkillContent(name: string): string {
    const candidates = [
      path.resolve(moduleDirectory, "skills", name, "SKILL.md"), // packaged build (dist/skills/)
      path.resolve(moduleDirectory, "../src/skills", name, "SKILL.md"), // from dist/ in repo (src/skills/)
      path.resolve(moduleDirectory, "../skills", name, "SKILL.md"), // from src/tools/ in vitest (src/skills/)
    ]
    let lastError: Error | undefined
    for (const candidate of candidates) {
      try {
        return readFileSync(candidate, "utf8")
      } catch (error) {
        lastError = error as Error
      }
    }
    throw new Error(`${namespace} skill file not found for: ${name}`, { cause: lastError })
  }

  return function loadSkill(name: string): string {
    if (!availableSkills.includes(name)) {
      throw new Error(
        `${namespace} skill not found: ${name}. Available: ${availableSkills.join(", ")}`,
      )
    }

    if (skillCache.has(name)) {
      return skillCache.get(name)!
    }

    const content = loadSkillContent(name)
    skillCache.set(name, content)
    return content
  }
}

export { CATEGORY_PREFIX_MAPPING, VALID_PREFIXES, VALID_CATEGORIES } from "./category-prefix-mapping.js"

export * from "./session-identity.js"

export function createSkillPlugin(options: CreateSkillPluginOptions): Plugin {
  const {
    namespace,
    agentName,
    commandName,
    agentDescription,
    commandDescription,
    loadSkill,
    availableSkills,
    moduleDirectory,
    mode = "primary",
  } = options

  const packagedAgentPath = path.resolve(moduleDirectory, "agent-prompt.md")
  const sourceAgentPath = path.resolve(moduleDirectory, "../src/agent-prompt.md")
  const packagedCommandPath = path.resolve(
    moduleDirectory,
    `commands/${commandName}.md`,
  )
  const sourceCommandPath = path.resolve(
    moduleDirectory,
    `../src/commands/${commandName}.md`,
  )

  const getAgentPrompt = createLazyFileLoader(packagedAgentPath, sourceAgentPath)
  const getCommandTemplate = createLazyFileLoader(
    packagedCommandPath,
    sourceCommandPath,
  )

  const plugin: Awaited<ReturnType<Plugin>> = {
    config: async (config) => {
      config.agent = config.agent ?? {}
      config.agent[agentName] = {
        description: agentDescription,
        get prompt() {
          return getAgentPrompt()
        },
        mode,
      }

      config.command = config.command ?? {}
      config.command[commandName] = {
        description: commandDescription,
        get template() {
          return getCommandTemplate()
        },
        agent: agentName,
      }
    },
  }

  if (loadSkill) {
    plugin.tool = {
      [`load_${namespace}_skill`]: tool({
        description: `Load a ${namespace} development skill by name. Returns the full markdown content of the skill's rules and patterns.`,
        args: {
          name: tool.schema
            .string()
            .describe(`Skill name: ${availableSkills.join(", ")}`),
        },
        async execute(args: { name: string }) {
          return loadSkill(args.name)
        },
      }),
    }
  }

  return async () => plugin
}
