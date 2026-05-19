import type {
  Agent,
  AssistantMessage,
  createOpencodeClient,
  Message,
} from "@opencode-ai/sdk"
import type { DispatchSpecialist, AgentInfo } from "./dispatch.js"
import type { PollerMessage } from "./poller.js"

/**
 * SDK adapter layer: bridges the strongly-typed OpenCode SDK client into the
 * plain `DispatchSpecialist` / `AgentInfo` shapes that `dispatchParallel`
 * consumes. Extracting this here keeps `index.ts` thin and — crucially — makes
 * the adapter independently unit-testable with a fake `OpencodeClient` (see
 * `tests/sdk-specialist.test.ts`).
 */
export type SDKClient = ReturnType<typeof createOpencodeClient>

export function createSDKSpecialist(
  client: SDKClient,
  parentSessionID: string,
): DispatchSpecialist {
  return {
    async startTask(agentName: string, prompt: string): Promise<string> {
      // OpenCode's session.create body accepts only parentID/title — the target
      // agent is bound on the subsequent session.prompt call. Two-step is required.
      const created = await client.session.create({
        body: {
          parentID: parentSessionID,
          title: `[perun] dispatch to ${agentName}`,
        },
      })
      const sessionId: string = created.data?.id ?? ""
      if (sessionId.length === 0) {
        throw new Error(`createSession returned no session id for agent ${agentName}`)
      }

      await client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: agentName,
          parts: [{ type: "text", text: prompt }],
        },
      })

      return sessionId
    },
    async fetchMessages(sessionId: string): Promise<PollerMessage[]> {
      const result = await client.session.messages({ path: { id: sessionId } })
      const list = result.data ?? []
      return list.map(toPollerMessage)
    },
    async abortTask(sessionId: string): Promise<void> {
      // POST /session/{id}/abort — server-side cleanup of an in-flight child
      // session when the parent's abort signal fires. Errors are surfaced to
      // the caller but `dispatch.ts` already swallows them on the abort path,
      // so this remains best-effort end to end (COMPOSITE-3 / ARCH-001).
      await client.session.abort({ path: { id: sessionId } })
    },
  }
}

export function toPollerMessage(raw: {
  info: Message
  parts: Array<{ type: string; text?: string }>
}): PollerMessage {
  const role: string = raw.info.role
  const text = raw.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")
  const finishReason: string | null =
    raw.info.role === "assistant" && typeof (raw.info as AssistantMessage).finish === "string"
      ? (raw.info as AssistantMessage).finish ?? null
      : null
  return {
    role,
    content: text,
    finish_reason: finishReason,
  }
}

export async function loadAgentRegistry(
  client: SDKClient,
): Promise<Record<string, AgentInfo>> {
  let list: Agent[]
  try {
    const result = await client.app.agents()
    list = result.data ?? []
  } catch (err) {
    throw new Error(
      `dispatch_parallel: failed to load agent registry from SDK: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  const registry: Record<string, AgentInfo> = {}
  for (const agent of list) {
    const name = agent.name
    if (name.length > 0) {
      // Preserve the SDK's three-way mode union ("subagent" | "primary" | "all")
      // — dispatchParallel enforces default-deny against anything other than
      // strict "subagent" to keep anti-recursion guarantees intact.
      registry[name] = { mode: agent.mode }
    }
  }
  return registry
}
