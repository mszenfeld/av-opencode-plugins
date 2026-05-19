import { describe, expect, it } from "vitest"
import type { Agent, AssistantMessage, Message } from "@opencode-ai/sdk"
import {
  createSDKSpecialist,
  loadAgentRegistry,
  toPollerMessage,
  type SDKClient,
} from "../src/sdk-specialist.js"

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
  it("calls session.messages with { path: { id } } and maps each message via toPollerMessage", async () => {
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

    // Each raw message round-trips through toPollerMessage — same logic as the
    // shared mapper, so we compare against its output rather than reproducing
    // the projection inline.
    expect(messages).toEqual([
      toPollerMessage({
        info: makeAssistant({ finish: undefined }),
        parts: [{ type: "text", text: "thinking…" }],
      }),
      toPollerMessage({
        info: makeAssistant({ finish: "end_turn" }),
        parts: [
          { type: "text", text: "final " },
          { type: "tool", text: "ignored-tool-output" },
          { type: "text", text: "answer" },
        ],
      }),
    ])

    expect(messages[1]?.content).toBe("final answer")
    expect(messages[1]?.finish_reason).toBe("end_turn")
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
