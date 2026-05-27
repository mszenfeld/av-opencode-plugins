import { describe, it, expect } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { QaRunState, MAX_DIALOG_ROUNDS } from "../../../src/modules/qa/qa-run-state.js"
import { makeRecordInputHandler } from "../../../src/modules/qa/record-input.js"

function makeContext(sessionID: string) {
  return { sessionID, agent: "Perun - Coordinator" } as const
}

function makeDeps(parentID: string) {
  const store = new BindingsStore()
  const state = new QaRunState()
  const handler = makeRecordInputHandler({
    store,
    state,
    resolveParentID: async () => parentID,
  })
  return { store, state, handler }
}

describe("record_input tool handler", () => {
  it("writes a non-QA_BIND_ name as user-paste secret", async () => {
    const { store, handler } = makeDeps("perun-session")
    const result = await handler({ name: "TEST_USER_EMAIL", value: "foo@bar.com" }, makeContext("perun-session"))
    expect(result.status).toBe("ok")
    expect(store.getBinding("perun-session", "TEST_USER_EMAIL")?.value.unwrap()).toBe("foo@bar.com")
    expect(store.getBinding("perun-session", "TEST_USER_EMAIL")?.source).toBe("user-paste")
    expect(store.getBinding("perun-session", "TEST_USER_EMAIL")?.type).toBe("secret")
  })

  it("rejects a process-control env name", async () => {
    const { handler } = makeDeps("p1")
    const result = await handler({ name: "PATH", value: "/tmp" }, makeContext("p1"))
    expect(result.status).toBe("rejected")
    if (result.status === "rejected") {
      expect(result.reason).toContain("denylist")
    }
  })

  it("rejects an invalid identifier", async () => {
    const { handler } = makeDeps("p1")
    const result = await handler({ name: "bad-name", value: "x" }, makeContext("p1"))
    expect(result.status).toBe("rejected")
  })

  it("when parent unresolvable (Perun root session), falls back to using sessionID", async () => {
    const store = new BindingsStore()
    const state = new QaRunState()
    const handler = makeRecordInputHandler({
      store,
      state,
      resolveParentID: async () => undefined,
    })
    const result = await handler({ name: "X", value: "y" }, makeContext("perun-session"))
    expect(result.status).toBe("ok")
    expect(store.getBinding("perun-session", "X")).toBeDefined()
  })

  it("duplicate write is silently accepted (existing kept)", async () => {
    const { store, state, handler } = makeDeps("p1")
    await handler({ name: "X", value: "v1" }, makeContext("p1"))
    // Simulate round-end before the second write so the second call doesn't
    // bump the dialog counter into a fresh round just to test duplicate semantics.
    state.endDialogRound("p1")
    const r2 = await handler({ name: "X", value: "v2" }, makeContext("p1"))
    expect(r2.status).toBe("ok")
    expect(store.getBinding("p1", "X")?.value.unwrap()).toBe("v1")
  })
})

describe("record_input — dialog round cap", () => {
  it("counts multiple pairs in a single round as ONE round", async () => {
    const { state, handler } = makeDeps("p1")
    await handler({ name: "A", value: "1" }, makeContext("p1"))
    await handler({ name: "B", value: "2" }, makeContext("p1"))
    await handler({ name: "C", value: "3" }, makeContext("p1"))
    expect(state.getDialogRound("p1")).toBe(1)
  })

  it("increments the round counter after endDialogRound is called", async () => {
    const { state, handler } = makeDeps("p1")
    await handler({ name: "A", value: "1" }, makeContext("p1"))
    expect(state.getDialogRound("p1")).toBe(1)
    state.endDialogRound("p1")
    await handler({ name: "B", value: "2" }, makeContext("p1"))
    expect(state.getDialogRound("p1")).toBe(2)
  })

  it(`refuses writes once the round counter exceeds ${MAX_DIALOG_ROUNDS}`, async () => {
    const { store, state, handler } = makeDeps("p1")
    // Drive 3 successful rounds — pretend execute_recipe ends each round
    // between them.
    for (let i = 0; i < MAX_DIALOG_ROUNDS; i++) {
      const ok = await handler({ name: `A${i}`, value: `v${i}` }, makeContext("p1"))
      expect(ok.status).toBe("ok")
      state.endDialogRound("p1")
    }
    expect(state.getDialogRound("p1")).toBe(MAX_DIALOG_ROUNDS)

    // The 4th round must be refused before any binding is written.
    const refused = await handler({ name: "TOO_LATE", value: "x" }, makeContext("p1"))
    expect(refused.status).toBe("rejected")
    if (refused.status === "rejected") {
      expect(refused.reason).toContain("dialog_round_exceeded")
    }
    expect(store.getBinding("p1", "TOO_LATE")).toBeUndefined()
  })

  it("refuses additional pairs within the same over-limit round (counter pre-mutated)", async () => {
    // Mutate the round counter directly so the next record_input call lands
    // on round MAX_DIALOG_ROUNDS+1 — the deterministic bound must hold even
    // if state somehow advances by another code path.
    const { store, state, handler } = makeDeps("p1")
    for (let i = 0; i < MAX_DIALOG_ROUNDS; i++) {
      state.incrementDialogRound("p1")
    }
    // round is now MAX_DIALOG_ROUNDS and roundInProgress is false (set via
    // raw incrementDialogRound which doesn't toggle the flag) — the next
    // record_input opens a new round (MAX_DIALOG_ROUNDS + 1) and must refuse.
    const refused = await handler({ name: "X", value: "y" }, makeContext("p1"))
    expect(refused.status).toBe("rejected")
    if (refused.status === "rejected") {
      expect(refused.reason).toContain("dialog_round_exceeded")
    }
    expect(store.getBinding("p1", "X")).toBeUndefined()
    expect(state.getDialogRound("p1")).toBe(MAX_DIALOG_ROUNDS + 1)
  })
})
