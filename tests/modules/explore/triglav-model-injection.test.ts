import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkExplorePlugin } from "../../../src/modules/explore/index.js"
import { TRIGLAV_AGENT_KEY } from "../../../src/modules/explore/triglav.metadata.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"
import { clearAgentMetadataRegistry } from "../../../src/modules/agent-registry/index.js"

function fakeInput() {
  return { client: { tui: { showToast: async () => {} } } } as never
}

describe("AppVerkExplorePlugin triglav model injection", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  // `clearAgentMetadataRegistry()` in before/afterEach is defensive: the explore
  // factory calls `registerAgentMetadata(triglavSpecialistInfo)`, and while
  // re-registration is idempotent for identical metadata, clearing keeps each
  // test independent of registry state leaked from other suites.
  beforeEach(() => {
    __resetCacheForTests()
    clearAgentMetadataRegistry()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-explore-"))
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
    clearAgentMetadataRegistry()
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  it("sets model on 'triglav' when pantheon.json provides triglav.model", async () => {
    writeUserGlobal(`{ "agents": { "triglav": { "model": "opencode/claude-haiku-4-5" } } }`)
    const plugin = await AppVerkExplorePlugin(fakeInput())
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent![TRIGLAV_AGENT_KEY]!.model).toBe("opencode/claude-haiku-4-5")
  })

  it("leaves model unset when no pantheon.json exists", async () => {
    const plugin = await AppVerkExplorePlugin(fakeInput())
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent![TRIGLAV_AGENT_KEY]!.model).toBeUndefined()
  })

  it("leaves model unset when triglav key is absent", async () => {
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)
    const plugin = await AppVerkExplorePlugin(fakeInput())
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent![TRIGLAV_AGENT_KEY]!.model).toBeUndefined()
  })

  // Defense-in-depth: confirm the plugin seam rejects adversarial model
  // strings even though the schema (MODEL_REGEX in
  // src/modules/pantheon-config/schema.ts) already filters them. Covers
  // CWE-117/CWE-1188 — an ANSI/BiDi/control-byte payload must never reach
  // `config.agent["triglav"].model` and downstream TUI sinks.
  it("leaves model unset when pantheon.json provides an invalid model", async () => {
    writeUserGlobal(`{ "agents": { "triglav": { "model": "bad model\\u001b[31m" } } }`)
    const plugin = await AppVerkExplorePlugin(fakeInput())
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent![TRIGLAV_AGENT_KEY]!.model).toBeUndefined()
  })
})
