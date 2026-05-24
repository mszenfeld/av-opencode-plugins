import { describe, expect, it } from "vitest"
import { validateConfigFile } from "../../../src/modules/pantheon-config/schema.js"

describe("validateConfigFile", () => {
  it("accepts a valid full config", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "anthropic/claude-opus-4-7" } },
    })
    expect(result.config).toEqual({
      agents: { perun: { model: "anthropic/claude-opus-4-7" } },
    })
    expect(result.errors).toEqual([])
  })

  it("accepts an empty object as empty config", () => {
    const result = validateConfigFile({})
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors).toEqual([])
  })

  it("accepts an empty agents map", () => {
    const result = validateConfigFile({ agents: {} })
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors).toEqual([])
  })

  it("rejects non-object top level", () => {
    const result = validateConfigFile("nope")
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors[0]).toMatch(/top-level must be object/i)
  })

  it("rejects model without slash", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "no-slash-here" } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors[0]).toMatch(/invalid model "no-slash-here"/)
  })

  it("rejects model with more than one slash", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "a/b/c" } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors[0]).toMatch(/invalid model "a\/b\/c"/)
  })

  it("rejects non-string model", () => {
    const result = validateConfigFile({
      agents: { perun: { model: 42 } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors[0]).toMatch(/invalid model/)
  })

  it("preserves valid agents alongside invalid ones", () => {
    const result = validateConfigFile({
      agents: {
        perun: { model: "anthropic/claude-opus-4-7" },
        broken: { model: "no-slash" },
      },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
    })
    expect(result.errors).toHaveLength(1)
  })

  it("silently skips unknown top-level sections (forward-compatible per docs)", () => {
    const result = validateConfigFile({ dispatch: { maxParallel: 4 } })
    expect(result.config).toEqual({ agents: {} })
    // Per docs/configuring-agents.md FAQ, unknown sections are ignored
    // without surfacing to the user — `errors[]` triggers a warning toast,
    // and a documented forward-compat feature must not produce a warning.
    expect(result.errors).toEqual([])
  })

  it("silently skips unknown top-level sections alongside valid agents", () => {
    const result = validateConfigFile({
      dispatch: { maxParallel: 4 },
      logging: { level: "debug" },
      agents: { perun: { model: "anthropic/claude-opus-4-7" } },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
    })
    expect(result.errors).toEqual([])
  })

  it("warns on unknown field under agent but keeps model", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "anthropic/claude-opus-4-7", temperature: 0.5 } },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
    })
    expect(result.errors.some((e) => /unknown field "agents\.perun\.temperature"/.test(e))).toBe(true)
  })

  it("includes sourcePath in error messages when provided", () => {
    const result = validateConfigFile("nope", "/etc/example.json")
    expect(result.errors[0]).toContain("/etc/example.json")
  })
})
