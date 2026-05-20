class IdleScheduler {
  constructor(delayMs, onFire) {
    this.delayMs = delayMs;
    this.onFire = onFire;
  }
  delayMs;
  onFire;
  timers = /* @__PURE__ */ new Map();
  schedule(sessionId) {
    this.cancel(sessionId);
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void Promise.resolve(this.onFire(sessionId)).catch(
        (err) => console.error("[pantheon/idle-scheduler] onFire rejected", err)
      );
    }, this.delayMs);
    this.timers.set(sessionId, timer);
  }
  markActivity(sessionId) {
    this.cancel(sessionId);
  }
  cancel(sessionId) {
    const existing = this.timers.get(sessionId);
    if (existing !== void 0) {
      clearTimeout(existing);
      this.timers.delete(sessionId);
    }
  }
}
export {
  IdleScheduler
};
