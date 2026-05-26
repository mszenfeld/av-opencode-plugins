function escapeAppleScriptText(input) {
  const sanitized = input.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "").replace(/[\r\n]+/g, " ").replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
  return sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function appleQuote(input) {
  return `"${escapeAppleScriptText(input)}"`;
}
function appleScript(parts, ...values) {
  let out = "";
  for (let i = 0; i < parts.length; i += 1) {
    out += parts[i];
    if (i < values.length) out += values[i];
  }
  return out;
}
class NotificationSender {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  probeCache;
  /** Per-instance one-shot guard for the "ctx.$ unavailable" warning. */
  warnedNoShell = false;
  async send(args) {
    const $ = this.ctx.$;
    if (typeof $ !== "function") {
      this.warnOnceNoShell();
      return;
    }
    const probe = await this.probe($);
    try {
      if (probe.terminalNotifierPath !== null) {
        await $`${probe.terminalNotifierPath} -title ${args.title} -message ${args.message}`.nothrow().quiet();
        return;
      }
      if (probe.osascriptPath !== null) {
        const script = appleScript`display notification ${appleQuote(args.message)} with title ${appleQuote(args.title)}`;
        await $`${probe.osascriptPath} -e ${script}`.nothrow().quiet();
      }
    } catch {
    }
  }
  async playSound(soundPath) {
    const $ = this.ctx.$;
    if (typeof $ !== "function") {
      this.warnOnceNoShell();
      return;
    }
    try {
      await $`afplay ${soundPath}`.nothrow().quiet();
    } catch {
    }
  }
  async probe($) {
    if (this.probeCache !== void 0) return this.probeCache;
    const [terminalNotifierPath, osascriptPath] = await Promise.all([
      whichOrNull($, "terminal-notifier"),
      whichOrNull($, "osascript")
    ]);
    this.probeCache = { osascriptPath, terminalNotifierPath };
    return this.probeCache;
  }
  warnOnceNoShell() {
    if (this.warnedNoShell) return;
    this.warnedNoShell = true;
    console.warn("[pantheon/session-notification] ctx.$ unavailable; notifications disabled");
  }
}
async function whichOrNull($, bin) {
  try {
    const result = await $`which ${bin}`.nothrow().quiet();
    if (result.exitCode !== 0) return null;
    const path = (typeof result.stdout === "string" ? result.stdout : result.stdout.toString()).trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}
export {
  NotificationSender,
  appleQuote,
  appleScript,
  escapeAppleScriptText
};
