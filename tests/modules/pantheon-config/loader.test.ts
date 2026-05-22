import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { loadFresh } from "../../../src/modules/pantheon-config/loader.js"
import {
  __resetCacheForTests,
  loadPantheonConfig,
  pantheonConfigEmpty,
} from "../../../src/modules/pantheon-config/index.js"

describe("loadFresh", () => {
  let tmpHome: string
  let projectDir: string

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-loader-"))
    projectDir = path.join(tmpHome, "work", "repo")
    mkdirSync(projectDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  function writeProject(dir: string, content: string): void {
    const sub = path.join(dir, ".opencode")
    mkdirSync(sub, { recursive: true })
    writeFileSync(path.join(sub, "pantheon.json"), content)
  }

  it("returns empty config and no errors when nothing exists", () => {
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents).toEqual({})
    expect(result.errors).toEqual([])
  })

  it("loads user-global only", () => {
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
  })

  it("loads project-only", () => {
    writeProject(projectDir, `{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.zmora).toEqual({ model: "anthropic/claude-sonnet-4-6" })
  })

  it("merges user-global + project per-agent (project wins on collision)", () => {
    writeUserGlobal(`{ "agents": {
      "perun": { "model": "anthropic/claude-opus-4-7" },
      "zmora": { "model": "anthropic/claude-haiku-4-5-20251001" }
    } }`)
    writeProject(projectDir, `{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
      zmora: { model: "anthropic/claude-sonnet-4-6" },
    })
  })

  it("closest project file wins over farther one", () => {
    const outer = path.join(tmpHome, "work")
    writeProject(outer, `{ "agents": { "perun": { "model": "anthropic/from-outer" } } }`)
    writeProject(projectDir, `{ "agents": { "perun": { "model": "anthropic/from-inner" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun!.model).toBe("anthropic/from-inner")
  })

  it("parses JSONC with comments and trailing commas", () => {
    writeProject(
      projectDir,
      `{
        // perun gets opus
        "agents": {
          "perun": { "model": "anthropic/claude-opus-4-7", },
        },
      }`,
    )
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
    expect(result.errors).toEqual([])
  })

  it("records error and skips file on malformed JSON", () => {
    writeProject(projectDir, `{ this is : not json`)
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.errors.some((e) => /failed to parse/.test(e))).toBe(true)
    // user-global still applied
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
  })

  it("records error on non-object top-level and continues", () => {
    writeProject(projectDir, `["not", "an", "object"]`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.errors.some((e) => /top-level must be object/.test(e))).toBe(true)
    expect(result.config.agents).toEqual({})
  })

  it("skips invalid model but keeps valid ones in the same file", () => {
    writeProject(
      projectDir,
      `{ "agents": {
        "perun": { "model": "anthropic/claude-opus-4-7" },
        "broken": { "model": "no-slash" }
      } }`,
    )
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
    expect(result.config.agents.broken).toBeUndefined()
    expect(result.errors.some((e) => /invalid model "no-slash"/.test(e))).toBe(true)
  })

  it("warns on unknown top-level section but still applies known ones", () => {
    writeProject(
      projectDir,
      `{
        "dispatch": { "maxParallel": 4 },
        "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } }
      }`,
    )
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
    expect(result.errors.some((e) => /unknown section "dispatch"/.test(e))).toBe(true)
  })

  it("warns on unknown agent field but keeps model", () => {
    writeProject(
      projectDir,
      `{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7", "temperature": 0.5 } } }`,
    )
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
    expect(result.errors.some((e) => /unknown field "agents\.perun\.temperature"/.test(e))).toBe(true)
  })
})

describe("module-scope cache (index.ts)", () => {
  beforeEach(() => {
    __resetCacheForTests()
  })

  it("caches the loaded config across calls", () => {
    const a = loadPantheonConfig()
    const b = loadPantheonConfig()
    expect(a).toBe(b) // same object reference
  })

  it("reflects emptiness via pantheonConfigEmpty()", () => {
    // No pantheon.json anywhere under tmp — but the real cwd could have one.
    // We assert the API exists and returns a boolean; the strict empty check
    // lives in tests that control startDir via loadFresh.
    expect(typeof pantheonConfigEmpty()).toBe("boolean")
  })
})
