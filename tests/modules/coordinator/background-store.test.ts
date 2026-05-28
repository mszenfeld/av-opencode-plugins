import { describe, expect, it } from "vitest"
import {
  BackgroundTaskStore,
  type BackgroundTask,
} from "../../../src/modules/coordinator/background-store.js"

function task(over: Partial<BackgroundTask> & { id: string }): BackgroundTask {
  return {
    id: over.id,
    childSessionId: over.childSessionId ?? `child-${over.id}`,
    parentSessionId: over.parentSessionId ?? "parent-1",
    agent: over.agent ?? "triglav",
    startedAt: over.startedAt ?? 1000,
  }
}

describe("BackgroundTaskStore", () => {
  it("registers and gets a task", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1" }))
    expect(s.get("bg_1")?.agent).toBe("triglav")
    expect(s.get("nope")).toBeUndefined()
  })

  it("counts running tasks per parent", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", parentSessionId: "p1" }))
    s.register(task({ id: "bg_2", parentSessionId: "p1" }))
    s.register(task({ id: "bg_3", parentSessionId: "p2" }))
    expect(s.countRunningByParent("p1")).toBe(2)
    expect(s.countRunningByParent("p2")).toBe(1)
    expect(s.countRunningByParent("p3")).toBe(0)
  })

  it("remove frees the count (post-collect slot reuse)", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", parentSessionId: "p1" }))
    s.remove("bg_1")
    expect(s.countRunningByParent("p1")).toBe(0)
    expect(s.get("bg_1")).toBeUndefined()
  })

  it("removeByChild removes the task owning that child session", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", childSessionId: "c1" }))
    s.removeByChild("c1")
    expect(s.get("bg_1")).toBeUndefined()
  })

  it("clearParent removes all of a parent's tasks", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", parentSessionId: "p1" }))
    s.register(task({ id: "bg_2", parentSessionId: "p1" }))
    s.register(task({ id: "bg_3", parentSessionId: "p2" }))
    s.clearParent("p1")
    expect(s.countRunningByParent("p1")).toBe(0)
    expect(s.countRunningByParent("p2")).toBe(1)
  })

  it("listByParent returns only that parent's tasks", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", parentSessionId: "p1" }))
    s.register(task({ id: "bg_2", parentSessionId: "p2" }))
    expect(s.listByParent("p1").map((t) => t.id)).toEqual(["bg_1"])
  })
})
