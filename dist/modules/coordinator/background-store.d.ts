interface BackgroundTask {
    id: string;
    childSessionId: string;
    parentSessionId: string;
    agent: string;
    startedAt: number;
}
/**
 * In-memory registry of running background tasks, keyed by task id and scoped
 * by parent session. Holds the parent->child mapping only — no results, no
 * proactive completion detection (status is derived at collect time by polling
 * the child session). Constructed once per coordinator plugin factory and shared
 * by the three background tools.
 */
declare class BackgroundTaskStore {
    private readonly tasks;
    register(task: BackgroundTask): void;
    get(id: string): BackgroundTask | undefined;
    listByParent(parentSessionId: string): BackgroundTask[];
    countRunningByParent(parentSessionId: string): number;
    remove(id: string): void;
    removeByChild(childSessionId: string): void;
    clearParent(parentSessionId: string): void;
}

export { type BackgroundTask, BackgroundTaskStore };
