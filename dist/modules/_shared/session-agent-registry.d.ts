/**
 * Cross-module registry mapping `childSessionID → agent name`.
 *
 * Owned by the `_shared` layer so both the coordinator (`dispatch_parallel`,
 * which writes entries on task start) and feature modules like QA (whose
 * `shell.env` hook reads entries to resolve agent identity for a given
 * session) can depend on it without inverting the module layering.
 *
 * Registration persists for the OpenCode session lifetime. Cleanup is the
 * responsibility of the plugin that consumes the registry (typically via a
 * `session.deleted` handler) — `dispatch_parallel` does NOT unregister.
 */
declare class SessionAgentRegistry {
    #private;
    register(sessionID: string, agent: string): void;
    unregister(sessionID: string): void;
    lookup(sessionID: string): string | undefined;
}

export { SessionAgentRegistry };
