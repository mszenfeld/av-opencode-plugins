import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { pollUntilIdle, PollerAbortError } from "../../../src/modules/coordinator/poller.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

describe("pollUntilIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves when assistant message has finish_reason", async () => {
    const messages: PollerMessage[] = [
      { role: "assistant", content: "done", finish_reason: "end_turn" },
    ]
    const fetchMessages = vi.fn().mockResolvedValue(messages)

    const result = await pollUntilIdle({
      fetchMessages,
      timeoutMs: 1000,
      pollIntervalMs: 50,
    })

    expect(result).toBe("done")
  })

  it("returns empty string when finished message has no content", async () => {
    const messages: PollerMessage[] = [
      { role: "assistant", content: "", finish_reason: "end_turn" },
    ]
    const fetchMessages = vi.fn().mockResolvedValue(messages)

    const result = await pollUntilIdle({
      fetchMessages,
      timeoutMs: 1000,
      pollIntervalMs: 50,
    })

    expect(result).toBe("")
  })

  it("polls until finish_reason appears", async () => {
    let callCount = 0
    const fetchMessages = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount < 3) {
        return []
      }
      return [{ role: "assistant", content: "final answer", finish_reason: "end_turn" }]
    })

    const pollIntervalMs = 100
    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 5000,
      pollIntervalMs,
    })

    await vi.advanceTimersByTimeAsync(pollIntervalMs)
    await vi.advanceTimersByTimeAsync(pollIntervalMs)

    const result = await promise

    expect(result).toBe("final answer")
    expect(fetchMessages).toHaveBeenCalledTimes(3)
  })

  it("rejects on timeout", async () => {
    const fetchMessages = vi.fn().mockResolvedValue([])

    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 100,
      pollIntervalMs: 50,
    })

    const rejection = expect(promise).rejects.toThrow("timeout")
    await vi.advanceTimersByTimeAsync(200)
    await rejection
  })

  it("ignores non-assistant final messages", async () => {
    let callCount = 0
    const fetchMessages = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return [{ role: "user", content: "test" }]
      }
      return [{ role: "assistant", content: "response", finish_reason: "end_turn" }]
    })

    const pollIntervalMs = 100
    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 5000,
      pollIntervalMs,
    })

    await vi.advanceTimersByTimeAsync(pollIntervalMs)

    const result = await promise

    expect(result).toBe("response")
    expect(fetchMessages).toHaveBeenCalledTimes(2)
  })

  it("ignores assistant messages without finish_reason", async () => {
    let callCount = 0
    const fetchMessages = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return [{ role: "assistant", content: "partial", finish_reason: null }]
      }
      return [{ role: "assistant", content: "complete", finish_reason: "end_turn" }]
    })

    const pollIntervalMs = 100
    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 5000,
      pollIntervalMs,
    })

    await vi.advanceTimersByTimeAsync(pollIntervalMs)

    const result = await promise

    expect(result).toBe("complete")
    expect(fetchMessages).toHaveBeenCalledTimes(2)
  })

  it("propagates fetchMessages errors", async () => {
    const fetchMessages = vi.fn().mockRejectedValue(new Error("network fail"))

    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 1000,
      pollIntervalMs: 50,
    })

    await expect(promise).rejects.toThrow("network fail")
  })

  it("throws PollerAbortError when signal is already aborted on entry", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMessages = vi.fn().mockResolvedValue([])

    await expect(
      pollUntilIdle({
        fetchMessages,
        timeoutMs: 1000,
        pollIntervalMs: 50,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(PollerAbortError)

    // Loop bailed before fetching.
    expect(fetchMessages).not.toHaveBeenCalled()
  })

  it("throws PollerAbortError when signal aborts during the inter-poll sleep", async () => {
    const controller = new AbortController()
    // Never finishes — keeps the poller looping until the abort fires.
    const fetchMessages = vi.fn().mockResolvedValue([])

    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 60_000,
      pollIntervalMs: 100,
      signal: controller.signal,
    })

    // Attach the rejection assertion *before* triggering the abort so Vitest
    // never sees an unhandled-rejection blip while the microtask queue drains.
    const assertion = expect(promise).rejects.toBeInstanceOf(PollerAbortError)

    // First poll runs, then enters the inter-poll sleep.
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)

    await assertion
  })

  it("truncates oversized polled content by UTF-8 bytes when maxBytes is set", async () => {
    // 200 × "ż" → 400 UTF-8 bytes, 200 UTF-16 code units. With maxBytes=128
    // the byte length is clearly over, so we must truncate even though the
    // UTF-16 .length is under-reading.
    const heavy = "ż".repeat(200)
    const messages: PollerMessage[] = [
      { role: "assistant", content: heavy, finish_reason: "end_turn" },
    ]
    const fetchMessages = vi.fn().mockResolvedValue(messages)

    const result = await pollUntilIdle({
      fetchMessages,
      timeoutMs: 1000,
      pollIntervalMs: 50,
      maxBytes: 128,
    })

    const truncationMarker = "\n[…truncated…]"
    expect(result.endsWith(truncationMarker)).toBe(true)
    const body = result.slice(0, result.length - truncationMarker.length)
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(128)
    expect(body).not.toContain("�")
  })
})
