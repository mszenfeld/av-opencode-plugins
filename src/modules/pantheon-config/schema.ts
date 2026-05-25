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

// Printable-ASCII allow-list — `<providerID>/<modelID>` with at least one
// slash and two or more non-empty segments. Aggregator providers like
// OpenRouter use a three-segment form (`openrouter/openai/gpt-5.5`), so
// the structure is "two-or-more segments", not "exactly two". Each segment
// uses only the characters observed in real OpenCode model identifiers
// (alphanumerics, dot, dash, underscore). This is deliberately stricter
// than `[^/]+` so untrusted control sequences (ESC `\x1b`, BiDi `U+202E`,
// `\r\n`, zero-width chars) cannot reach the TUI sinks at
// `coordinator/index.ts` and `qa/index.ts` via `config.agent[...]!.model`
// — same CWE-117 class addressed for session-notification in commit
// 392b781.
const MODEL_REGEX = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/

// Unknown top-level sections are silently ignored (forward-compat per
// docs/configuring-agents.md FAQ), so there is no allow-list to maintain
// here. Unknown FIELDS under a known agent are still surfaced, because
// those are almost always typos rather than future-compat use.
const KNOWN_AGENT_FIELDS = new Set(["model"])

function prefix(sourcePath?: string): string {
  return sourcePath !== undefined ? `[pantheon] ${sourcePath}: ` : "[pantheon] "
}

export function validateConfigFile(raw: unknown, sourcePath?: string): ValidationResult {
  const errors: string[] = []
  const result: PantheonConfig = { agents: {} }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${prefix(sourcePath)}top-level must be object`)
    return { config: result, errors }
  }

  const obj = raw as Record<string, unknown>

  // Unknown top-level sections are silently skipped — pantheon.json is
  // intentionally forward-compatible (see docs/configuring-agents.md FAQ).
  // We do NOT push to `errors[]` here because a non-empty `errors` array
  // triggers a warning toast on `session.created` (see
  // `src/modules/coordinator/index.ts`), and warning users about a
  // documented forward-compat feature would be a UX bug.
  //
  // Unknown FIELDS under a known agent are still surfaced below — those are
  // user typos (e.g. "temperture" instead of "temperature"), not future
  // sections.

  const agents = obj.agents
  if (agents === undefined) {
    return { config: result, errors }
  }

  if (agents === null || typeof agents !== "object" || Array.isArray(agents)) {
    errors.push(`${prefix(sourcePath)}agents must be object — ignoring`)
    return { config: result, errors }
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
        `${prefix(sourcePath)}invalid model ${shown} for agent "${name}" — must match <providerID>/<modelID> (aggregator paths like openrouter/openai/gpt-5.5 are allowed)`,
      )
      continue
    }

    result.agents[name] = { model }
  }

  return { config: result, errors }
}
