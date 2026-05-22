interface PollerMessage {
    role: string;
    content: string;
    finish_reason?: string | null | undefined;
}
interface PollUntilIdleOptions {
    fetchMessages: () => Promise<PollerMessage[]>;
    timeoutMs: number;
    pollIntervalMs: number;
    /**
     * Optional abort signal. When the signal aborts during polling (or during
     * the inter-poll sleep), `pollUntilIdle` throws `PollerAbortError` within
     * one poll-interval — see COMPOSITE-3 / ARCH-001. This is how the
     * coordinator surfaces `ToolContext.abort` to in-flight child sessions.
     */
    signal?: AbortSignal;
    /**
     * Optional byte-level cap on the polled assistant content (UTF-8 bytes).
     * When set, `pollUntilIdle` truncates the LAST message's content using a
     * UTF-8-safe slice before returning it as the result. Together with the
     * adapter's projection in `createSDKSpecialist.fetchMessages` (which
     * returns at most a single message — the latest one — see PERF-001), this
     * provides a true per-poll memory bound: each poll allocates O(maxBytes)
     * rather than O(transcript-length). See COMPOSITE-3 / SEC-010 / PERF-001.
     */
    maxBytes?: number;
}
declare class PollerTimeoutError extends Error {
    readonly kind: "timeout";
    readonly elapsedMs: number;
    constructor(elapsedMs: number);
}
declare class PollerAbortError extends Error {
    readonly kind: "abort";
    readonly elapsedMs: number;
    constructor(elapsedMs: number);
}
declare function pollUntilIdle(options: PollUntilIdleOptions): Promise<string>;

export { type PollUntilIdleOptions, PollerAbortError, type PollerMessage, PollerTimeoutError, pollUntilIdle };
