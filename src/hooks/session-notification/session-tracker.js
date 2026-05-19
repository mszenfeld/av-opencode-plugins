export class SessionTracker {
    mainSessionId;
    subagents = new Set();
    registerSession(id) {
        if (this.mainSessionId === undefined) {
            this.mainSessionId = id;
            return;
        }
        if (id === this.mainSessionId)
            return;
        this.subagents.add(id);
    }
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
    markAsSubagent(id) {
        if (this.mainSessionId === id) {
            this.mainSessionId = undefined;
        }
        this.subagents.add(id);
    }
    deleteSession(id) {
        if (this.mainSessionId === id) {
            this.mainSessionId = undefined;
        }
        this.subagents.delete(id);
    }
    isMain(id) {
        return this.mainSessionId === id;
    }
    isSubagent(id) {
        return this.subagents.has(id);
    }
}
