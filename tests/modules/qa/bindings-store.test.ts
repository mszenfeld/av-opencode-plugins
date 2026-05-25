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

describe("BindingsStore.writeBinding — validation", () => {
  let store: BindingsStore
  beforeEach(() => { store = new BindingsStore() })

  it("accepts a valid QA_BIND_* name from minted-recipe source", () => {
    const result = store.writeBinding("perun1", "QA_BIND_TOKEN", "eyJ...", "secret", "minted-recipe")
    expect(result).toEqual({ status: "ok" })
    expect(store.getBinding("perun1", "QA_BIND_TOKEN")?.value.unwrap()).toBe("eyJ...")
  })

  it("accepts a non-QA_BIND_ name from user-paste source", () => {
    const result = store.writeBinding("perun1", "TEST_USER_EMAIL", "foo@bar.com", "secret", "user-paste")
    expect(result).toEqual({ status: "ok" })
  })

  it("rejects non-QA_BIND_ name from minted-recipe", () => {
    const result = store.writeBinding("perun1", "PATH", "/tmp", "plain", "minted-recipe")
    expect(result.status).toBe("error")
    if (result.status === "error") expect(result.reason).toContain("QA_BIND_")
  })

  it("rejects process-control env names from user-paste", () => {
    for (const name of ["PATH", "LD_PRELOAD", "NODE_OPTIONS", "BASH_ENV", "HOME", "USER", "AWS_PROFILE", "GIT_SSH_COMMAND"]) {
      const result = store.writeBinding("perun1", name, "x", "plain", "user-paste")
      expect(result.status, `expected reject for ${name}`).toBe("error")
    }
  })

  it("rejects names not matching identifier regex", () => {
    for (const name of ["", "lowercase", "1LEADING_DIGIT", "has-dash", "has space"]) {
      const result = store.writeBinding("perun1", name, "x", "plain", "user-paste")
      expect(result.status, `expected reject for '${name}'`).toBe("error")
    }
  })

  it("rejects value >4KB", () => {
    const big = "x".repeat(4097)
    const result = store.writeBinding("perun1", "QA_BIND_X", big, "plain", "minted-recipe")
    expect(result.status).toBe("error")
    if (result.status === "error") expect(result.reason).toContain("size")
  })

  it("rejects value containing control bytes (non-trailing newline)", () => {
    const result = store.writeBinding("perun1", "QA_BIND_X", "ab\x00cd", "plain", "minted-recipe")
    expect(result.status).toBe("error")
    if (result.status === "error") expect(result.reason).toContain("control")
  })

  it("allows value with trailing newline (trimmed)", () => {
    const result = store.writeBinding("perun1", "QA_BIND_X", "value\n", "plain", "minted-recipe")
    expect(result.status).toBe("ok")
    expect(store.getBinding("perun1", "QA_BIND_X")?.value.unwrap()).toBe("value")
  })

  it("returns duplicate and keeps existing on second write", () => {
    store.writeBinding("perun1", "QA_BIND_X", "v1", "plain", "minted-recipe")
    const result = store.writeBinding("perun1", "QA_BIND_X", "v2", "plain", "minted-recipe")
    expect(result.status).toBe("duplicate")
    expect(store.getBinding("perun1", "QA_BIND_X")?.value.unwrap()).toBe("v1")
  })
})

describe("BindingsStore — snapshot pin/release", () => {
  let store: BindingsStore
  beforeEach(() => { store = new BindingsStore() })

  it("pinSnapshot returns immutable view of current state", () => {
    store.writeBinding("perun1", "QA_BIND_X", "v1", "plain", "minted-recipe")
    const snap = store.pinSnapshot("perun1")
    // Mutate live map
    store.writeBinding("perun1", "QA_BIND_Y", "v2", "plain", "minted-recipe")
    // Snapshot still sees only X
    expect(Array.from(snap.entries.keys())).toEqual(["QA_BIND_X"])
    store.releaseSnapshot(snap.id)
  })

  it("pinned entries are reported via isPinned", () => {
    store.writeBinding("perun1", "QA_BIND_X", "v1", "plain", "minted-recipe")
    const snap = store.pinSnapshot("perun1")
    expect(store.isPinned("perun1", "QA_BIND_X")).toBe(true)
    store.releaseSnapshot(snap.id)
    expect(store.isPinned("perun1", "QA_BIND_X")).toBe(false)
  })

  it("nested pins are reference-counted", () => {
    store.writeBinding("perun1", "QA_BIND_X", "v1", "plain", "minted-recipe")
    const a = store.pinSnapshot("perun1")
    const b = store.pinSnapshot("perun1")
    store.releaseSnapshot(a.id)
    expect(store.isPinned("perun1", "QA_BIND_X")).toBe(true)
    store.releaseSnapshot(b.id)
    expect(store.isPinned("perun1", "QA_BIND_X")).toBe(false)
  })
})
