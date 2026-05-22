/**
 * Schema validation for pantheon.json files. Pure functions — no I/O, no globals.
 *
 * Returns `{ config, errors }` rather than throwing so a single bad agent does
 * not invalidate the whole file. The caller (loader.ts) accumulates `errors`
 * across all source files for diagnostic display.
 */

export type PantheonConfig = {
  agents: { [name: string]: { model: string } }
}

export type ValidationResult = {
  config: PantheonConfig
  errors: string[]
}

const MODEL_REGEX = /^[^/]+\/[^/]+$/

const KNOWN_TOP_LEVEL = new Set(["agents"])
const KNOWN_AGENT_FIELDS = new Set(["model"])

function prefix(sourcePath?: string): string {
  return sourcePath !== undefined ? `[pantheon] ${sourcePath}: ` : "[pantheon] "
}

export function validateConfigFile(raw: unknown, sourcePath?: string): ValidationResult {
  const errors: string[] = []
  const out: PantheonConfig = { agents: {} }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${prefix(sourcePath)}top-level must be object`)
    return { config: out, errors }
  }

  const obj = raw as Record<string, unknown>

  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      errors.push(`${prefix(sourcePath)}unknown section "${key}" — ignoring`)
    }
  }

  const agents = obj.agents
  if (agents === undefined) {
    return { config: out, errors }
  }

  if (agents === null || typeof agents !== "object" || Array.isArray(agents)) {
    errors.push(`${prefix(sourcePath)}agents must be object — ignoring`)
    return { config: out, errors }
  }

  for (const [name, agentRaw] of Object.entries(agents as Record<string, unknown>)) {
    if (agentRaw === null || typeof agentRaw !== "object" || Array.isArray(agentRaw)) {
      errors.push(`${prefix(sourcePath)}agents.${name} must be object — ignoring`)
      continue
    }
    const agent = agentRaw as Record<string, unknown>

    for (const field of Object.keys(agent)) {
      if (!KNOWN_AGENT_FIELDS.has(field)) {
        errors.push(`${prefix(sourcePath)}unknown field "agents.${name}.${field}"`)
      }
    }

    const model = agent.model
    if (model === undefined) {
      continue
    }
    if (typeof model !== "string" || !MODEL_REGEX.test(model)) {
      const shown = typeof model === "string" ? `"${model}"` : String(model)
      errors.push(
        `${prefix(sourcePath)}invalid model ${shown} for agent "${name}" — must match <providerID>/<modelID>`,
      )
      continue
    }

    out.agents[name] = { model }
  }

  return { config: out, errors }
}
