import type { PluginInput } from "@opencode-ai/plugin"

type Client = PluginInput["client"]

/**
 * The agent identifier the coordinator (Perun) session runs under.
 * Pinned in Task 1b to the observed `UserMessage.info.agent` value and kept in
 * sync with the `config.agent[...]` key in src/modules/coordinator/index.ts via
 * the sync test in Task 7.
 */
export const COORDINATOR_AGENT_NAME = "Perun - Coordinator"

/** Parent session id, or undefined for a parentless (top/primary) session. Never throws. */
export async function getSessionParentID(sessionID: string, client: Client): Promise<string | undefined> {
  try {
    const res = await client.session.get({ path: { id: sessionID } })
    return res.data?.parentID
  } catch {
    return undefined
  }
}

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

/** True only when the session is positively identified as the coordinator. */
export async function isCoordinatorSession(sessionID: string, client: Client): Promise<boolean> {
  return (await getSessionAgent(sessionID, client)) === COORDINATOR_AGENT_NAME
}
