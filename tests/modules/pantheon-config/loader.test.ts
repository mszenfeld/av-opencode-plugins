import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { loadFresh, offsetToLineCol } from "../../../src/modules/pantheon-config/loader.js"
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
    // Parse-error detail must render as line:col, not a raw byte offset.
    // A goto-byte editor is rare; line:col is what users actually navigate by.
    expect(result.errors.some((e) => /failed to parse — .* at line \d+:\d+/.test(e))).toBe(true)
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

  it("silently skips unknown top-level sections and still applies known ones (forward-compatible per docs)", () => {
    writeProject(
      projectDir,
      `{
        "dispatch": { "maxParallel": 4 },
        "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } }
      }`,
    )
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
    // Unknown sections must NOT show up in errors — they would trigger a
    // warning toast and contradict the documented forward-compat promise.
    expect(result.errors).toEqual([])
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

  it("records an error and does not throw on deeply-nested JSON (RangeError-class input)", () => {
    // Construct a JSONC blob nested deeply enough to overflow jsonc-parser's
    // recursive descent. 10_000 levels reliably triggers "Maximum call stack
    // size exceeded" on Node's default stack. Before the fix this propagated
    // out of `ensureLoaded()` and crashed the coordinator's event handler.
    const depth = 10_000
    const nested = "[".repeat(depth) + "1" + "]".repeat(depth)
    writeProject(projectDir, nested)
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)

    let result: ReturnType<typeof loadFresh>
    expect(() => {
      result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    }).not.toThrow()
    expect(result!.errors.some((e) => /failed to parse/.test(e))).toBe(true)
    // user-global config must still be applied — one bad file does not
    // poison the whole load.
    expect(result!.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
  })

  it("skips an oversized file with an error entry instead of slurping it into memory", () => {
    // Just over the 1 MiB cap. Content is irrelevant — the size check fires
    // before the file is read.
    const oversized = "x".repeat(1024 * 1024 + 16)
    writeProject(projectDir, oversized)
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)

    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.errors.some((e) => /exceeds.*byte limit/i.test(e))).toBe(true)
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
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
})

describe("pantheonConfigEmpty()", () => {
  // pantheonConfigEmpty() calls loadFresh() with the process defaults
  // (process.cwd() + os.homedir()), so we override HOME and cwd to a tmp
  // sandbox to keep these tests hermetic — the real $HOME could have a
  // pantheon.json that would flip the result. Pattern mirrors
  // tests/modules/coordinator/notify-on-empty-config.test.ts.
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-empty-"))
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

  it("returns true when no pantheon.json exists anywhere", () => {
    expect(pantheonConfigEmpty()).toBe(true)
  })

  it("returns false when at least one agent is configured", () => {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "pantheon.json"),
      `{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    expect(pantheonConfigEmpty()).toBe(false)
  })
})

describe("offsetToLineCol", () => {
  it("returns 1:1 at offset 0", () => {
    expect(offsetToLineCol("abc", 0)).toBe("line 1:1")
  })

  it("advances column within a single line", () => {
    expect(offsetToLineCol("abcdef", 3)).toBe("line 1:4")
  })

  it("treats the character immediately after a newline as start of next line", () => {
    // "ab\ncd" — offset 3 points at 'c', the first char of line 2.
    expect(offsetToLineCol("ab\ncd", 3)).toBe("line 2:1")
  })

  it("counts multiple newlines", () => {
    // Three '\n's → line 4. Then "x" makes column 2 after the last newline.
    expect(offsetToLineCol("\n\n\nx", 4)).toBe("line 4:2")
  })

  it("points at the newline itself as end-of-line", () => {
    // "ab\ncd" — offset 2 points at '\n'. Until we cross it we are still on line 1.
    expect(offsetToLineCol("ab\ncd", 2)).toBe("line 1:3")
  })

  it("clamps offsets past end-of-input to the final position", () => {
    // Offsets beyond src.length must not run off the end. "abc" has length 3,
    // so any offset >= 3 resolves to line 1:4 (one past the last char).
    expect(offsetToLineCol("abc", 99)).toBe("line 1:4")
  })

  it("handles CRLF as col-then-newline", () => {
    // "a\r\nb" — only '\n' increments line. After "a\r" we're at col 3 on line 1;
    // after '\n' we move to line 2:1, so offset 3 (the 'b') is line 2:1.
    expect(offsetToLineCol("a\r\nb", 3)).toBe("line 2:1")
  })

  it("returns line 1:1 for an empty string at offset 0", () => {
    expect(offsetToLineCol("", 0)).toBe("line 1:1")
  })
})
