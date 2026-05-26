declare class SessionTracker {
    private mainSessionId;
    registerSession(id: string): void;
    deleteSession(id: string): void;
    isMain(id: string): boolean;
}

export { SessionTracker };
