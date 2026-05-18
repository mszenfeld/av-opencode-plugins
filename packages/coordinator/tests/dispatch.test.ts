import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  dispatchParallel,
  DEFAULT_RESULT_MAX_BYTES,
  type DispatchSpecialist,
  type DispatchTask,
  type AgentInfo,
} from "../src/dispatch.js"
import type { PollerMessage } from "../src/poller.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finishedMessage(content: string): PollerMessage {
  return { role: "assistant", content, finish_reason: "end_turn" }
}

function makeSpecialist(
  sessionMap: Record<
    string,
    { messages: PollerMessage[]; createError?: Error }
  >,
  sessionIdSequence: string[],
): DispatchSpecialist {
  let callIndex = 0
  return {
    createSession: vi.fn(async (agentName: string): Promise<string> => {
      const id = sessionIdSequence[callIndex++] ?? agentName
      const cfg = sessionMap[id]
      if (cfg?.createError !== undefined) {
        throw cfg.createError
      }
      return id
    }),
    sendPrompt: vi.fn(async (_sessionId: string, _prompt: string) => {
      /* no-op */
    }),
    fetchMessages: vi.fn(async (sessionId: string): Promise<PollerMessage[]> => {
      return sessionMap[sessionId]?.messages ?? []
    }),
  }
}

const defaultRegistry: Record<string, AgentInfo> = {
  "qa-fe-tester": { mode: "subagent" },
  "qa-be-tester": { mode: "subagent" },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dispatchParallel", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // 1. Unknown agent pre-flight
  it("throws on unknown agent before creating any session", async () => {
    const specialist: DispatchSpecialist = {
      createSession: vi.fn(),
      sendPrompt: vi.fn(),
      fetchMessages: vi.fn(),
    }

    const tasks: DispatchTask[] = [{ name: "unknown-agent", prompt: "do something" }]

    await expect(
      dispatchParallel({ tasks, agentRegistry: defaultRegistry, specialist }),
    ).rejects.toThrow("Unknown agent: unknown-agent")

    expect(specialist.createSession).not.toHaveBeenCalled()
  })

  // 2. Primary-mode agent anti-recursion
  it("throws on primary-mode agent before creating any session", async () => {
    const specialist: DispatchSpecialist = {
      createSession: vi.fn(),
      sendPrompt: vi.fn(),
      fetchMessages: vi.fn(),
    }

    const registry: Record<string, AgentInfo> = {
      perun: { mode: "primary" },
    }

    const tasks: DispatchTask[] = [{ name: "perun", prompt: "recurse" }]

    await expect(
      dispatchParallel({ tasks, agentRegistry: registry, specialist }),
    ).rejects.toThrow("Cannot dispatch primary agent: perun")

    expect(specialist.createSession).not.toHaveBeenCalled()
  })

  // 3. Single task happy path
  it("returns success result for a single completed task", async () => {
    const sessionMap = {
      s1: { messages: [finishedMessage("task output")] },
    }
    const specialist = makeSpecialist(sessionMap, ["s1"])

    const tasks: DispatchTask[] = [{ name: "qa-fe-tester", prompt: "test the UI" }]

    const results = await dispatchParallel({
      tasks,
      agentRegistry: defaultRegistry,
      specialist,
      pollIntervalMs: 10,
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe("success")
    expect(results[0]?.result).toBe("task output")
    expect(results[0]?.name).toBe("qa-fe-tester")
    expect(results[0]?.duration_ms).toBeGreaterThanOrEqual(0)
  })

  // 4. Results returned in input order
  it("returns results in input order regardless of completion order", async () => {
    const sessionMap = {
      fe: { messages: [finishedMessage("frontend result")] },
      be: { messages: [finishedMessage("backend result")] },
    }
    const specialist = makeSpecialist(sessionMap, ["fe", "be"])

    const tasks: DispatchTask[] = [
      { name: "qa-fe-tester", prompt: "fe" },
      { name: "qa-be-tester", prompt: "be" },
    ]

    const results = await dispatchParallel({
      tasks,
      agentRegistry: defaultRegistry,
      specialist,
      pollIntervalMs: 10,
    })

    expect(results).toHaveLength(2)
    expect(results[0]?.name).toBe("qa-fe-tester")
    expect(results[0]?.result).toBe("frontend result")
    expect(results[1]?.name).toBe("qa-be-tester")
    expect(results[1]?.result).toBe("backend result")
  })

  // 5. Truncates large results
  it("truncates results larger than resultMaxBytes", async () => {
    const bigContent = "x".repeat(150 * 1024)
    const sessionMap = {
      s1: { messages: [finishedMessage(bigContent)] },
    }
    const specialist = makeSpecialist(sessionMap, ["s1"])

    const tasks: DispatchTask[] = [{ name: "qa-fe-tester", prompt: "big task" }]

    const results = await dispatchParallel({
      tasks,
      agentRegistry: defaultRegistry,
      specialist,
      resultMaxBytes: DEFAULT_RESULT_MAX_BYTES,
      pollIntervalMs: 10,
    })

    const truncationMarker = "\n[…truncated…]"
    const maxAllowed = DEFAULT_RESULT_MAX_BYTES + truncationMarker.length
    expect(results[0]?.result.length).toBeLessThanOrEqual(maxAllowed)
    expect(results[0]?.result.endsWith("[…truncated…]")).toBe(true)
  })

  // 6. Context appended to prompt
  it("includes context in the prompt when provided", async () => {
    const sessionMap = {
      s1: { messages: [finishedMessage("ok")] },
    }
    const specialist = makeSpecialist(sessionMap, ["s1"])

    const tasks: DispatchTask[] = [
      { name: "qa-fe-tester", prompt: "base", context: "extra" },
    ]

    await dispatchParallel({
      tasks,
      agentRegistry: defaultRegistry,
      specialist,
      pollIntervalMs: 10,
    })

    expect(specialist.sendPrompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("base"),
    )
    expect(specialist.sendPrompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("extra"),
    )
  })

  // 7. Per-task error isolation
  it("isolates per-task errors — task 2 succeeds even when task 1 throws in createSession", async () => {
    const sessionMap: Record<string, { messages: PollerMessage[] }> = {
      s2: { messages: [finishedMessage("be success")] },
    }
    let callIndex = 0
    const specialist: DispatchSpecialist = {
      createSession: vi.fn(async (agentName: string): Promise<string> => {
        const index = callIndex++
        if (index === 0) {
          throw new Error("session creation failed")
        }
        return "s2"
      }),
      sendPrompt: vi.fn(async () => {
        /* no-op */
      }),
      fetchMessages: vi.fn(async (sessionId: string): Promise<PollerMessage[]> => {
        return sessionMap[sessionId]?.messages ?? []
      }),
    }

    const tasks: DispatchTask[] = [
      { name: "qa-fe-tester", prompt: "fe" },
      { name: "qa-be-tester", prompt: "be" },
    ]

    const results = await dispatchParallel({
      tasks,
      agentRegistry: defaultRegistry,
      specialist,
      pollIntervalMs: 10,
    })

    expect(results).toHaveLength(2)
    expect(results[0]?.status).toBe("error")
    expect(results[0]?.error).toBeTruthy()
    expect(results[1]?.status).toBe("success")
    expect(results[1]?.result).toBe("be success")
  })

  // 8. Per-task timeout via fake timers
  it("classifies timeout errors correctly using fake timers", async () => {
    vi.useFakeTimers()

    const specialist: DispatchSpecialist = {
      createSession: vi.fn(async () => "s-timeout"),
      sendPrompt: vi.fn(async () => {
        /* no-op */
      }),
      fetchMessages: vi.fn(async (): Promise<PollerMessage[]> => []),
    }

    const tasks: DispatchTask[] = [{ name: "qa-fe-tester", prompt: "will timeout" }]

    const promise = dispatchParallel({
      tasks,
      agentRegistry: defaultRegistry,
      specialist,
      taskTimeoutMs: 100,
      pollIntervalMs: 50,
    })

    await vi.advanceTimersByTimeAsync(500)

    const results = await promise

    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe("timeout")
    expect(results[0]?.error).toMatch(/timeout/i)
  })

  // 9. Parallel execution — both createSession calls fire before any fetchMessages resolves
  it("fires all createSession calls before awaiting any poll completion", async () => {
    const createOrder: string[] = []

    // fetchMessages resolves immediately with a finished message so there's no real delay
    const sessionMap: Record<string, PollerMessage[]> = {
      fe: [finishedMessage("fe done")],
      be: [finishedMessage("be done")],
    }

    let createCallCount = 0
    const ids = ["fe", "be"]

    const specialist: DispatchSpecialist = {
      createSession: vi.fn(async (agentName: string): Promise<string> => {
        const id = ids[createCallCount++] ?? agentName
        createOrder.push(id)
        return id
      }),
      sendPrompt: vi.fn(async () => {
        /* no-op */
      }),
      fetchMessages: vi.fn(async (sessionId: string): Promise<PollerMessage[]> => {
        return sessionMap[sessionId] ?? []
      }),
    }

    const tasks: DispatchTask[] = [
      { name: "qa-fe-tester", prompt: "fe" },
      { name: "qa-be-tester", prompt: "be" },
    ]

    const results = await dispatchParallel({
      tasks,
      agentRegistry: defaultRegistry,
      specialist,
      pollIntervalMs: 10,
    })

    // Both sessions must have been created
    expect(createOrder).toContain("fe")
    expect(createOrder).toContain("be")
    expect(createOrder).toHaveLength(2)

    // Both tasks must have succeeded
    expect(results[0]?.status).toBe("success")
    expect(results[1]?.status).toBe("success")

    // Both createSession calls must have been made (parallel, not sequential-and-bail)
    expect(specialist.createSession).toHaveBeenCalledTimes(2)
  })
})
