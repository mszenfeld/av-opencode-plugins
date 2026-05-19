export class IdleScheduler {
    delayMs;
    onFire;
    timers = new Map();
    constructor(delayMs, onFire) {
        this.delayMs = delayMs;
        this.onFire = onFire;
    }
    schedule(sessionId) {
        this.cancel(sessionId);
        const timer = setTimeout(() => {
            this.timers.delete(sessionId);
            // Swallow rejections from async onFire so the timer callback never
            // surfaces unhandled-rejection noise to OpenCode's event loop.
            void Promise.resolve(this.onFire(sessionId)).catch(() => undefined);
        }, this.delayMs);
        this.timers.set(sessionId, timer);
    }
    markActivity(sessionId) {
        this.cancel(sessionId);
    }
    cancel(sessionId) {
        const existing = this.timers.get(sessionId);
        if (existing !== undefined) {
            clearTimeout(existing);
            this.timers.delete(sessionId);
        }
    }
}
