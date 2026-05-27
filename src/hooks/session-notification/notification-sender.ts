export interface ShellOutput {
  readonly exitCode: number
  readonly stdout: string | { toString(): string }
}

export type ShellChain = Promise<ShellOutput> & {
  quiet(): ShellChain
  nothrow(): ShellChain
}

// Rest param is `string[]` (not `unknown[]`) for two reasons: (1) every call
// site in this module only interpolates strings — binary paths, notification
// title/message, the assembled AppleScript — so this is tighter, not looser;
// (2) it makes this structural alias assignable-from Bun's `BunShell`, whose
// own call signature takes `ShellExpression[]` (a superset of `string`). That
// assignability lets the plugin pass OpenCode's `ctx` straight in with no cast.
export type ShellTag = (parts: TemplateStringsArray, ...values: string[]) => ShellChain

export interface NotificationSenderContext {
  readonly $?: ShellTag
}

interface ProbeResult {
  osascriptPath: string | null
  terminalNotifierPath: string | null
}

/**
 * Branded type representing a fully-quoted, escape-safe AppleScript string
 * literal (including the surrounding double quotes). The only way to mint a
 * value of this type is via {@link appleQuote}, which forces the input through
 * {@link escapeAppleScriptText}. Template assembly for osascript MUST only
 * interpolate values of this type - that way, adding a new template field
 * (e.g., `subtitle`) without escaping becomes a compile-time error rather
 * than a latent injection bug.
 */
export type AppleScriptLiteral = string & { readonly __appleScriptLiteral: unique symbol }

// For the markdown-sink variant see
// `packages/coordinator/src/sanitize.ts::neutralizeUntrustedOutput`.
// Different rules — different sinks.
export function escapeAppleScriptText(input: string): string {
  // Defense-in-depth: strip ASCII control chars (NUL, BEL, etc., excluding TAB)
  // and Unicode BiDi override codepoints (U+202A-U+202E, U+2066-U+2069) that
  // could spoof or truncate notification banners if hostile model output reaches
  // osascript. Collapse CR/LF runs to a single space so multi-line payloads do
  // not break the AppleScript string literal.
  const sanitized = input
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
  // Order matters: escape backslashes first, then double quotes.
  return sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * Returns the input as a fully-quoted AppleScript string literal (including
 * the surrounding `"`), branded as {@link AppleScriptLiteral}. Use this for
 * every value interpolated into an osascript template so that the type system
 * blocks raw-string interpolation paths.
 */
export function appleQuote(input: string): AppleScriptLiteral {
  return `"${escapeAppleScriptText(input)}"` as AppleScriptLiteral
}

/**
 * Type-safe osascript template builder. Accepts only {@link AppleScriptLiteral}
 * values for interpolation, so any caller that tries to splice an unescaped
 * string in fails at compile time. The static parts come from the developer-
 * authored template literal and never carry user input.
 */
export function appleScript(
  parts: TemplateStringsArray,
  ...values: readonly AppleScriptLiteral[]
): string {
  let out = ""
  for (let i = 0; i < parts.length; i += 1) {
    out += parts[i]
    if (i < values.length) out += values[i]
  }
  return out
}

export class NotificationSender {
  private probeCache: ProbeResult | undefined
  /** Per-instance one-shot guard for the "ctx.$ unavailable" warning. */
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
        // Every interpolated value must be an AppleScriptLiteral (produced by
        // appleQuote, which forces escapeAppleScriptText). Adding a new field
        // like `subtitle` to the template without going through appleQuote is
        // a TypeScript error — defense-in-depth against forgetting the escape.
        const script = appleScript`display notification ${appleQuote(args.message)} with title ${appleQuote(args.title)}`
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
    const [terminalNotifierPath, osascriptPath] = await Promise.all([
      whichOrNull($, "terminal-notifier"),
      whichOrNull($, "osascript"),
    ])
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
