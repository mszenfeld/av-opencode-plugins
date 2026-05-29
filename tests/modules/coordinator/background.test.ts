import { describe, expect, it, vi } from "vitest"
import { BackgroundTaskStore } from "../../../src/modules/coordinator/background-store.js"
import {
  BACKGROUND_MAX_CONCURRENT,
  collectBackground,
  startBackgroundTask,
} from "../../../src/modules/coordinator/background.js"
import type { DispatchSpecialist, AgentInfo } from "../../../src/modules/coordinator/dispatch.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

const registry: Record<string, AgentInfo> = {
  triglav: { mode: "subagent" },
  perun: { mode: "primary" },
}

function fakeSpecialist(over: Partial<DispatchSpecialist> = {}): DispatchSpecialist {
  return {
    startTask: vi.fn(async () => "unused"),
    startBackground: vi.fn(async () => `child-${Math.random().toString(36).slice(2, 8)}`),
    fetchMessages: vi.fn(async (): Promise<PollerMessage[]> => []),
    abortTask: vi.fn(async () => {}),
    ...over,
  }
}

const idleMsg = (text: string): PollerMessage[] => [
  { role: "assistant", content: text, finish_reason: "stop" },
]
const runningMsg = (): PollerMessage[] => [
  { role: "assistant", content: "thinking", finish_reason: null },
]

describe("startBackgroundTask", () => {
  it("validates the agent and rejects a non-subagent", async () => {
    const store = new BackgroundTaskStore()
    await expect(
      startBackgroundTask({ store, specialist: fakeSpecialist(), agentRegistry: registry, parentSessionId: "p1", agent: "perun", prompt: "x" }),
    ).rejects.toThrow(/Cannot dispatch primary/)
    expect(store.countRunningByParent("p1")).toBe(0)
  })

  it("registers a running task and returns an id", async () => {
    const store = new BackgroundTaskStore()
    const r = await startBackgroundTask({ store, specialist: fakeSpecialist(), agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "explore" })
    expect(r.status).toBe("running")
    expect(r.id).toMatch(/^bg_/)
    expect(store.countRunningByParent("p1")).toBe(1)
  })

  it("throws at the per-parent cap and registers nothing extra", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist()
    for (let i = 0; i < BACKGROUND_MAX_CONCURRENT; i++) {
      await startBackgroundTask({ store, specialist: spec, agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "x" })
    }
    await expect(
      startBackgroundTask({ store, specialist: spec, agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "x" }),
    ).rejects.toThrow(/max 4 background tasks/)
    expect(store.countRunningByParent("p1")).toBe(BACKGROUND_MAX_CONCURRENT)
  })

  it("does not register when startBackground rejects", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ startBackground: vi.fn(async () => { throw new Error("create failed") }) })
    await expect(
      startBackgroundTask({ store, specialist: spec, agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "x" }),
    ).rejects.toThrow(/create failed/)
    expect(store.countRunningByParent("p1")).toBe(0)
  })
})

describe("startBackgroundTask callerMode gating", () => {
  it("starts an allowlisted all-agent in background only when callerMode is primary", async () => {
    const store = new BackgroundTaskStore()
    const specialist = fakeSpecialist()
    const agentRegistry = { veles: { mode: "all" as const } }
    await expect(
      startBackgroundTask({
        store, specialist, agentRegistry,
        parentSessionId: "s1", agent: "veles", prompt: "plan", callerMode: "primary",
      }),
    ).resolves.toMatchObject({ agent: "veles", status: "running" })
    await expect(
      startBackgroundTask({
        store, specialist, agentRegistry,
        parentSessionId: "s1", agent: "veles", prompt: "plan", callerMode: "all",
      }),
    ).rejects.toThrow(/Cannot dispatch all agent: veles/)
  })
})

describe("collectBackground", () => {
  async function seed(store: BackgroundTaskStore, spec: DispatchSpecialist) {
    return startBackgroundTask({ store, specialist: spec, agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "x" })
  }

  it("poll (non-block) returns running when the child isn't idle", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => runningMsg()) })
    const { id } = await seed(store, spec)
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: false })
    expect(r?.status).toBe("running")
    expect(store.get(id)).toBeDefined() // poll does not remove
  })

  it("poll returns success + result when the child is idle", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => idleMsg("done!")) })
    const { id } = await seed(store, spec)
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: false })
    expect(r?.status).toBe("success")
    expect(r?.result).toContain("done!")
  })

  it("poll returns not_found for an unknown id", async () => {
    const store = new BackgroundTaskStore()
    const [r] = await collectBackground({ store, specialist: fakeSpecialist(), ids: ["bg_ghost"], block: false })
    expect(r?.status).toBe("not_found")
  })

  it("wait (block) returns success and removes the task", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => idleMsg("ok")) })
    const { id } = await seed(store, spec)
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: true, pollIntervalMs: 1 })
    expect(r?.status).toBe("success")
    expect(store.get(id)).toBeUndefined() // collected = removed
  })

  it("wait times out and removes the task", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => runningMsg()) })
    const { id } = await seed(store, spec)
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: true, timeoutMs: 5, pollIntervalMs: 1 })
    expect(r?.status).toBe("timeout")
    expect(store.get(id)).toBeUndefined()
  })

  it("wait abort kills the child and removes the task", async () => {
    const store = new BackgroundTaskStore()
    const abortTask = vi.fn(async () => {})
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => runningMsg()), abortTask })
    const { id } = await seed(store, spec)
    const ac = new AbortController()
    ac.abort()
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: true, signal: ac.signal, pollIntervalMs: 1 })
    expect(r?.status).toBe("aborted")
    expect(abortTask).toHaveBeenCalledTimes(1)
    expect(store.get(id)).toBeUndefined()
  })
})
