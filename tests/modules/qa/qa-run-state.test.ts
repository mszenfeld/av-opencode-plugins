import { describe, it, expect, beforeEach } from "vitest"
import { QaRunState } from "../../../src/modules/qa/qa-run-state.js"
import type { ParsedBinding } from "../../../src/modules/qa/binding-parser.js"

const fakeBinding: ParsedBinding = {
  name: "QA_BIND_TOKEN", type: "secret", description: "test",
  inputs: ["X"], egress: "$X", recipe: "curl \"$X\""
}

describe("QaRunState", () => {
  let state: QaRunState
  beforeEach(() => { state = new QaRunState() })

  it("returns undefined when parent not initialized", () => {
    expect(state.getBindings("p1")).toBeUndefined()
    expect(state.getDialogRound("p1")).toBe(0)
    expect(state.getRecipeAttempts("p1", "QA_BIND_TOKEN")).toBe(0)
  })

  it("storePlan + getBindings round-trip", () => {
    state.storePlan("p1", [fakeBinding])
    const result = state.getBindings("p1")
    expect(result).toHaveLength(1)
    expect(result?.[0]?.name).toBe("QA_BIND_TOKEN")
  })

  it("increment + read dialog round", () => {
    expect(state.incrementDialogRound("p1")).toBe(1)
    expect(state.incrementDialogRound("p1")).toBe(2)
    expect(state.getDialogRound("p1")).toBe(2)
  })

  it("increment + read per-binding recipe attempts", () => {
    expect(state.incrementRecipeAttempt("p1", "QA_BIND_TOKEN")).toBe(1)
    expect(state.incrementRecipeAttempt("p1", "QA_BIND_TOKEN")).toBe(2)
    expect(state.getRecipeAttempts("p1", "QA_BIND_TOKEN")).toBe(2)
    expect(state.getRecipeAttempts("p1", "OTHER")).toBe(0)
  })

  it("clearRun removes all state for a parent", () => {
    state.storePlan("p1", [fakeBinding])
    state.incrementDialogRound("p1")
    state.incrementRecipeAttempt("p1", "QA_BIND_TOKEN")
    state.clearRun("p1")
    expect(state.getBindings("p1")).toBeUndefined()
    expect(state.getDialogRound("p1")).toBe(0)
    expect(state.getRecipeAttempts("p1", "QA_BIND_TOKEN")).toBe(0)
  })

  describe("dialog round on-first-input semantics", () => {
    it("increments only once per round, regardless of how many pairs land", () => {
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(1)
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(1)
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(1)
      expect(state.getDialogRound("p1")).toBe(1)
    })

    it("re-arms after endDialogRound", () => {
      state.incrementDialogRoundOnFirstInput("p1") // round 1
      state.endDialogRound("p1")
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(2)
      state.endDialogRound("p1")
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(3)
    })

    it("creates a fresh record when called before storePlan", () => {
      expect(state.incrementDialogRoundOnFirstInput("never-planned")).toBe(1)
      // No plan was stored, so `getBindings` returns an empty bindings
      // array (the freshly-materialised record's default). It must not be
      // an opaque sentinel — Perun-style callers iterate it directly.
      expect(state.getBindings("never-planned")).toEqual([])
    })

    it("endDialogRound is a no-op when nothing in progress", () => {
      // Should not throw and should not create a record.
      state.endDialogRound("p1")
      expect(state.getDialogRound("p1")).toBe(0)
    })

    it("clearRun resets the dialog round counter and in-progress flag", () => {
      state.incrementDialogRoundOnFirstInput("p1")
      state.clearRun("p1")
      expect(state.getDialogRound("p1")).toBe(0)
      // Next call starts at round 1 again.
      expect(state.incrementDialogRoundOnFirstInput("p1")).toBe(1)
    })
  })
})
