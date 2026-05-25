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

describe("BindingsStore — caps", () => {
  let store: BindingsStore
  beforeEach(() => { store = new BindingsStore() })

  it("rejects 33rd write to same parent", () => {
    for (let i = 0; i < 32; i++) {
      const r = store.writeBinding("p1", `QA_BIND_X${i}`, "v", "plain", "minted-recipe")
      expect(r.status).toBe("ok")
    }
    const r33 = store.writeBinding("p1", "QA_BIND_OVERFLOW", "v", "plain", "minted-recipe")
    expect(r33.status).toBe("error")
    if (r33.status === "error") {
      expect(r33.reason).toMatch(/cap|limit/i)
    }
  })

  it("global cap blocks 257th entry across many parents", () => {
    // 256 entries spread across 8 parents (32 each = at-cap).
    for (let p = 0; p < 8; p++) {
      for (let i = 0; i < 32; i++) {
        store.writeBinding(`p${p}`, `QA_BIND_X${i}`, "v", "plain", "minted-recipe")
      }
    }
    // New parent's first write fails — global cap reached, nothing expired to evict.
    const r = store.writeBinding("p99", "QA_BIND_NEW", "v", "plain", "minted-recipe")
    expect(r.status).toBe("error")
    if (r.status === "error") {
      expect(r.reason).toMatch(/global|cap|limit/i)
    }
  })
})

describe("BindingsStore — TTL sweep + clearParent", () => {
  let store: BindingsStore
  beforeEach(() => { store = new BindingsStore() })

  it("sweep purges entries past TTL", () => {
    store.writeBinding("p1", "QA_BIND_X", "v", "plain", "minted-recipe")
    const created = store.getBinding("p1", "QA_BIND_X")!.createdAt
    // Sweep at T = created + ttl + 1
    const purged = store.sweepExpired(created + 1001, 1000)
    expect(purged).toBe(1)
    expect(store.getBinding("p1", "QA_BIND_X")).toBeUndefined()
  })

  it("sweep skips pinned entries", () => {
    store.writeBinding("p1", "QA_BIND_X", "v", "plain", "minted-recipe")
    const snap = store.pinSnapshot("p1")
    const created = store.getBinding("p1", "QA_BIND_X")!.createdAt
    const purged = store.sweepExpired(created + 9999, 1000)
    expect(purged).toBe(0)
    expect(store.getBinding("p1", "QA_BIND_X")).toBeDefined()
    store.releaseSnapshot(snap.id)
  })

  it("sweep does NOT purge entries within TTL window", () => {
    store.writeBinding("p1", "QA_BIND_X", "v", "plain", "minted-recipe")
    const created = store.getBinding("p1", "QA_BIND_X")!.createdAt
    const purged = store.sweepExpired(created + 500, 1000)
    expect(purged).toBe(0)
  })

  it("clearParent purges all bindings for that parent", () => {
    store.writeBinding("p1", "QA_BIND_X", "v", "plain", "minted-recipe")
    store.writeBinding("p1", "QA_BIND_Y", "v", "plain", "minted-recipe")
    store.writeBinding("p2", "QA_BIND_Z", "v", "plain", "minted-recipe")
    const purged = store.clearParent("p1")
    expect(purged).toBe(2)
    expect(store.getBinding("p1", "QA_BIND_X")).toBeUndefined()
    expect(store.getBinding("p2", "QA_BIND_Z")).toBeDefined()
  })

  it("clearParent decrements global count so new parent can write", () => {
    // Fill near cap.
    for (let p = 0; p < 7; p++) {
      for (let i = 0; i < 32; i++) {
        store.writeBinding(`p${p}`, `QA_BIND_X${i}`, "v", "plain", "minted-recipe")
      }
    }
    // 7*32 = 224. Add 32 more for p7 → 256 (at cap).
    for (let i = 0; i < 32; i++) {
      store.writeBinding("p7", `QA_BIND_X${i}`, "v", "plain", "minted-recipe")
    }
    // Refused at cap.
    expect(store.writeBinding("p99", "QA_BIND_NEW", "v", "plain", "minted-recipe").status).toBe("error")
    // Clear one parent's 32 — now room.
    expect(store.clearParent("p0")).toBe(32)
    expect(store.writeBinding("p99", "QA_BIND_NEW", "v", "plain", "minted-recipe").status).toBe("ok")
  })
})
