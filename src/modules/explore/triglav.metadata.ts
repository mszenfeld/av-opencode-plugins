import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/**
 * Canonical agent key for the Triglav exploration specialist. Centralised so
 * the literal `"triglav"` is not duplicated across registration, config
 * injection, tests, and docs — mirrors the convention used for `zmora` variants
 * and Perun's coordinator name. Use this constant whenever referencing the
 * agent key programmatically (config.agent[…], pantheon.json agents.<key>).
 */
export const TRIGLAV_AGENT_KEY = "triglav" as const

export const TRIGLAV_DESCRIPTION =
  "Read-only codebase explorer: maps structure, finds definitions/references/patterns via serena LSP (Grep/Glob fallback). Returns a synthesized answer, not edits."

export const triglavSpecialistInfo: SpecialistInfo = {
  name: TRIGLAV_AGENT_KEY,
  mode: "subagent",
  description: TRIGLAV_DESCRIPTION,
  metadata: {
    category: "exploration",
    cost: "FREE",
    keyTrigger: "2+ modules / unfamiliar area involved → fire `triglav` before planning",
    useWhen: [
      "Multiple search angles needed",
      "Unfamiliar module structure",
      "Cross-layer pattern discovery",
      "User asks where/how something works in the codebase",
    ],
    avoidWhen: [
      "You already know the exact file/location",
      "A single keyword/grep suffices",
      "The target was just shown in this conversation",
    ],
    triggers: [
      {
        domain: "Code exploration",
        trigger: "Find definitions, references, structure, and patterns in the local codebase",
      },
    ],
  },
}
