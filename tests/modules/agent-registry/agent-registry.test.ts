import { beforeEach, describe, expect, it } from "vitest"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
  registerAgentMetadata,
} from "../../../src/modules/agent-registry/index.js"
import type { SpecialistInfo } from "../../../src/modules/agent-registry/agent-metadata.js"

function info(name: string): SpecialistInfo {
  return {
    name,
    mode: "subagent",
    description: `${name} desc`,
    metadata: { category: "specialist", cost: "CHEAP", triggers: [] },
  }
}

describe("agent metadata registry", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("returns empty when nothing is registered", () => {
    expect(getAgentMetadataRegistry()).toEqual([])
  })

  it("adds registered agents", () => {
    registerAgentMetadata(info("zmora"))
    expect(getAgentMetadataRegistry().map((a) => a.name)).toEqual(["zmora"])
  })

  it("throws on duplicate logical name", () => {
    registerAgentMetadata(info("zmora"))
    expect(() => registerAgentMetadata(info("zmora"))).toThrow(
      /Duplicate agent metadata: zmora/,
    )
  })

  it("returns a name-sorted copy", () => {
    registerAgentMetadata(info("zmora"))
    registerAgentMetadata(info("fix-auto"))
    expect(getAgentMetadataRegistry().map((a) => a.name)).toEqual([
      "fix-auto",
      "zmora",
    ])
  })

  it("returns a copy that cannot mutate internal state", () => {
    registerAgentMetadata(info("zmora"))
    getAgentMetadataRegistry().push(info("hacker"))
    expect(getAgentMetadataRegistry().map((a) => a.name)).toEqual(["zmora"])
  })
})
