import { afterEach, describe, expect, it, vi } from "vitest"
import type { Agent, AssistantMessage, Message } from "@opencode-ai/sdk"
import {
  AGENT_REGISTRY_TTL_MS,
  createSDKSpecialist,
  loadAgentRegistry,
  toPollerMessage,
  type SDKClient,
} from "../../../src/modules/coordinator/sdk-specialist.js"

/**
 * Fake `OpencodeClient` recorder — keeps a permanent transcript of every call
 * argument as a plain array. We deliberately avoid `vi.fn` / spies: the project
 * convention is "fakes over mocks" so assertions read against real data rather
 * than mock-machinery affordances.
 *
 * Only the four methods exercised by the SDK adapter are implemented. The
 * shape is cast through `unknown` to `SDKClient` because the real client has
 * a much wider surface than the adapter touches.
 */
interface FakeClient {
  client: SDKClient
  calls: {
    sessionCreate: Array<Record<string, unknown>>
    sessionPrompt: Array<Record<string, unknown>>
    sessionMessages: Array<Record<string, unknown>>
    sessionAbort: Array<Record<string, unknown>>
    appAgents: Array<Record<string, unknown> | undefined>
  }
}

interface FakeClientConfig {
  createResponses?: Array<{ data?: { id?: string } | undefined }>
  promptResponse?: { data?: unknown }
  messagesResponses?: Record<string, { data?: Array<{ info: Message; parts: Array<{ type: string; text?: string }> }> }>
  agentsResponse?: { data?: Agent[] } | Error
}

function makeFakeClient(config: FakeClientConfig = {}): FakeClient {
  const calls: FakeClient["calls"] = {
    sessionCreate: [],
    sessionPrompt: [],
    sessionMessages: [],
    sessionAbort: [],
    appAgents: [],
  }

  let createIndex = 0

  const fake = {
    session: {
      async create(options: Record<string, unknown>) {
        calls.sessionCreate.push(options)
        const response = config.createResponses?.[createIndex] ?? { data: { id: "default-session-id" } }
        createIndex += 1
        return response
      },
      async prompt(options: Record<string, unknown>) {
        calls.sessionPrompt.push(options)
        return config.promptResponse ?? { data: {} }
      },
      async messages(options: { path: { id: string } } & Record<string, unknown>) {
        calls.sessionMessages.push(options)
        const id = options.path.id
        return config.messagesResponses?.[id] ?? { data: [] }
      },
      async abort(options: { path: { id: string } } & Record<string, unknown>) {
        calls.sessionAbort.push(options)
        return { data: true }
      },
    },
    app: {
      async agents(options?: Record<string, unknown>) {
        calls.appAgents.push(options)
        if (config.agentsResponse instanceof Error) {
          throw config.agentsResponse
        }
        return config.agentsResponse ?? { data: [] }
      },
    },
  }

  return {
    client: fake as unknown as SDKClient,
    calls,
  }
}

function makeAssistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "msg-1",
    sessionID: "sess-1",
    role: "assistant",
    time: { created: 1700000000 },
    parentID: "parent-1",
    modelID: "model-1",
    providerID: "provider-1",
    mode: "default",
    path: { cwd: "/tmp", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    ...overrides,
  }
}

function makeAgent(overrides: Partial<Agent> & Pick<Agent, "name" | "mode">): Agent {
  return {
    description: undefined,
    builtIn: false,
    permission: {
      edit: "ask",
      bash: {},
    },
    tools: {},
    options: {},
    ...overrides,
  }
}

describe("createSDKSpecialist.startTask", () => {
  it("creates a child session with parentID/title, then prompts with agent + text part, returns the created session id", async () => {
    const fake = makeFakeClient({
      createResponses: [{ data: { id: "sess-child-1" } }],
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const returnedId = await specialist.startTask("qa-fe-tester", "run the smoke tests")

    expect(returnedId).toBe("sess-child-1")

    // session.create must be invoked with exactly { body: { parentID, title } }.
    expect(fake.calls.sessionCreate).toHaveLength(1)
    expect(fake.calls.sessionCreate[0]).toEqual({
      body: {
        parentID: "parent-session-42",
        title: "[perun] dispatch to qa-fe-tester",
      },
    })

    // session.prompt must use the freshly-created id and bind the target agent.
    expect(fake.calls.sessionPrompt).toHaveLength(1)
    expect(fake.calls.sessionPrompt[0]).toEqual({
      path: { id: "sess-child-1" },
      body: {
        agent: "qa-fe-tester",
        parts: [{ type: "text", text: "run the smoke tests" }],
      },
    })
  })

  it("throws when session.create returns no session id and does not call session.prompt", async () => {
    const fake = makeFakeClient({
      createResponses: [{ data: { id: "" } }],
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.startTask("qa-be-tester", "ignored")).rejects.toThrow(
      "createSession returned no session id for agent qa-be-tester",
    )

    expect(fake.calls.sessionPrompt).toHaveLength(0)
  })

  it("throws when session.create returns no data at all", async () => {
    const fake = makeFakeClient({
      createResponses: [{ data: undefined }],
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.startTask("qa-fe-tester", "noop")).rejects.toThrow(
      "createSession returned no session id for agent qa-fe-tester",
    )

    expect(fake.calls.sessionPrompt).toHaveLength(0)
  })
})

describe("createSDKSpecialist.fetchMessages", () => {
  it("calls session.messages with { path: { id } } and projects to only the LAST message", async () => {
    const fake = makeFakeClient({
      messagesResponses: {
        "sess-child-1": {
          data: [
            {
              info: makeAssistant({ finish: undefined }),
              parts: [{ type: "text", text: "thinking…" }],
            },
            {
              info: makeAssistant({ finish: "end_turn" }),
              parts: [
                { type: "text", text: "final " },
                { type: "tool", text: "ignored-tool-output" },
                { type: "text", text: "answer" },
              ],
            },
          ],
        },
      },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const messages = await specialist.fetchMessages("sess-child-1")

    expect(fake.calls.sessionMessages).toHaveLength(1)
    expect(fake.calls.sessionMessages[0]).toEqual({ path: { id: "sess-child-1" } })

    // The adapter must project to `[last]` only — `pollUntilIdle` inspects
    // `messages[last]` exclusively, and holding the full transcript
    // (~300 polls per 5-minute task) is unbounded by `maxBytes`. Returning a
    // singleton bounds per-poll memory to O(1) entries.
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(
      toPollerMessage({
        info: makeAssistant({ finish: "end_turn" }),
        parts: [
          { type: "text", text: "final " },
          { type: "tool", text: "ignored-tool-output" },
          { type: "text", text: "answer" },
        ],
      }),
    )
    expect(messages[0]?.content).toBe("final answer")
    expect(messages[0]?.finish_reason).toBe("end_turn")
  })

  it("projects a single-message transcript to that single entry", async () => {
    // Single-message responses must still round-trip via `toPollerMessage`
    // — the projection is `[last]`, which for length-1 lists is the only
    // entry. Pins the boundary case alongside the multi-message case above.
    const fake = makeFakeClient({
      messagesResponses: {
        "sess-single": {
          data: [
            {
              info: makeAssistant({ finish: "end_turn" }),
              parts: [{ type: "text", text: "sole answer" }],
            },
          ],
        },
      },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const messages = await specialist.fetchMessages("sess-single")

    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(
      toPollerMessage({
        info: makeAssistant({ finish: "end_turn" }),
        parts: [{ type: "text", text: "sole answer" }],
      }),
    )
  })

  it("returns an empty list when SDK returns no data", async () => {
    const fake = makeFakeClient({
      messagesResponses: {
        "sess-empty": { data: undefined },
      },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const messages = await specialist.fetchMessages("sess-empty")

    expect(messages).toEqual([])
    expect(fake.calls.sessionMessages[0]).toEqual({ path: { id: "sess-empty" } })
  })
})

describe("createSDKSpecialist.abortTask", () => {
  it("calls client.session.abort with { path: { id } } for the given session id", async () => {
    const fake = makeFakeClient()
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await specialist.abortTask("sess-child-1")

    expect(fake.calls.sessionAbort).toHaveLength(1)
    expect(fake.calls.sessionAbort[0]).toEqual({ path: { id: "sess-child-1" } })
  })
})

describe("loadAgentRegistry", () => {
  it("calls client.app.agents() and builds a registry keyed by agent.name, preserving SDK mode", async () => {
    const fake = makeFakeClient({
      agentsResponse: {
        data: [
          makeAgent({ name: "qa-fe-tester", mode: "subagent" }),
          makeAgent({ name: "perun", mode: "primary" }),
          makeAgent({ name: "ambient", mode: "all" }),
        ],
      },
    })

    const registry = await loadAgentRegistry(fake.client)

    expect(fake.calls.appAgents).toHaveLength(1)
    expect(registry).toEqual({
      "qa-fe-tester": { mode: "subagent" },
      perun: { mode: "primary" },
      ambient: { mode: "all" },
    })
  })

  it("skips agents with an empty name", async () => {
    const fake = makeFakeClient({
      agentsResponse: {
        data: [
          makeAgent({ name: "", mode: "subagent" }),
          makeAgent({ name: "qa-be-tester", mode: "subagent" }),
        ],
      },
    })

    const registry = await loadAgentRegistry(fake.client)

    expect(registry).toEqual({ "qa-be-tester": { mode: "subagent" } })
  })

  it("returns an empty registry when SDK returns no agent data", async () => {
    const fake = makeFakeClient({
      agentsResponse: { data: undefined },
    })

    const registry = await loadAgentRegistry(fake.client)

    expect(registry).toEqual({})
  })

  it("wraps SDK errors in a clear coordinator error", async () => {
    const fake = makeFakeClient({
      agentsResponse: new Error("HTTP 503 from /app/agents"),
    })

    await expect(loadAgentRegistry(fake.client)).rejects.toThrow(
      "dispatch_parallel: failed to load agent registry from SDK: HTTP 503 from /app/agents",
    )
  })

  it("wraps non-Error throwables in the same coordinator error envelope", async () => {
    // Some HTTP layers throw plain strings; loadAgentRegistry must still
    // produce a deterministic, well-prefixed error message.
    const fake = makeFakeClient()
    const clientWithThrowingAgents = {
      ...fake.client,
      app: {
        async agents() {
          throw "boom"
        },
      },
    } as unknown as SDKClient

    await expect(loadAgentRegistry(clientWithThrowingAgents)).rejects.toThrow(
      "dispatch_parallel: failed to load agent registry from SDK: boom",
    )
  })
})

/**
 * Registry cache: `loadAgentRegistry` is called fresh on every `dispatch_parallel`
 * invocation, but the agent inventory only changes on plugin reload. Caching it
 * per-client with a short TTL eliminates ~50–150ms (one HTTP round-trip) from
 * every dispatch without introducing staleness in practice.
 *
 * Pinned behaviours:
 *   - Per-client scope (WeakMap-keyed) — two clients have independent caches.
 *   - TTL: `AGENT_REGISTRY_TTL_MS` after which a fresh fetch is performed.
 *   - Concurrent first-calls dedupe into a single HTTP request.
 *   - Failed fetches are NOT cached — the next call retries.
 */
describe("loadAgentRegistry — caching", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("caches the registry within the TTL and serves subsequent calls from memory", async () => {
    const fake = makeFakeClient({
      agentsResponse: { data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })] },
    })

    const first = await loadAgentRegistry(fake.client)
    const second = await loadAgentRegistry(fake.client)

    expect(fake.calls.appAgents).toHaveLength(1)
    expect(first).toEqual({ "qa-fe-tester": { mode: "subagent" } })
    expect(second).toEqual(first)
  })

  it("re-fetches after the TTL expires", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-19T10:00:00Z"))

    const fake = makeFakeClient({
      agentsResponse: { data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })] },
    })

    await loadAgentRegistry(fake.client)
    vi.setSystemTime(new Date(Date.now() + AGENT_REGISTRY_TTL_MS + 1))
    await loadAgentRegistry(fake.client)

    expect(fake.calls.appAgents).toHaveLength(2)
  })

  it("deduplicates concurrent first-calls into a single HTTP request", async () => {
    const fake = makeFakeClient({
      agentsResponse: { data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })] },
    })

    const [a, b] = await Promise.all([
      loadAgentRegistry(fake.client),
      loadAgentRegistry(fake.client),
    ])

    expect(fake.calls.appAgents).toHaveLength(1)
    expect(a).toEqual(b)
  })

  it("does not cache failures — the next call retries the fetch", async () => {
    // Custom fake: first `app.agents()` call rejects, the second succeeds.
    // Mirrors a transient HTTP failure where caching would otherwise pin the
    // dispatch in a permanently-broken state.
    const calls: Array<undefined> = []
    let invocation = 0
    const client = {
      app: {
        async agents(): Promise<{ data: Agent[] }> {
          calls.push(undefined)
          invocation += 1
          if (invocation === 1) throw new Error("transient HTTP 503")
          return { data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })] }
        },
      },
    } as unknown as SDKClient

    await expect(loadAgentRegistry(client)).rejects.toThrow("transient HTTP 503")
    const recovered = await loadAgentRegistry(client)

    expect(calls).toHaveLength(2)
    expect(recovered).toEqual({ "qa-fe-tester": { mode: "subagent" } })
  })

  it("caches are scoped per client — two clients fetch independently", async () => {
    const fakeA = makeFakeClient({
      agentsResponse: { data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })] },
    })
    const fakeB = makeFakeClient({
      agentsResponse: { data: [makeAgent({ name: "qa-be-tester", mode: "subagent" })] },
    })

    const a = await loadAgentRegistry(fakeA.client)
    const b = await loadAgentRegistry(fakeB.client)

    expect(fakeA.calls.appAgents).toHaveLength(1)
    expect(fakeB.calls.appAgents).toHaveLength(1)
    expect(a).toEqual({ "qa-fe-tester": { mode: "subagent" } })
    expect(b).toEqual({ "qa-be-tester": { mode: "subagent" } })
  })
})
