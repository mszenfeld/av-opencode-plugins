import type { SpecialistInfo } from "./agent-metadata.js"

export const PERUN_PLACEHOLDERS = [
  "SPECIALISTS_TABLE",
  "KEY_TRIGGERS",
  "DELEGATION_TABLE",
] as const

function byName(a: SpecialistInfo, b: SpecialistInfo): number {
  return a.name.localeCompare(b.name)
}

export function buildSpecialistsTable(registry: SpecialistInfo[]): string {
  if (registry.length === 0) return ""
  const rows = [...registry]
    .sort(byName)
    .map((a) => `| \`${a.name}\` | ${a.mode} | ${a.description} |`)
  return ["| Name | Mode | Purpose |", "|---|---|---|", ...rows].join("\n")
}

export function buildKeyTriggersSection(registry: SpecialistInfo[]): string {
  const withTrigger = [...registry]
    .sort(byName)
    .filter((a) => a.metadata.keyTrigger !== undefined)
  if (withTrigger.length === 0) return ""
  const bullets = withTrigger.map((a) => `- ${a.metadata.keyTrigger}`)
  return ["### Key Triggers (check BEFORE classification):", "", ...bullets].join("\n")
}

export function buildDelegationTable(registry: SpecialistInfo[]): string {
  const rows: string[] = []
  for (const agent of [...registry].sort(byName)) {
    for (const t of agent.metadata.triggers) {
      rows.push(`| ${t.domain} | \`${agent.name}\` | ${t.trigger} |`)
    }
  }
  if (rows.length === 0) return ""
  return [
    "### Delegation Table:",
    "",
    "| Domain | Agent | Trigger |",
    "|---|---|---|",
    ...rows,
  ].join("\n")
}
