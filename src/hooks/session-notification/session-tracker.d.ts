export declare class SessionTracker {
    private mainSessionId;
    private readonly subagents;
    registerSession(id: string): void;
    /**
     * @internal
     * Reserved for v2: flips the role of a previously-registered session to "subagent"
     * when parentSessionID becomes available. See TODO in session-notification.ts.
     */
    markAsSubagent(id: string): void;
    deleteSession(id: string): void;
    isMain(id: string): boolean;
    isSubagent(id: string): boolean;
}
