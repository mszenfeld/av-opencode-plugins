import { describe, expect, it } from "vitest"
import {
  COORDINATOR_AGENT_NAME,
  getSessionAgent,
  getSessionAgentCached,
  isCoordinatorSession,
} from "../src/session-identity.js"

// Minimal fake of the bits of the OpenCode client the resolver touches.
// `parentID` is accepted (some callers pass it to model a dispatched child) but
// the agent resolvers read identity solely from the first user message.
function fakeClient(opts: {
  parentID?: string
  agent?: string
  throwOn?: "messages"
}) {
  return {
    session: {
      messages: async () => {
        if (opts.throwOn === "messages") throw new Error("boom")
        return {
          data: opts.agent
            ? [{ info: { role: "user", agent: opts.agent }, parts: [] }]
            : [],
        }
      },
    },
  } as never
}

describe("getSessionAgent", () => {
  it("returns the first user message's agent", async () => {
    expect(await getSessionAgent("s1", fakeClient({ agent: COORDINATOR_AGENT_NAME }))).toBe(
      COORDINATOR_AGENT_NAME,
    )
  })
  it("returns undefined when no messages yet (turn 1)", async () => {
    expect(await getSessionAgent("s1", fakeClient({}))).toBeUndefined()
  })
  it("returns undefined (not throw) on client error", async () => {
    expect(await getSessionAgent("s1", fakeClient({ throwOn: "messages" }))).toBeUndefined()
  })
})

describe("isCoordinatorSession", () => {
  // Distinct sessionIDs per case: isCoordinatorSession resolves through the memoized
  // getSessionAgentCached, whose cache is module-global and persists across tests.
  it("true when the resolved agent is the coordinator", async () => {
    const sessionID = `coord-${Math.random()}`
    expect(await isCoordinatorSession(sessionID, fakeClient({ agent: COORDINATOR_AGENT_NAME }))).toBe(true)
  })
  it("false for a dispatched specialist", async () => {
    const sessionID = `spec-${Math.random()}`
    expect(await isCoordinatorSession(sessionID, fakeClient({ agent: "zmora-be", parentID: "p" }))).toBe(false)
  })
  it("memoizes via getSessionAgentCached: fetches the transcript once across repeated calls", async () => {
    const { client, state } = countingClient(COORDINATOR_AGENT_NAME)
    const sessionID = `coord-memo-${Math.random()}`

    expect(await isCoordinatorSession(sessionID, client)).toBe(true)
    expect(await isCoordinatorSession(sessionID, client)).toBe(true)
    expect(await isCoordinatorSession(sessionID, client)).toBe(true)
    // Routing the per-bash-call gate through this predicate must NOT re-fetch the
    // full transcript on every call (PERF-001 memoization preserved).
    expect(state.messageCalls).toBe(1)
  })
})

/**
 * Counting fake whose first user message resolves only once `agent` is set.
 * Exposes `messageCalls` so tests can prove the transcript fetch is memoized,
 * and lets a test flip from unresolved → resolved to prove misses are NOT cached.
 */
function countingClient(initialAgent?: string) {
  const state = { agent: initialAgent, messageCalls: 0 }
  const client = {
    session: {
      get: async () => ({ data: { id: "s1", parentID: undefined } }),
      messages: async () => {
        state.messageCalls++
        return {
          data: state.agent
            ? [{ info: { role: "user", agent: state.agent }, parts: [] }]
            : [],
        }
      },
    },
  } as never
  return { client, state }
}

describe("getSessionAgentCached", () => {
  it("fetches a resolved identity once and serves it from cache afterwards", async () => {
    const { client, state } = countingClient(COORDINATOR_AGENT_NAME)
    const sessionID = `resolved-${Math.random()}` // unique key: module-level cache persists across tests

    const first = await getSessionAgentCached(sessionID, client)
    const second = await getSessionAgentCached(sessionID, client)
    const third = await getSessionAgentCached(sessionID, client)

    expect(first).toBe(COORDINATOR_AGENT_NAME)
    expect(second).toBe(COORDINATOR_AGENT_NAME)
    expect(third).toBe(COORDINATOR_AGENT_NAME)
    // The whole transcript is fetched exactly once across N calls.
    expect(state.messageCalls).toBe(1)
  })

  it("does NOT cache an unresolved (undefined) result so a later call can still resolve", async () => {
    const { client, state } = countingClient(undefined) // turn-1 unresolvable window
    const sessionID = `unresolved-${Math.random()}`

    // Turn 1: messages not yet queryable -> undefined, must re-attempt next time.
    expect(await getSessionAgentCached(sessionID, client)).toBeUndefined()
    expect(state.messageCalls).toBe(1)

    // Still undefined: each unresolved call re-fetches (miss not cached).
    expect(await getSessionAgentCached(sessionID, client)).toBeUndefined()
    expect(state.messageCalls).toBe(2)

    // The identity becomes resolvable on a later turn.
    state.agent = COORDINATOR_AGENT_NAME
    expect(await getSessionAgentCached(sessionID, client)).toBe(COORDINATOR_AGENT_NAME)
    expect(state.messageCalls).toBe(3)

    // Now resolved and cached: no further transcript fetches.
    expect(await getSessionAgentCached(sessionID, client)).toBe(COORDINATOR_AGENT_NAME)
    expect(state.messageCalls).toBe(3)
  })
})
