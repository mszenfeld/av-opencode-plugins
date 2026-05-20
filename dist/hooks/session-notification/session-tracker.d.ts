declare class SessionTracker {
    private mainSessionId;
    private readonly subagents;
    registerSession(id: string): void;
    /**
     * @experimental Reserved for v2 parentSessionID wiring.
     * Currently NOT called by the orchestrator — v1 uses a first-session-wins
     * heuristic in {@link registerSession}. This method flips the role of a
     * previously-registered session to "subagent" once `parentSessionID`
     * detection lands.
     *
     * Cross-references:
     * - `TODO(pantheon-v2)` in `src/hooks/session-notification/session-notification.ts`
     *   (inside `handleSessionCreated`)
     * - "Out of scope (today)" in `docs/plugins/pantheon.md`
     *
     * @internal
     */
    markAsSubagent(id: string): void;
    deleteSession(id: string): void;
    isMain(id: string): boolean;
    isSubagent(id: string): boolean;
}

export { SessionTracker };
