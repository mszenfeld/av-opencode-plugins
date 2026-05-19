import { describe, expect, it } from "vitest"
import { SessionTracker } from "../../../src/hooks/session-notification/session-tracker.js"

describe("SessionTracker", () => {
  it("treats an unknown session as neither main nor subagent", () => {
    const t = new SessionTracker()
    expect(t.isMain("ses_a")).toBe(false)
    expect(t.isSubagent("ses_a")).toBe(false)
  })

  it("marks the first registered session as main", () => {
    const t = new SessionTracker()
    t.registerSession("ses_a")
    expect(t.isMain("ses_a")).toBe(true)
    expect(t.isSubagent("ses_a")).toBe(false)
  })

  it("marks subsequent registered sessions as subagents", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.registerSession("ses_child")
    expect(t.isMain("ses_child")).toBe(false)
    expect(t.isSubagent("ses_child")).toBe(true)
    expect(t.isMain("ses_main")).toBe(true)
  })

  it("is idempotent for the same main session ID", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.registerSession("ses_main")
    expect(t.isMain("ses_main")).toBe(true)
    expect(t.isSubagent("ses_main")).toBe(false)
  })

  it("markAsSubagent demotes the main session", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.markAsSubagent("ses_main")
    expect(t.isMain("ses_main")).toBe(false)
    expect(t.isSubagent("ses_main")).toBe(true)
  })

  it("deleteSession clears main and subagent state for that ID", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.registerSession("ses_child")
    t.deleteSession("ses_main")
    t.deleteSession("ses_child")
    expect(t.isMain("ses_main")).toBe(false)
    expect(t.isSubagent("ses_child")).toBe(false)
  })

  it("after main is deleted, the next registerSession becomes the new main", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.deleteSession("ses_main")
    t.registerSession("ses_next")
    expect(t.isMain("ses_next")).toBe(true)
  })
})
