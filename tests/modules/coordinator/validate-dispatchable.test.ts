import { describe, expect, it } from "vitest"
import {
  validateDispatchable,
  type AgentInfo,
} from "../../../src/modules/coordinator/dispatch.js"

const registry: Record<string, AgentInfo> = {
  zmora: { mode: "subagent" },
  perun: { mode: "primary" },
  omni: { mode: "all" },
}

describe("validateDispatchable", () => {
  it("accepts a subagent", () => {
    expect(() => validateDispatchable(registry, "zmora")).not.toThrow()
  })
  it("throws on an unknown agent", () => {
    expect(() => validateDispatchable(registry, "ghost")).toThrow(/Unknown agent: ghost/)
  })
  it("throws on a primary agent", () => {
    expect(() => validateDispatchable(registry, "perun")).toThrow(/Cannot dispatch primary agent: perun/)
  })
  it("throws on an all-mode agent", () => {
    expect(() => validateDispatchable(registry, "omni")).toThrow(/Cannot dispatch all agent: omni/)
  })
})
