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
      // Project to `[last]` here so the poller never holds the full
      // transcript in memory. `pollUntilIdle` only inspects `messages[last]`,
      // so returning a singleton (or empty) list is sufficient for the
      // poller's contract while bounding allocations to O(1) per poll instead
      // of O(transcript-length). Combined with `maxBytes` (which caps the
      // last message's content), this makes `pollUntilIdle.maxBytes` a true
      // per-poll memory bound.
      return list.length === 0 ? [] : [toPollerMessage(list[list.length - 1]!)]
    },
    async abortTask(sessionId: string): Promise<void> {
      // POST /session/{id}/abort — server-side cleanup of an in-flight child
      // session when the parent's abort signal fires. Errors are surfaced to
      // the caller but `dispatch.ts` already swallows them on the abort path,
      // so this remains best-effort end to end.
      await client.session.abort({ path: { id: sessionId } })
    },
  }
}

/**
 * Type guard that narrows `Message` (UserMessage | AssistantMessage) down to
 * `AssistantMessage` via the SDK's discriminated `role` field. Using a guard
 * — instead of `as AssistantMessage` — lets the compiler verify the narrowing
 * is sound, so any future SDK change to the discriminant surfaces as a type
 * error here rather than as a silent runtime cast.
 */
function isAssistant(message: Message): message is AssistantMessage {
  return message.role === "assistant"
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
    isAssistant(raw.info) && typeof raw.info.finish === "string"
      ? raw.info.finish
      : null
  return {
    role,
    content: text,
    finish_reason: finishReason,
  }
}

/**
 * TTL for the agent-registry cache (60 s). The registry only changes when the
 * OpenCode server reloads plugins, which is rare relative to dispatch volume —
 * but we keep a TTL (rather than caching forever) so a hot-reloaded plugin's
 * new agents are picked up within a minute without restarting the coordinator.
 */
export const AGENT_REGISTRY_TTL_MS = 60_000

interface RegistryCacheEntry {
  /**
   * Stored as a Promise (not the resolved value) so concurrent first-calls
   * dedupe into a single HTTP request: the second caller observes the
   * in-flight promise via the cache and awaits it instead of firing again.
   */
  promise: Promise<Record<string, AgentInfo>>
  expiresAt: number
}

/**
 * Per-client cache. WeakMap-keyed so the cache is naturally released when an
 * `SDKClient` goes out of scope — no manual reset hook needed for tests, and
 * no cross-test pollution. Module-scope state survives `loadAgentRegistry`
 * calls within the same client identity, which is exactly the use case.
 */
const registryCache = new WeakMap<SDKClient, RegistryCacheEntry>()

export async function loadAgentRegistry(
  client: SDKClient,
): Promise<Record<string, AgentInfo>> {
  const now = Date.now()
  const cached = registryCache.get(client)
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.promise
  }

  const promise = fetchAgentRegistry(client)
  registryCache.set(client, { promise, expiresAt: now + AGENT_REGISTRY_TTL_MS })

  // Invalidate the cache on failure so transient HTTP errors don't pin the
  // coordinator in a permanently-broken state. Only delete if the entry still
  // points at THIS promise — a later successful refresh may have replaced it.
  // `.catch` here returns a new promise we deliberately discard; the original
  // `promise` rejection still propagates to whoever awaits it below.
  promise.catch(() => {
    if (registryCache.get(client)?.promise === promise) {
      registryCache.delete(client)
    }
  })

  return promise
}

async function fetchAgentRegistry(
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
