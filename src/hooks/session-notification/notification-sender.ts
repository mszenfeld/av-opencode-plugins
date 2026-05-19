export interface ShellOutput {
  readonly exitCode: number
  readonly stdout: string | { toString(): string }
}

export type ShellChain = Promise<ShellOutput> & {
  quiet(): ShellChain
  nothrow(): ShellChain
}

export type ShellTag = (parts: TemplateStringsArray, ...values: unknown[]) => ShellChain

export interface NotificationSenderContext {
  readonly $?: ShellTag
}

interface ProbeResult {
  osascriptPath: string | null
  terminalNotifierPath: string | null
}

export function escapeAppleScriptText(input: string): string {
  // Order matters: escape backslashes first, then double quotes.
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export class NotificationSender {
  private probeCache: ProbeResult | undefined
  private warnedNoShell = false

  constructor(private readonly ctx: NotificationSenderContext) {}

  async send(args: { title: string; message: string }): Promise<void> {
    const $ = this.ctx.$
    if (typeof $ !== "function") {
      this.warnOnceNoShell()
      return
    }
    const probe = await this.probe($)
    try {
      if (probe.terminalNotifierPath !== null) {
        await $`${probe.terminalNotifierPath} -title ${args.title} -message ${args.message}`.nothrow().quiet()
        return
      }
      if (probe.osascriptPath !== null) {
        const script =
          `display notification "${escapeAppleScriptText(args.message)}" ` +
          `with title "${escapeAppleScriptText(args.title)}"`
        await $`${probe.osascriptPath} -e ${script}`.nothrow().quiet()
      }
    } catch {
      // Swallow — notification is best-effort.
    }
  }

  async playSound(soundPath: string): Promise<void> {
    const $ = this.ctx.$
    if (typeof $ !== "function") {
      this.warnOnceNoShell()
      return
    }
    try {
      await $`afplay ${soundPath}`.nothrow().quiet()
    } catch {
      // Swallow.
    }
  }

  private async probe($: ShellTag): Promise<ProbeResult> {
    if (this.probeCache !== undefined) return this.probeCache
    const terminalNotifierPath = await whichOrNull($, "terminal-notifier")
    const osascriptPath = await whichOrNull($, "osascript")
    this.probeCache = { osascriptPath, terminalNotifierPath }
    return this.probeCache
  }

  private warnOnceNoShell(): void {
    if (this.warnedNoShell) return
    this.warnedNoShell = true
    console.warn("[pantheon/session-notification] ctx.$ unavailable; notifications disabled")
  }
}

async function whichOrNull($: ShellTag, bin: string): Promise<string | null> {
  try {
    const result = await $`which ${bin}`.nothrow().quiet()
    if (result.exitCode !== 0) return null
    const path = (typeof result.stdout === "string" ? result.stdout : result.stdout.toString()).trim()
    return path.length > 0 ? path : null
  } catch {
    return null
  }
}
