import type { PluginInput } from "@opencode-ai/plugin"

type Client = PluginInput["client"]

/**
 * The agent identifier the coordinator (Perun) session runs under.
 * Pinned in Task 1b to the observed `UserMessage.info.agent` value and kept in
 * sync with the `config.agent[...]` key in src/modules/coordinator/index.ts via
 * the sync test in Task 7.
 */
export const COORDINATOR_AGENT_NAME = "Perun - Coordinator"

/** The agent a session runs under, from its first user message. Undefined if unknown. Never throws. */
export async function getSessionAgent(sessionID: string, client: Client): Promise<string | undefined> {
  try {
    const res = await client.session.messages({ path: { id: sessionID } })
    const msgs = res.data ?? []
    const firstUser = msgs.find((m) => m.info?.role === "user")?.info as { agent?: string } | undefined
    return firstUser?.agent
  } catch {
    return undefined
  }
}

/**
 * Module-level cache of resolved session→agent identities, keyed by sessionID.
 *
 * The agent identity for a session is immutable once resolvable, so it is safe to
 * cache and serve forever. This avoids re-fetching the entire transcript via
 * `client.session.messages` on every bash invocation (the gate) and once per turn
 * (the skill-registry transform).
 */
const sessionAgentCache = new Map<string, string>()

/**
 * Memoized variant of {@link getSessionAgent}, shared by all consumers (the bash gate
 * and the skill-registry transform) so the underlying transcript fetch happens at most
 * once per session.
 *
 * IMPORTANT: only RESOLVED (non-undefined) identities are cached. On the coordinator's
 * very first turn `getSessionAgent` may be unresolvable (messages not yet queryable);
 * caching that miss would freeze the turn-1 unresolved window and the identity could
 * never resolve later. So a miss is never cached and a subsequent call re-attempts.
 */
export async function getSessionAgentCached(sessionID: string, client: Client): Promise<string | undefined> {
  const cached = sessionAgentCache.get(sessionID)
  if (cached !== undefined) return cached

  const agent = await getSessionAgent(sessionID, client)
  if (agent !== undefined) sessionAgentCache.set(sessionID, agent)
  return agent
}

/**
 * True only when the session is positively identified as the coordinator.
 *
 * Resolves identity through the memoized {@link getSessionAgentCached}, so the shared
 * production call sites (the per-bash-call gate and the per-turn skill-registry
 * transform) can route through this predicate without reintroducing a full-transcript
 * fetch on every invocation.
 */
export async function isCoordinatorSession(sessionID: string, client: Client): Promise<boolean> {
  return (await getSessionAgentCached(sessionID, client)) === COORDINATOR_AGENT_NAME
}
