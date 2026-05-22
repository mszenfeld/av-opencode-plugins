import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_SESSION_NOTIFICATION_CONFIG,
  readConfigFromEnv,
} from "../../../src/hooks/session-notification/env-config.js"

describe("readConfigFromEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns defaults for an empty env", () => {
    expect(readConfigFromEnv({})).toEqual(DEFAULT_SESSION_NOTIFICATION_CONFIG)
  })

  it("applies title override", () => {
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_TITLE: "CustomTitle" })
    expect(c.title).toBe("CustomTitle")
  })

  it("applies all message overrides", () => {
    const c = readConfigFromEnv({
      AV_PANTHEON_NOTIFY_IDLE_MSG: "idle!",
      AV_PANTHEON_NOTIFY_QUESTION_MSG: "ask!",
      AV_PANTHEON_NOTIFY_PERMISSION_MSG: "perm!",
    })
    expect(c.idleMessage).toBe("idle!")
    expect(c.questionMessage).toBe("ask!")
    expect(c.permissionMessage).toBe("perm!")
  })

  it("parses a valid delay value", () => {
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "2500" })
    expect(c.idleConfirmationDelayMs).toBe(2500)
  })

  it("falls back to the default and warns on a non-numeric delay", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "abc" })
    expect(c.idleConfirmationDelayMs).toBe(DEFAULT_SESSION_NOTIFICATION_CONFIG.idleConfirmationDelayMs)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("falls back to the default and warns on a negative delay", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "-100" })
    expect(c.idleConfirmationDelayMs).toBe(DEFAULT_SESSION_NOTIFICATION_CONFIG.idleConfirmationDelayMs)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("falls back to the default and warns on a numeric value with a unit suffix", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "1500ms" })
    expect(c.idleConfirmationDelayMs).toBe(DEFAULT_SESSION_NOTIFICATION_CONFIG.idleConfirmationDelayMs)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("falls back to the default and warns on a fractional delay", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "1.5" })
    expect(c.idleConfirmationDelayMs).toBe(DEFAULT_SESSION_NOTIFICATION_CONFIG.idleConfirmationDelayMs)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("accepts zero as a valid non-negative delay without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "0" })
    expect(c.idleConfirmationDelayMs).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it("enables sound when AV_PANTHEON_NOTIFY_SOUND=1", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND: "1" })
    expect(c.playSound).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  it("leaves sound disabled and silent for AV_PANTHEON_NOTIFY_SOUND=0", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND: "0" })
    expect(c.playSound).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("uses the default and stays silent for an empty AV_PANTHEON_NOTIFY_SOUND", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND: "" })
    expect(c.playSound).toBe(DEFAULT_SESSION_NOTIFICATION_CONFIG.playSound)
    expect(warn).not.toHaveBeenCalled()
  })

  it("warns and leaves sound disabled when AV_PANTHEON_NOTIFY_SOUND is 'true'", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND: "true" })
    expect(c.playSound).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("warns and leaves sound disabled when AV_PANTHEON_NOTIFY_SOUND is 'yes'", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND: "yes" })
    expect(c.playSound).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("applies a sound path override", () => {
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND_PATH: "/tmp/ding.aiff" })
    expect(c.soundPath).toBe("/tmp/ding.aiff")
  })

  // env-var interpolations into console.warn must strip C0/C1 control bytes
  // and BiDi overrides — they're developer-controlled, but the rest of the
  // plugin neutralises log/console sinks consistently.
  it("strips control bytes from the warning when delay env var contains them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "\x1b[31mabc\x1b[0m‮" })
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0]?.[0] ?? "")
    expect(msg).not.toContain("\x1b")
    expect(msg).not.toContain("‮")
  })

  it("strips control bytes from the warning when sound env var contains them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND: "\x1b[2J\x07hostile" })
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0]?.[0] ?? "")
    expect(msg).not.toContain("\x1b")
    expect(msg).not.toContain("\x07")
  })

  // CWE-117: an embedded \n in a developer-set env var would split the
  // warning into two log lines and fabricate a second log entry — the
  // canonical log-forging vector that safeForLog exists to prevent.
  it("strips newlines from the warning to prevent log line-splitting (CWE-117)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "bad\n[FAKE_LOG] critical" })
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0]?.[0] ?? "")
    expect(msg).not.toContain("\n")
  })

  it("strips tabs from the warning when env var contains them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "bad\tvalue" })
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = String(warn.mock.calls[0]?.[0] ?? "")
    expect(msg).not.toContain("\t")
  })
})
