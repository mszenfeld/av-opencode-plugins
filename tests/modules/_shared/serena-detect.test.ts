import { describe, expect, it } from "vitest"
import {
  isSerenaAvailable,
  type ConfigLike,
} from "../../../src/modules/_shared/serena-detect.js"

describe("isSerenaAvailable", () => {
  it("returns true when an mcp.serena entry is present", () => {
    const config: ConfigLike = { mcp: { serena: { type: "local" }, context7: {} } }
    expect(isSerenaAvailable(config)).toBe(true)
  })

  it("returns false when serena is absent from mcp", () => {
    expect(isSerenaAvailable({ mcp: { context7: {} } })).toBe(false)
  })

  it("returns false when there is no mcp map", () => {
    expect(isSerenaAvailable({})).toBe(false)
  })

  it("returns false when serena is explicitly disabled", () => {
    expect(isSerenaAvailable({ mcp: { serena: { enabled: false } } })).toBe(false)
  })

  it("returns false for a null serena entry (malformed config)", () => {
    expect(isSerenaAvailable({ mcp: { serena: null } } as never)).toBe(false)
  })

  it("returns false for a non-object serena entry", () => {
    expect(isSerenaAvailable({ mcp: { serena: true } } as never)).toBe(false)
  })
})
