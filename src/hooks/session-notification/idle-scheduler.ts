export type IdleSchedulerFire = (sessionId: string) => void | Promise<void>

export class IdleScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly delayMs: number,
    private readonly onFire: IdleSchedulerFire,
  ) {}

  schedule(sessionId: string): void {
    this.cancel(sessionId)
    const timer = setTimeout(() => {
      this.timers.delete(sessionId)
      // Swallow rejections from async onFire so the timer callback never
      // surfaces unhandled-rejection noise to OpenCode's event loop.
      // Log via console.error to match the orchestrator's diagnostic convention
      // and avoid silently dropping failures.
      void Promise.resolve(this.onFire(sessionId)).catch((err) =>
        console.error("[pantheon/idle-scheduler] onFire rejected", err),
      )
    }, this.delayMs)
    this.timers.set(sessionId, timer)
  }

  markActivity(sessionId: string): void {
    this.cancel(sessionId)
  }

  cancel(sessionId: string): void {
    const existing = this.timers.get(sessionId)
    if (existing !== undefined) {
      clearTimeout(existing)
      this.timers.delete(sessionId)
    }
  }
}
