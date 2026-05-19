// For the markdown-sink variant see
// `packages/coordinator/src/sanitize.ts::neutralizeUntrustedOutput`.
// Different rules — different sinks.
export function escapeAppleScriptText(input) {
    // Defense-in-depth: strip ASCII control chars (NUL, BEL, etc., excluding TAB)
    // and Unicode BiDi override codepoints (U+202A-U+202E, U+2066-U+2069) that
    // could spoof or truncate notification banners if hostile model output reaches
    // osascript. Collapse CR/LF runs to a single space so multi-line payloads do
    // not break the AppleScript string literal.
    const sanitized = input
        .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "")
        .replace(/[\r\n]+/g, " ")
        .replace(/[\u202A-\u202E\u2066-\u2069]/g, "");
    // Order matters: escape backslashes first, then double quotes.
    return sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
/**
 * Returns the input as a fully-quoted AppleScript string literal (including
 * the surrounding `"`), branded as {@link AppleScriptLiteral}. Use this for
 * every value interpolated into an osascript template so that the type system
 * blocks raw-string interpolation paths.
 */
export function appleQuote(input) {
    return `"${escapeAppleScriptText(input)}"`;
}
/**
 * Type-safe osascript template builder. Accepts only {@link AppleScriptLiteral}
 * values for interpolation, so any caller that tries to splice an unescaped
 * string in fails at compile time. The static parts come from the developer-
 * authored template literal and never carry user input.
 */
export function appleScript(parts, ...values) {
    let out = "";
    for (let i = 0; i < parts.length; i += 1) {
        out += parts[i];
        if (i < values.length)
            out += values[i];
    }
    return out;
}
export class NotificationSender {
    ctx;
    probeCache;
    /** Per-instance one-shot guard for the "ctx.$ unavailable" warning. */
    warnedNoShell = false;
    constructor(ctx) {
        this.ctx = ctx;
    }
    async send(args) {
        const $ = this.ctx.$;
        if (typeof $ !== "function") {
            this.warnOnceNoShell();
            return;
        }
        const probe = await this.probe($);
        try {
            if (probe.terminalNotifierPath !== null) {
                await $ `${probe.terminalNotifierPath} -title ${args.title} -message ${args.message}`.nothrow().quiet();
                return;
            }
            if (probe.osascriptPath !== null) {
                // Every interpolated value must be an AppleScriptLiteral (produced by
                // appleQuote, which forces escapeAppleScriptText). Adding a new field
                // like `subtitle` to the template without going through appleQuote is
                // a TypeScript error — defense-in-depth against forgetting the escape.
                const script = appleScript `display notification ${appleQuote(args.message)} with title ${appleQuote(args.title)}`;
                await $ `${probe.osascriptPath} -e ${script}`.nothrow().quiet();
            }
        }
        catch {
            // Swallow — notification is best-effort.
        }
    }
    async playSound(soundPath) {
        const $ = this.ctx.$;
        if (typeof $ !== "function") {
            this.warnOnceNoShell();
            return;
        }
        try {
            await $ `afplay ${soundPath}`.nothrow().quiet();
        }
        catch {
            // Swallow.
        }
    }
    async probe($) {
        if (this.probeCache !== undefined)
            return this.probeCache;
        const [terminalNotifierPath, osascriptPath] = await Promise.all([
            whichOrNull($, "terminal-notifier"),
            whichOrNull($, "osascript"),
        ]);
        this.probeCache = { osascriptPath, terminalNotifierPath };
        return this.probeCache;
    }
    warnOnceNoShell() {
        if (this.warnedNoShell)
            return;
        this.warnedNoShell = true;
        console.warn("[pantheon/session-notification] ctx.$ unavailable; notifications disabled");
    }
}
async function whichOrNull($, bin) {
    try {
        const result = await $ `which ${bin}`.nothrow().quiet();
        if (result.exitCode !== 0)
            return null;
        const path = (typeof result.stdout === "string" ? result.stdout : result.stdout.toString()).trim();
        return path.length > 0 ? path : null;
    }
    catch {
        return null;
    }
}
