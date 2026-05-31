import { PluginInput, Plugin } from '@opencode-ai/plugin';

/**
 * Canonical Category → Prefix mapping for the code-review and QA plugin ecosystem.
 *
 * This is the single source of truth for issue prefixes. Both the code-review
 * plugin (`/review`, `/fix`) and the QA plugin (`/run-qa`) must stay in sync
 * with this table.
 *
 * - **Owned by:** code-review plugin (defines categories and prefixes)
 * - **Consumed by:** QA plugin (produces QA-XXX issues with Category: Testing)
 *
 * When adding a new category or prefix, update this mapping and then regenerate
 * the built assets in both plugins.
 */
declare const CATEGORY_PREFIX_MAPPING: Readonly<Record<string, string>>;
/** Valid issue prefixes derived from the canonical mapping. */
declare const VALID_PREFIXES: string[];
/** Valid categories derived from the canonical mapping. */
declare const VALID_CATEGORIES: string[];

type Client = PluginInput["client"];
/**
 * The agent identifier the coordinator (Perun) session runs under.
 * Pinned in Task 1b to the observed `UserMessage.info.agent` value and kept in
 * sync with the `config.agent[...]` key in src/modules/coordinator/index.ts via
 * the sync test in Task 7.
 */
declare const COORDINATOR_AGENT_NAME = "Perun - Coordinator";
/** Parent session id, or undefined for a parentless (top/primary) session. Never throws. */
declare function getSessionParentID(sessionID: string, client: Client): Promise<string | undefined>;
/** The agent a session runs under, from its first user message. Undefined if unknown. Never throws. */
declare function getSessionAgent(sessionID: string, client: Client): Promise<string | undefined>;
/** True only when the session is positively identified as the coordinator. */
declare function isCoordinatorSession(sessionID: string, client: Client): Promise<boolean>;

/** Parse `Bash(<prog>:*)` programs out of an agent's `allowed-tools` frontmatter line. */
declare function parseAllowedBashPrograms(frontmatter: string): string[];
interface BashClassification {
    allowed: boolean;
    program: string | null;
}
/** Decide whether a coordinator bash command is permitted (allowlist + no compounds). */
declare function classifyCoordinatorBash(command: string, allowedPrograms: string[]): BashClassification;
interface ViolationInfo {
    tool: string;
    command?: string;
    skill?: string;
    reason: string;
}
/**
 * Build the rejection error. The message embeds a machine-readable marker + JSON
 * (so it surfaces in `info.error`, which the eval reads) and a human/LLM redirect (G).
 */
declare function buildViolationError(info: ViolationInfo): Error;

interface CreateSkillPluginOptions {
    namespace: string;
    agentName: string;
    commandName: string;
    agentDescription: string;
    commandDescription: string;
    loadSkill: ((name: string) => string) | null;
    availableSkills: readonly string[];
    moduleDirectory: string;
    mode?: "primary" | "subagent";
}
interface CreateSkillLoaderOptions {
    namespace: string;
    availableSkills: readonly string[];
    moduleDirectory: string;
}
declare function createSkillLoader(options: CreateSkillLoaderOptions): (name: string) => string;

declare function createSkillPlugin(options: CreateSkillPluginOptions): Plugin;

export { type BashClassification, CATEGORY_PREFIX_MAPPING, COORDINATOR_AGENT_NAME, type CreateSkillLoaderOptions, type CreateSkillPluginOptions, VALID_CATEGORIES, VALID_PREFIXES, type ViolationInfo, buildViolationError, classifyCoordinatorBash, createSkillLoader, createSkillPlugin, getSessionAgent, getSessionParentID, isCoordinatorSession, parseAllowedBashPrograms };
