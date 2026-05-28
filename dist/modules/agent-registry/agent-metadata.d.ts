type AgentCategory = "exploration" | "specialist" | "advisor" | "utility";
type AgentCost = "FREE" | "CHEAP" | "EXPENSIVE";
type AgentMode = "subagent" | "primary" | "all";
interface DelegationTrigger {
    domain: string;
    trigger: string;
}
interface AgentPromptMetadata {
    category: AgentCategory;
    cost: AgentCost;
    keyTrigger?: string;
    useWhen?: string[];
    avoidWhen?: string[];
    triggers: DelegationTrigger[];
    promptAlias?: string;
}
/** Pantheon-specific wrapper. `name`/`mode`/`description` are known where the
 *  agent is registered; `metadata` carries the omo-derived routing fields. */
interface SpecialistInfo {
    name: string;
    mode: AgentMode;
    description: string;
    metadata: AgentPromptMetadata;
}

export type { AgentCategory, AgentCost, AgentMode, AgentPromptMetadata, DelegationTrigger, SpecialistInfo };
