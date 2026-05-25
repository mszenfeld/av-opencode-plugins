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

  it("accepts aggregator-prefixed model strings (e.g. openrouter)", () => {
    // OpenRouter and similar aggregators publish models under a nested path
    // like `openrouter/openai/gpt-5.5`. The schema must accept these even
    // though they contain more than one slash.
    const result = validateConfigFile({
      agents: {
        perun: { model: "openrouter/openai/gpt-5.5" },
        zmora: { model: "openrouter/anthropic/claude-3.5-sonnet" },
      },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "openrouter/openai/gpt-5.5" },
      zmora: { model: "openrouter/anthropic/claude-3.5-sonnet" },
    })
    expect(result.errors).toEqual([])
  })

  it("rejects empty segments in multi-slash paths", () => {
    // CWE-117 protection — empty segments would produce ambiguous identifiers
    // and may indicate malformed input. Allowed structure: 2+ non-empty
    // segments separated by single slashes.
    const cases = ["a//b", "/leading", "trailing/", "a/b/", "//"]
    for (const model of cases) {
      const result = validateConfigFile({
        agents: { perun: { model } },
      })
      expect(result.config.agents, `should reject ${model}`).toEqual({})
      expect(result.errors[0], `should reject ${model}`).toMatch(/invalid model/)
    }
  })

  it("rejects models containing control characters or whitespace (CWE-117)", () => {
    // The `[A-Za-z0-9._-]` allow-list intentionally excludes ESC, newlines,
    // BiDi marks, zero-width chars, and tabs — none of which appear in real
    // OpenCode model identifiers but all of which could corrupt downstream
    // TUI logs if allowed through.
    const cases = [
      "anthropic/claude\x1b[31m-opus",
      "anthropic/claude\nopus",
      "anthropic/claude‮opus",
      "anthropic/claude opus",
      "anthropic/claude\topus",
    ]
    for (const model of cases) {
      const result = validateConfigFile({
        agents: { perun: { model } },
      })
      expect(result.config.agents, `should reject ${JSON.stringify(model)}`).toEqual({})
      expect(result.errors[0], `should reject ${JSON.stringify(model)}`).toMatch(/invalid model/)
    }
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
