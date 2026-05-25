import { describe, it, expect } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { makeRecordInputHandler } from "../../../src/modules/qa/record-input.js"

function makeContext(sessionID: string) {
  return { sessionID, agent: "Perun - Coordinator" } as const
}

describe("record_input tool handler", () => {
  it("writes a non-QA_BIND_ name as user-paste secret", async () => {
    const store = new BindingsStore()
    const handler = makeRecordInputHandler({
      store,
      resolveParentID: async () => "perun-session",
    })
    const result = await handler({ name: "TEST_USER_EMAIL", value: "foo@bar.com" }, makeContext("perun-session"))
    expect(result.status).toBe("ok")
    expect(store.getBinding("perun-session", "TEST_USER_EMAIL")?.value.unwrap()).toBe("foo@bar.com")
    expect(store.getBinding("perun-session", "TEST_USER_EMAIL")?.source).toBe("user-paste")
    expect(store.getBinding("perun-session", "TEST_USER_EMAIL")?.type).toBe("secret")
  })

  it("rejects a process-control env name", async () => {
    const store = new BindingsStore()
    const handler = makeRecordInputHandler({ store, resolveParentID: async () => "p1" })
    const result = await handler({ name: "PATH", value: "/tmp" }, makeContext("p1"))
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") {
      expect(result.reason).toContain("denylist")
    }
  })

  it("rejects an invalid identifier", async () => {
    const store = new BindingsStore()
    const handler = makeRecordInputHandler({ store, resolveParentID: async () => "p1" })
    const result = await handler({ name: "bad-name", value: "x" }, makeContext("p1"))
    expect(result.status).toBe("rejected")
  })

  it("when parent unresolvable (Perun root session), falls back to using sessionID", async () => {
    const store = new BindingsStore()
    const handler = makeRecordInputHandler({
      store,
      resolveParentID: async () => undefined,
    })
    const result = await handler({ name: "X", value: "y" }, makeContext("perun-session"))
    expect(result.status).toBe("ok")
    expect(store.getBinding("perun-session", "X")).toBeDefined()
  })

  it("duplicate write is silently accepted (existing kept)", async () => {
    const store = new BindingsStore()
    const handler = makeRecordInputHandler({ store, resolveParentID: async () => "p1" })
    await handler({ name: "X", value: "v1" }, makeContext("p1"))
    const r2 = await handler({ name: "X", value: "v2" }, makeContext("p1"))
    expect(r2.status).toBe("ok")
    expect(store.getBinding("p1", "X")?.value.unwrap()).toBe("v1")
  })
})
