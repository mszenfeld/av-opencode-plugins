import { describe, expect, it } from "vitest"
import {
  validateDispatchable,
  DISPATCHABLE_ALL_AGENTS,
  type AgentInfo,
} from "../../../src/modules/coordinator/dispatch.js"

const registry: Record<string, AgentInfo> = {
  zmora: { mode: "subagent" },
  perun: { mode: "primary" },
  omni: { mode: "all" },
  veles: { mode: "all" },
}

describe("validateDispatchable", () => {
  it("accepts a subagent regardless of caller mode", () => {
    expect(() => validateDispatchable(registry, "zmora")).not.toThrow()
    expect(() => validateDispatchable(registry, "zmora", "all")).not.toThrow()
    expect(() => validateDispatchable(registry, "zmora", "primary")).not.toThrow()
  })
  it("throws on an unknown agent", () => {
    expect(() => validateDispatchable(registry, "ghost")).toThrow(/Unknown agent: ghost/)
  })
  it("throws on a primary agent", () => {
    expect(() => validateDispatchable(registry, "perun", "primary")).toThrow(
      /Cannot dispatch primary agent: perun/,
    )
  })
  it("throws on a non-allowlisted all-agent even from a primary caller", () => {
    expect(() => validateDispatchable(registry, "omni", "primary")).toThrow(
      /Cannot dispatch all agent: omni/,
    )
  })
  it("allows an allowlisted all-agent (veles) when the caller is primary", () => {
    expect(() => validateDispatchable(registry, "veles", "primary")).not.toThrow()
  })
  it("rejects an allowlisted all-agent (veles) when the caller is not primary", () => {
    expect(() => validateDispatchable(registry, "veles", "all")).toThrow(
      /Cannot dispatch all agent: veles/,
    )
    expect(() => validateDispatchable(registry, "veles", "subagent")).toThrow(
      /Cannot dispatch all agent: veles/,
    )
  })
  it("rejects an allowlisted all-agent (veles) when caller mode is unknown", () => {
    expect(() => validateDispatchable(registry, "veles")).toThrow(
      /Cannot dispatch all agent: veles/,
    )
  })
  it("exposes the allowlist", () => {
    expect(DISPATCHABLE_ALL_AGENTS.has("veles")).toBe(true)
  })
})
