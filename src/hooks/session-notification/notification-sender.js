export function escapeAppleScriptText(input) {
    // Order matters: escape backslashes first, then double quotes.
    return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
export class NotificationSender {
    ctx;
    probeCache;
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
                const script = `display notification "${escapeAppleScriptText(args.message)}" ` +
                    `with title "${escapeAppleScriptText(args.title)}"`;
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
        const terminalNotifierPath = await whichOrNull($, "terminal-notifier");
        const osascriptPath = await whichOrNull($, "osascript");
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
