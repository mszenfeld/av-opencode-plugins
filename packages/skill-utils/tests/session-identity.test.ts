import { describe, expect, it } from "vitest"
import {
  COORDINATOR_AGENT_NAME,
  getSessionAgent,
  getSessionParentID,
  isCoordinatorSession,
} from "../src/session-identity.js"

// Minimal fake of the bits of the OpenCode client the resolver touches.
function fakeClient(opts: {
  parentID?: string
  agent?: string
  throwOn?: "get" | "messages"
}) {
  return {
    session: {
      get: async () => {
        if (opts.throwOn === "get") throw new Error("boom")
        return { data: { id: "s1", parentID: opts.parentID } }
      },
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

describe("getSessionParentID", () => {
  it("returns the parentID for a dispatched child", async () => {
    expect(await getSessionParentID("s1", fakeClient({ parentID: "parent" }))).toBe("parent")
  })
  it("returns undefined for a parentless session", async () => {
    expect(await getSessionParentID("s1", fakeClient({}))).toBeUndefined()
  })
  it("returns undefined (not throw) on client error", async () => {
    expect(await getSessionParentID("s1", fakeClient({ throwOn: "get" }))).toBeUndefined()
  })
})

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
  it("true when the resolved agent is the coordinator", async () => {
    expect(await isCoordinatorSession("s1", fakeClient({ agent: COORDINATOR_AGENT_NAME }))).toBe(true)
  })
  it("false for a dispatched specialist", async () => {
    expect(await isCoordinatorSession("s1", fakeClient({ agent: "zmora-be", parentID: "p" }))).toBe(false)
  })
})
