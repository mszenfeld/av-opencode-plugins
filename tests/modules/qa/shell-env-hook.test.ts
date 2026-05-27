import { describe, it, expect, beforeEach } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { SessionAgentRegistry, makeShellEnvHook } from "../../../src/modules/qa/shell-env-hook.js"

describe("SessionAgentRegistry", () => {
  it("set + get round-trip", () => {
    const r = new SessionAgentRegistry()
    r.register("session1", "zmora-be")
    expect(r.lookup("session1")).toBe("zmora-be")
  })
  it("delete removes mapping", () => {
    const r = new SessionAgentRegistry()
    r.register("s", "zmora-be")
    r.unregister("s")
    expect(r.lookup("s")).toBeUndefined()
  })
})

describe("shell.env hook", () => {
  let store: BindingsStore
  let registry: SessionAgentRegistry
  beforeEach(() => {
    store = new BindingsStore()
    registry = new SessionAgentRegistry()
  })

  it("injects bindings for zmora-* agent", async () => {
    store.writeBinding("perun1", "QA_BIND_TOKEN", "eyJ...", "secret", "minted-recipe")
    registry.register("zmora-child", "zmora-be")
    const hook = makeShellEnvHook({
      store, registry,
      resolveParentID: async () => "perun1",
    })
    const env: Record<string, string> = {}
    await hook({ sessionID: "zmora-child", cwd: "/" }, { env })
    expect(env.QA_BIND_TOKEN).toBe("eyJ...")
  })

  it("does NOT inject for non-zmora agent", async () => {
    store.writeBinding("perun1", "QA_BIND_TOKEN", "eyJ...", "secret", "minted-recipe")
    registry.register("other-child", "Perun - Coordinator")
    const hook = makeShellEnvHook({
      store, registry,
      resolveParentID: async () => "perun1",
    })
    const env: Record<string, string> = {}
    await hook({ sessionID: "other-child", cwd: "/" }, { env })
    expect(env.QA_BIND_TOKEN).toBeUndefined()
  })

  it("does NOT inject when session not registered", async () => {
    store.writeBinding("perun1", "QA_BIND_TOKEN", "eyJ...", "secret", "minted-recipe")
    const hook = makeShellEnvHook({
      store, registry,
      resolveParentID: async () => "perun1",
    })
    const env: Record<string, string> = {}
    await hook({ sessionID: "unknown", cwd: "/" }, { env })
    expect(env.QA_BIND_TOKEN).toBeUndefined()
  })

  it("inverted override: does not overwrite existing env key", async () => {
    store.writeBinding("perun1", "MY_VAR", "from-binding", "plain", "user-paste")
    registry.register("zmora-child", "zmora-be")
    const hook = makeShellEnvHook({
      store, registry,
      resolveParentID: async () => "perun1",
    })
    const env: Record<string, string> = { MY_VAR: "from-shell" }
    await hook({ sessionID: "zmora-child", cwd: "/" }, { env })
    expect(env.MY_VAR).toBe("from-shell")
  })

  it("silently returns when sessionID missing", async () => {
    const hook = makeShellEnvHook({
      store, registry,
      resolveParentID: async () => undefined,
    })
    const env: Record<string, string> = {}
    await hook({ sessionID: undefined, cwd: "/" }, { env })
    expect(env).toEqual({})
  })
})
