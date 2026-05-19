export declare class SessionTracker {
    private mainSessionId;
    private readonly subagents;
    registerSession(id: string): void;
    markAsSubagent(id: string): void;
    deleteSession(id: string): void;
    isMain(id: string): boolean;
    isSubagent(id: string): boolean;
}
