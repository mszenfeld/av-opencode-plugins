type IdleSchedulerFire = (sessionId: string) => void | Promise<void>;
declare class IdleScheduler {
    private readonly delayMs;
    private readonly onFire;
    private readonly timers;
    constructor(delayMs: number, onFire: IdleSchedulerFire);
    schedule(sessionId: string): void;
    markActivity(sessionId: string): void;
    cancel(sessionId: string): void;
}

export { IdleScheduler, type IdleSchedulerFire };
