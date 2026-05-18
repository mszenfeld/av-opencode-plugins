import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { pollUntilIdle } from "../src/poller.js"
import type { PollerMessage } from "../src/poller.js"

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
})
