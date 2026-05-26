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

export function buildUseAvoidSection(
  agentName: string,
  registry: SpecialistInfo[],
): string {
  const agent = registry.find((a) => a.name === agentName)
  if (agent === undefined) {
    throw new Error(`Unknown agent in placeholder: ${agentName}`)
  }
  const useWhen = agent.metadata.useWhen ?? []
  const avoidWhen = agent.metadata.avoidWhen ?? []
  if (useWhen.length === 0 && avoidWhen.length === 0) return ""
  const lines: string[] = [`### Use \`${agentName}\` when:`]
  for (const u of useWhen) lines.push(`- ${u}`)
  if (avoidWhen.length > 0) {
    lines.push("", `### Avoid \`${agentName}\` when:`)
    for (const a of avoidWhen) lines.push(`- ${a}`)
  }
  return lines.join("\n")
}

export function buildPerunPrompt(
  template: string,
  registry: SpecialistInfo[],
): string {
  const sections: Record<(typeof PERUN_PLACEHOLDERS)[number], string> = {
    SPECIALISTS_TABLE: buildSpecialistsTable(registry),
    KEY_TRIGGERS: buildKeyTriggersSection(registry),
    DELEGATION_TABLE: buildDelegationTable(registry),
  }
  let out = template
  for (const key of PERUN_PLACEHOLDERS) {
    out = out.replaceAll(`{${key}}`, sections[key])
  }
  out = out.replace(/\{USE_AVOID:([A-Za-z0-9_-]+)\}/g, (_match, name: string) =>
    buildUseAvoidSection(name, registry),
  )
  // Collapse blank-line runs left when a section renders to "" (e.g. an empty
  // KEY_TRIGGERS/DELEGATION_TABLE in 1A) so placeholder removal never leaves a
  // 3+ newline gap. Safe: the template authors no triple-newline runs itself.
  out = out.replace(/\n{3,}/g, "\n\n")
  return out
}
