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
     * @internal
     * Reserved for v2: flips the role of a previously-registered session to "subagent"
     * when parentSessionID becomes available. See TODO in session-notification.ts.
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
