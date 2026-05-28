export type AgentCategory = "exploration" | "specialist" | "advisor" | "utility"

export type AgentCost = "FREE" | "CHEAP" | "EXPENSIVE"

export type AgentMode = "subagent" | "primary" | "all"

export interface DelegationTrigger {
  domain: string
  trigger: string
}

export interface AgentPromptMetadata {
  category: AgentCategory
  cost: AgentCost
  keyTrigger?: string
  useWhen?: string[]
  avoidWhen?: string[]
  triggers: DelegationTrigger[]
  promptAlias?: string
}

/** Pantheon-specific wrapper. `name`/`mode`/`description` are known where the
 *  agent is registered; `metadata` carries the omo-derived routing fields. */
export interface SpecialistInfo {
  name: string
  mode: AgentMode
  description: string
  metadata: AgentPromptMetadata
}
