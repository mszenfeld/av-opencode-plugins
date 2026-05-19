import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IdleScheduler } from "../../../src/hooks/session-notification/idle-scheduler.js"

describe("IdleScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("fires onFire after the configured delay", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith("ses_a")
  })

  it("markActivity before the delay cancels the timer", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    await vi.advanceTimersByTimeAsync(500)
    s.markActivity("ses_a")
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it("cancel before the delay cancels the timer", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    s.cancel("ses_a")
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it("cancel after onFire has fired is a no-op", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    await vi.advanceTimersByTimeAsync(1500)
    expect(() => s.cancel("ses_a")).not.toThrow()
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it("markActivity for an unknown session is a no-op", () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    expect(() => s.markActivity("ses_unknown")).not.toThrow()
  })

  it("re-scheduling resets the timer", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    await vi.advanceTimersByTimeAsync(1000)
    s.schedule("ses_a") // reset
    await vi.advanceTimersByTimeAsync(1000) // total 2000 from first schedule, but only 1000 from reset
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500) // now 1500 from reset
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it("tracks multiple sessions independently", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    s.schedule("ses_b")
    s.markActivity("ses_a")
    await vi.advanceTimersByTimeAsync(1500)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith("ses_b")
  })

  it("awaits async onFire without rethrowing", async () => {
    const onFire = vi.fn(async () => {
      throw new Error("boom")
    })
    const s = new IdleScheduler(100, onFire)
    s.schedule("ses_a")
    await vi.advanceTimersByTimeAsync(100)
    // Allow the swallowed promise rejection to settle.
    await Promise.resolve()
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})
