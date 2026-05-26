import type { SpecialistInfo } from "./agent-metadata.js"

export * from "./agent-metadata.js"
export {
  PERUN_PLACEHOLDERS,
  buildDelegationTable,
  buildKeyTriggersSection,
  buildPerunPrompt,
  buildSpecialistsTable,
  buildUseAvoidSection,
} from "./perun-prompt-builder.js"

const registry: SpecialistInfo[] = []

/**
 * Push one logical agent's metadata into the process-wide registry. Called once
 * per agent in its registering module's factory body (mirrors
 * `registerDispatchExtensions`). Throws on a CONFLICTING duplicate logical name
 * (same name, different metadata) — fail-fast at startup, mirroring the
 * `mergeTools` duplicate-tool throw in `src/index.ts`.
 *
 * Re-registering the SAME logical name with identical metadata is a no-op. The
 * factory bodies that call this run once per plugin construction, and a process
 * (or a test suite) may construct a factory more than once over its lifetime
 * (e.g. one OpenCode session per test). Idempotence on identical input keeps
 * that safe while still catching a genuine name collision between two distinct
 * agents — mirroring `registerDispatchExtensions`'s merge-don't-throw semantics
 * without silently shadowing a real conflict.
 */
export function registerAgentMetadata(info: SpecialistInfo): void {
  const existing = registry.find((a) => a.name === info.name)
  if (existing !== undefined) {
    if (JSON.stringify(existing) === JSON.stringify(info)) return
    throw new Error(`Duplicate agent metadata: ${info.name}`)
  }
  registry.push(info)
}

/** Returns a name-sorted copy (deterministic order; callers cannot mutate state). */
export function getAgentMetadataRegistry(): SpecialistInfo[] {
  return [...registry].sort((a, b) => a.name.localeCompare(b.name))
}

/** Reset to empty. Tests only — production code never clears. */
export function clearAgentMetadataRegistry(): void {
  registry.length = 0
}
