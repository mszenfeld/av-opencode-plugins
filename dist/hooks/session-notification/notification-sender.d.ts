interface ShellOutput {
    readonly exitCode: number;
    readonly stdout: string | {
        toString(): string;
    };
}
type ShellChain = Promise<ShellOutput> & {
    quiet(): ShellChain;
    nothrow(): ShellChain;
};
type ShellTag = (parts: TemplateStringsArray, ...values: string[]) => ShellChain;
interface NotificationSenderContext {
    readonly $?: ShellTag;
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
type AppleScriptLiteral = string & {
    readonly __appleScriptLiteral: unique symbol;
};
declare function escapeAppleScriptText(input: string): string;
/**
 * Returns the input as a fully-quoted AppleScript string literal (including
 * the surrounding `"`), branded as {@link AppleScriptLiteral}. Use this for
 * every value interpolated into an osascript template so that the type system
 * blocks raw-string interpolation paths.
 */
declare function appleQuote(input: string): AppleScriptLiteral;
/**
 * Type-safe osascript template builder. Accepts only {@link AppleScriptLiteral}
 * values for interpolation, so any caller that tries to splice an unescaped
 * string in fails at compile time. The static parts come from the developer-
 * authored template literal and never carry user input.
 */
declare function appleScript(parts: TemplateStringsArray, ...values: readonly AppleScriptLiteral[]): string;
declare class NotificationSender {
    private readonly ctx;
    private probeCache;
    /** Per-instance one-shot guard for the "ctx.$ unavailable" warning. */
    private warnedNoShell;
    constructor(ctx: NotificationSenderContext);
    send(args: {
        title: string;
        message: string;
    }): Promise<void>;
    playSound(soundPath: string): Promise<void>;
    private probe;
    private warnOnceNoShell;
}

export { type AppleScriptLiteral, NotificationSender, type NotificationSenderContext, type ShellChain, type ShellOutput, type ShellTag, appleQuote, appleScript, escapeAppleScriptText };
