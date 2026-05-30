import { describe, expect, it } from "vitest"
import {
  validateDispatchable,
  DISPATCHABLE_ALL_AGENTS,
  type AgentInfo,
} from "../../../src/modules/coordinator/dispatch.js"
import { VELES_AGENT_KEY } from "../../../src/modules/plan/veles.metadata.js"

const registry: Record<string, AgentInfo> = {
  zmora: { mode: "subagent" },
  perun: { mode: "primary" },
  omni: { mode: "all" },
  "Veles - Planner": { mode: "all" },
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
  it("allows an allowlisted all-agent (Veles - Planner) when the caller is primary", () => {
    expect(() => validateDispatchable(registry, "Veles - Planner", "primary")).not.toThrow()
  })
  it("rejects an allowlisted all-agent (Veles - Planner) when the caller is not primary", () => {
    expect(() => validateDispatchable(registry, "Veles - Planner", "all")).toThrow(
      /Cannot dispatch all agent: Veles - Planner/,
    )
    expect(() => validateDispatchable(registry, "Veles - Planner", "subagent")).toThrow(
      /Cannot dispatch all agent: Veles - Planner/,
    )
  })
  it("rejects an allowlisted all-agent (Veles - Planner) when caller mode is unknown", () => {
    expect(() => validateDispatchable(registry, "Veles - Planner")).toThrow(
      /Cannot dispatch all agent: Veles - Planner/,
    )
  })
  it("exposes the allowlist, kept in sync with VELES_AGENT_KEY", () => {
    expect(DISPATCHABLE_ALL_AGENTS.has(VELES_AGENT_KEY)).toBe(true)
    expect(VELES_AGENT_KEY).toBe("Veles - Planner")
  })
})
