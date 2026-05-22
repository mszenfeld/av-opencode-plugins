import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

describe("AppVerkCoordinatorPlugin model injection", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-coord-"))
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

  it("sets model on 'Perun - Coordinator' when pantheon.json provides perun.model", async () => {
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)
    const plugin = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["Perun - Coordinator"]!.model).toBe("anthropic/claude-opus-4-7")
  })

  it("leaves model unset when no pantheon.json exists", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["Perun - Coordinator"]!.model).toBeUndefined()
  })

  it("leaves model unset when perun key is absent", async () => {
    writeUserGlobal(`{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`)
    const plugin = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["Perun - Coordinator"]!.model).toBeUndefined()
  })
})
