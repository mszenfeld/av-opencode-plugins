import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

describe("AppVerkQAPlugin Zmora model injection", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-qa-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  it("sets model on BOTH zmora-fe and zmora-be when zmora.model is configured", async () => {
    writeUserGlobal(`{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`)
    const plugin = await AppVerkQAPlugin({} as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["zmora-fe"]!.model).toBe("anthropic/claude-sonnet-4-6")
    expect(config.agent!["zmora-be"]!.model).toBe("anthropic/claude-sonnet-4-6")
  })

  it("leaves both variant models unset when no pantheon.json", async () => {
    const plugin = await AppVerkQAPlugin({} as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["zmora-fe"]!.model).toBeUndefined()
    expect(config.agent!["zmora-be"]!.model).toBeUndefined()
  })
})
