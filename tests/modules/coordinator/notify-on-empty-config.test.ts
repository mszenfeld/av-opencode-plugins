import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

describe("AppVerkCoordinatorPlugin toast notification", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string
  let showToast: ReturnType<typeof vi.fn>
  let client: { tui: { showToast: typeof showToast } }

  beforeEach(() => {
    __resetCacheForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-toast-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
    showToast = vi.fn().mockResolvedValue(true)
    client = { tui: { showToast } }
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
  })

  it("fires info toast on first session.created when no pantheon.json exists", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
    const arg = showToast.mock.calls[0]![0]
    expect(arg.body.variant).toBe("info")
    expect(arg.body.title).toBe("Pantheon")
    expect(arg.body.message).toMatch(/not found|default models/i)
  })

  it("does not retrigger on subsequent session.created events", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it("fires warning toast on parse error", async () => {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), `{ malformed`)
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast.mock.calls[0]![0].body.variant).toBe("warning")
  })

  it("does not toast when config is valid and non-empty", async () => {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "pantheon.json"),
      `{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).not.toHaveBeenCalled()
  })

  it("ignores non-session.created events", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.idle" } } as never)
    await plugin.event?.({ event: { type: "session.deleted" } } as never)
    expect(showToast).not.toHaveBeenCalled()
  })

  it("does not throw when showToast itself rejects", async () => {
    showToast.mockRejectedValueOnce(new Error("TUI unavailable"))
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await expect(
      plugin.event?.({ event: { type: "session.created" } } as never),
    ).resolves.not.toThrow()
  })

  it("writes parse errors to console.error so the toast's 'check console' guidance pays off", async () => {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), `{ malformed`)
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const plugin = await AppVerkCoordinatorPlugin({ client } as never)
      await plugin.event?.({ event: { type: "session.created" } } as never)
      expect(consoleErrorSpy).toHaveBeenCalled()
      const allArgs = consoleErrorSpy.mock.calls.map((c) => String(c[0]))
      expect(allArgs.some((m) => /\[pantheon\].*failed to parse/.test(m))).toBe(true)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it("does not crash when pantheon.json contains deeply-nested JSON (regression)", async () => {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    const depth = 10_000
    writeFileSync(
      path.join(dir, "pantheon.json"),
      "[".repeat(depth) + "1" + "]".repeat(depth),
    )
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const plugin = await AppVerkCoordinatorPlugin({ client } as never)
      await expect(
        plugin.event?.({ event: { type: "session.created" } } as never),
      ).resolves.not.toThrow()
      // The warning toast is the user-facing surface; it must still fire.
      expect(showToast).toHaveBeenCalledTimes(1)
      expect(showToast.mock.calls[0]![0].body.variant).toBe("warning")
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it("does not surface a warning toast for unknown top-level sections (forward-compat per docs)", async () => {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "pantheon.json"),
      `{
        "dispatch": { "maxParallel": 4 },
        "logging": { "level": "debug" },
        "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } }
      }`,
    )
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).not.toHaveBeenCalled()
  })
})
