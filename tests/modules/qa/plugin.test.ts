import { describe, it, expect, beforeAll } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import { buildQATesterAgent } from "../../../src/modules/qa/prompt-builder.js"
import { FE_TOOLS, BE_TOOLS } from "../../../src/modules/qa/allowed-tools.js"

describe("AppVerkQAPlugin", () => {
  let pluginResult: Awaited<ReturnType<typeof AppVerkQAPlugin>>

  beforeAll(async () => {
    pluginResult = await AppVerkQAPlugin({} as never)
  })

  it("exports a plugin factory", () => {
    expect(typeof AppVerkQAPlugin).toBe("function")
  })

  const EXPECTED_VARIANTS = ["qa-tester-fe", "qa-tester-be"]
  const REMOVED_AGENTS = ["qa-fe-tester", "qa-be-tester", "qa-tester"]
  const EXPECTED_COMMANDS = ["create-qa-plan", "run-qa"]

  it.each(EXPECTED_VARIANTS)("registers %s variant", async (name) => {
    const config: Config = { agent: {} }
    await pluginResult.config?.(config)
    expect(config.agent![name]).toBeDefined()
    expect(config.agent![name]!.mode).toBe("subagent")
    expect(typeof config.agent![name]!.prompt).toBe("string")
  })

  it.each(REMOVED_AGENTS)("does not register %s (old or unsuffixed)", async (name) => {
    const config: Config = { agent: {} }
    await pluginResult.config?.(config)
    expect(config.agent![name]).toBeUndefined()
  })

  it.each(EXPECTED_COMMANDS)("registers %s command", async (name) => {
    const config: Config = { command: {} }
    await pluginResult.config?.(config)
    expect(config.command![name]).toBeDefined()
    expect(typeof config.command![name]!.template).toBe("string")
  })
})

describe("buildQATesterAgent", () => {
  it("produces fe variant with FE tools and no BE tools", () => {
    const { prompt } = buildQATesterAgent("fe")
    expect(prompt).toContain("name: qa-tester-fe")
    expect(prompt).toContain("mode: subagent")
    for (const t of FE_TOOLS) expect(prompt).toContain(t)
    for (const t of BE_TOOLS) expect(prompt).not.toContain(t)
    expect(prompt).toContain("FE variant — Playwright")
    expect(prompt).not.toContain("BE variant — HTTP + DB")
  })

  it("produces be variant with BE tools and no FE tools", () => {
    const { prompt } = buildQATesterAgent("be")
    expect(prompt).toContain("name: qa-tester-be")
    for (const t of BE_TOOLS) expect(prompt).toContain(t)
    for (const t of FE_TOOLS) expect(prompt).not.toContain(t)
    expect(prompt).toContain("BE variant — HTTP + DB")
    expect(prompt).not.toContain("FE variant — Playwright")
  })
})
