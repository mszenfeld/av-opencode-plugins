import type { SpecialistInfo } from "./agent-metadata.js"

export * from "./agent-metadata.js"
// Builder re-exports restored in Task 3 once perun-prompt-builder.ts exists.
// export {
//   PERUN_PLACEHOLDERS,
//   buildDelegationTable,
//   buildKeyTriggersSection,
//   buildPerunPrompt,
//   buildSpecialistsTable,
//   buildUseAvoidSection,
// } from "./perun-prompt-builder.js"

const registry: SpecialistInfo[] = []

/**
 * Push one logical agent's metadata into the process-wide registry. Called once
 * per agent in its registering module's factory body (mirrors
 * `registerDispatchExtensions`). Throws on duplicate logical name — fail-fast at
 * startup, mirroring the `mergeTools` duplicate-tool throw in `src/index.ts`.
 */
export function registerAgentMetadata(info: SpecialistInfo): void {
  if (registry.some((a) => a.name === info.name)) {
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
