export interface ShellOutput {
    readonly exitCode: number;
    readonly stdout: string | {
        toString(): string;
    };
}
export type ShellChain = Promise<ShellOutput> & {
    quiet(): ShellChain;
    nothrow(): ShellChain;
};
export type ShellTag = (parts: TemplateStringsArray, ...values: unknown[]) => ShellChain;
export interface NotificationSenderContext {
    readonly $?: ShellTag;
}
export declare function escapeAppleScriptText(input: string): string;
export declare class NotificationSender {
    private readonly ctx;
    private probeCache;
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
