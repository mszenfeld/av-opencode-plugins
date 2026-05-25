import { describe, it, expect, beforeEach } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"

describe("BindingsStore — empty state", () => {
  let store: BindingsStore

  beforeEach(() => {
    store = new BindingsStore()
  })

  it("returns empty Map for an unknown parent", () => {
    expect(store.listForParent("nonexistent")).toEqual(new Map())
  })

  it("returns undefined for a missing binding", () => {
    expect(store.getBinding("nonexistent", "QA_BIND_TOKEN")).toBeUndefined()
  })
})
