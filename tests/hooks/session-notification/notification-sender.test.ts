import { describe, expect, it, vi } from "vitest"
import {
  NotificationSender,
  escapeAppleScriptText,
  type ShellTag,
} from "../../../src/hooks/session-notification/notification-sender.js"

interface FakeResponse {
  exitCode: number
  stdout: string
}

function createFakeShell(
  responder: (cmd: string) => FakeResponse | "throw",
): { $: ShellTag; calls: string[] } {
  const calls: string[] = []
  const $: ShellTag = (parts, ...values) => {
    let cmd = ""
    for (let i = 0; i < parts.length; i += 1) {
      cmd += parts[i]
      if (i < values.length) cmd += String(values[i])
    }
    calls.push(cmd)
    const response = responder(cmd)
    const promise: Promise<FakeResponse> =
      response === "throw"
        ? Promise.reject(new Error("shell error"))
        : Promise.resolve(response)
    const chain = Object.assign(promise, {
      quiet: () => chain,
      nothrow: () => chain,
    })
    return chain as ReturnType<ShellTag>
  }
  return { $, calls }
}

describe("escapeAppleScriptText", () => {
  it("escapes backslashes before quotes", () => {
    expect(escapeAppleScriptText('a\\b"c')).toBe('a\\\\b\\"c')
  })

  it("escapes a payload that would otherwise inject a shell script", () => {
    const evil = '"; do shell script "rm -rf /"; "'
    const escaped = escapeAppleScriptText(evil)
    expect(escaped).not.toContain('"; do shell script "rm -rf /"; "')
    expect(escaped).toContain('\\"')
  })

  it("leaves benign text unchanged", () => {
    expect(escapeAppleScriptText("Hello world")).toBe("Hello world")
  })
})

describe("NotificationSender", () => {
  it("does nothing when ctx.$ is undefined", async () => {
    const sender = new NotificationSender({})
    await expect(sender.send({ title: "T", message: "M" })).resolves.toBeUndefined()
    await expect(sender.playSound("/sound")).resolves.toBeUndefined()
  })

  it("prefers terminal-notifier when which finds it", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 0, stdout: "/usr/local/bin/terminal-notifier\n" }
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: "T", message: "M" })
    const lastCall = calls[calls.length - 1] ?? ""
    expect(lastCall).toContain("/usr/local/bin/terminal-notifier")
    expect(lastCall).toContain("-title T")
    expect(lastCall).toContain("-message M")
  })

  it("falls back to osascript when terminal-notifier is missing", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 1, stdout: "" }
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: "T", message: "M" })
    const lastCall = calls[calls.length - 1] ?? ""
    expect(lastCall).toContain("/usr/bin/osascript")
    expect(lastCall).toContain('display notification "M" with title "T"')
  })

  it("escapes title and message when shelling out via osascript", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 1, stdout: "" }
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: 'T"X', message: 'M"Y' })
    const lastCall = calls[calls.length - 1] ?? ""
    expect(lastCall).toContain('display notification "M\\"Y" with title "T\\"X"')
  })

  it("does nothing when neither terminal-notifier nor osascript is available", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which ")) return { exitCode: 1, stdout: "" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: "T", message: "M" })
    expect(calls.every((c) => c.startsWith("which "))).toBe(true)
  })

  it("swallows shell errors", async () => {
    const { $ } = createFakeShell((cmd) => {
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 1, stdout: "" }
      return "throw"
    })
    const sender = new NotificationSender({ $ })
    await expect(sender.send({ title: "T", message: "M" })).resolves.toBeUndefined()
  })

  it("caches the probe result across calls", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 1, stdout: "" }
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: "T", message: "M" })
    await sender.send({ title: "T", message: "M" })
    const whichCalls = calls.filter((c) => c.startsWith("which "))
    expect(whichCalls).toHaveLength(2)
  })

  it("playSound runs afplay with the provided path", async () => {
    const { $, calls } = createFakeShell(() => ({ exitCode: 0, stdout: "" }))
    const sender = new NotificationSender({ $ })
    await sender.playSound("/System/Library/Sounds/Glass.aiff")
    expect(calls.some((c) => c.includes("afplay /System/Library/Sounds/Glass.aiff"))).toBe(true)
  })

  it("playSound is a no-op when ctx.$ is undefined", async () => {
    const sender = new NotificationSender({})
    await expect(sender.playSound("/sound")).resolves.toBeUndefined()
  })

  it("logs once when ctx.$ is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const sender = new NotificationSender({})
    await sender.send({ title: "T", message: "M" })
    await sender.send({ title: "T", message: "M" })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
