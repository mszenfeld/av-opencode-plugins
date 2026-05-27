import { beforeEach, describe, expect, it } from "vitest"

import { SessionAgentRegistry } from "../../../src/modules/_shared/session-agent-registry.js"

describe("SessionAgentRegistry", () => {
  let registry: SessionAgentRegistry

  beforeEach(() => {
    registry = new SessionAgentRegistry()
  })

  it("looks up an agent registered for a session id", () => {
    registry.register("session-1", "qa-agent")

    expect(registry.lookup("session-1")).toBe("qa-agent")
  })

  it("returns undefined for an unregistered session id", () => {
    expect(registry.lookup("does-not-exist")).toBeUndefined()
  })

  it("keeps separate sessions independent", () => {
    registry.register("session-1", "qa-agent")
    registry.register("session-2", "review-agent")

    expect(registry.lookup("session-1")).toBe("qa-agent")
    expect(registry.lookup("session-2")).toBe("review-agent")
  })

  it("overwrites the agent when the same session id is re-registered", () => {
    registry.register("session-1", "first-agent")
    registry.register("session-1", "second-agent")

    expect(registry.lookup("session-1")).toBe("second-agent")
  })

  it("removes a mapping on unregister so lookup returns undefined", () => {
    registry.register("session-1", "qa-agent")
    registry.unregister("session-1")

    expect(registry.lookup("session-1")).toBeUndefined()
  })

  it("treats unregistering an unknown session id as a no-op", () => {
    registry.register("session-1", "qa-agent")

    expect(() => registry.unregister("does-not-exist")).not.toThrow()
    expect(registry.lookup("session-1")).toBe("qa-agent")
  })

  it("supports re-registering after an unregister", () => {
    registry.register("session-1", "first-agent")
    registry.unregister("session-1")
    registry.register("session-1", "second-agent")

    expect(registry.lookup("session-1")).toBe("second-agent")
  })
})
