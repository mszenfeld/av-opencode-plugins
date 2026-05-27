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

  it("rejects credential / cloud / secret-manager prefixes from user-paste (SEC-007)", () => {
    // One representative per denylisted prefix — guards against accidental
    // removal/typo of any prefix in the list.
    const names = [
      // Cloud providers
      "AWS_SECRET_ACCESS_KEY",
      "GCP_PROJECT",
      "AZURE_CLIENT_SECRET",
      // VCS / hosting
      "GIT_AUTHOR_NAME",
      "GIT_SSH_COMMAND",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GITLAB_TOKEN",
      // LLM / agent platforms
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENCODE_API_KEY",
      // Databases / data stores
      "DATABASE_URL",
      "REDIS_URL",
      "MONGO_URL",
      "POSTGRES_PASSWORD",
      // PaaS / BaaS
      "SUPABASE_SERVICE_ROLE_KEY",
      "FIREBASE_TOKEN",
      "VERCEL_TOKEN",
      // Secret managers
      "OP_SESSION_MY",
      "VAULT_TOKEN",
      "DOPPLER_TOKEN",
      // Kubernetes
      "K8S_NAMESPACE",
      "KUBECONFIG",
      "KUBECTL_CONTEXT",
    ]
    for (const name of names) {
      const result = store.writeBinding("perun1", name, "x", "plain", "user-paste")
      expect(result.status, `expected reject for ${name}`).toBe("error")
      if (result.status === "error") {
        expect(result.reason).toContain("denylist")
      }
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

  it("clearParent skips pinned entries (SEC-006)", () => {
    // Two entries for the same parent: one will be pinned via snapshot, one will not.
    store.writeBinding("p1", "QA_BIND_PINNED", "vpin", "plain", "minted-recipe")
    store.writeBinding("p1", "QA_BIND_LOOSE", "vloose", "plain", "minted-recipe")
    const snap = store.pinSnapshot("p1") // pins both names captured at snapshot time
    // Add another binding AFTER snapshot (not pinned).
    store.writeBinding("p1", "QA_BIND_AFTER", "vafter", "plain", "minted-recipe")

    const purged = store.clearParent("p1")
    // Two pinned entries (PINNED + LOOSE) survive; AFTER is purged.
    expect(purged).toBe(1)
    expect(store.getBinding("p1", "QA_BIND_PINNED")).toBeDefined()
    expect(store.getBinding("p1", "QA_BIND_LOOSE")).toBeDefined()
    expect(store.getBinding("p1", "QA_BIND_AFTER")).toBeUndefined()
    // Pin counts must remain intact so release still works.
    expect(store.isPinned("p1", "QA_BIND_PINNED")).toBe(true)
    expect(store.isPinned("p1", "QA_BIND_LOOSE")).toBe(true)

    // Releasing the snapshot drops pin counts; a subsequent clearParent removes survivors.
    store.releaseSnapshot(snap.id)
    expect(store.isPinned("p1", "QA_BIND_PINNED")).toBe(false)
    expect(store.clearParent("p1")).toBe(2)
    expect(store.getBinding("p1", "QA_BIND_PINNED")).toBeUndefined()
    expect(store.getBinding("p1", "QA_BIND_LOOSE")).toBeUndefined()
  })

  it("clearParent global count stays consistent when pinned entries survive", () => {
    // Fill cap minus 1.
    for (let p = 0; p < 7; p++) {
      for (let i = 0; i < 32; i++) {
        store.writeBinding(`p${p}`, `QA_BIND_X${i}`, "v", "plain", "minted-recipe")
      }
    }
    // Add 31 to p7 (255 total).
    for (let i = 0; i < 31; i++) {
      store.writeBinding("p7", `QA_BIND_X${i}`, "v", "plain", "minted-recipe")
    }
    // Pin a snapshot on p7 (31 entries pinned).
    const snap = store.pinSnapshot("p7")
    // Add one more on p7 — total 256, at cap.
    store.writeBinding("p7", "QA_BIND_LAST", "v", "plain", "minted-recipe")
    // Now clearParent("p7") — only the unpinned QA_BIND_LAST should be purged.
    expect(store.clearParent("p7")).toBe(1)
    // p7 still has 31 pinned entries; cap should reflect 255 used; one slot free.
    expect(store.writeBinding("p99", "QA_BIND_NEW", "v", "plain", "minted-recipe").status).toBe("ok")
    // Cap reached again at 256 — next write should fail.
    expect(store.writeBinding("p99", "QA_BIND_NEW2", "v", "plain", "minted-recipe").status).toBe("error")
    store.releaseSnapshot(snap.id)
  })
})
