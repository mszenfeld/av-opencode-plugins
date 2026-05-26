import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createSessionNotification,
  type SessionNotificationConfig,
} from "../../../src/hooks/session-notification/session-notification.js"
import { SessionTracker } from "../../../src/hooks/session-notification/session-tracker.js"
import { IdleScheduler } from "../../../src/hooks/session-notification/idle-scheduler.js"
import { NotificationSender } from "../../../src/hooks/session-notification/notification-sender.js"

const CONFIG: SessionNotificationConfig = {
  title: "AppVerk",
  idleMessage: "ready",
  questionMessage: "question",
  permissionMessage: "permission",
  idleConfirmationDelayMs: 1500,
  playSound: false,
  soundPath: "/Sound.aiff",
}

function buildHarness(config: SessionNotificationConfig = CONFIG) {
  const tracker = new SessionTracker()
  const sender = new NotificationSender({})
  const sendSpy = vi.spyOn(sender, "send").mockResolvedValue(undefined)
  const playSpy = vi.spyOn(sender, "playSound").mockResolvedValue(undefined)
  const scheduler = new IdleScheduler(config.idleConfirmationDelayMs, () => undefined)
  const scheduleSpy = vi.spyOn(scheduler, "schedule")
  const markActivitySpy = vi.spyOn(scheduler, "markActivity")
  const cancelSpy = vi.spyOn(scheduler, "cancel")
  const handler = createSessionNotification({}, config, { tracker, scheduler, sender })
  return { handler, tracker, scheduler, sender, sendSpy, playSpy, scheduleSpy, markActivitySpy, cancelSpy }
}

describe("createSessionNotification", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("registers a session on session.created", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    expect(h.tracker.isMain("ses_main")).toBe(true)
  })

  it("schedules an idle notification for the main session", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.idle", properties: { sessionID: "ses_main" } } })
    expect(h.scheduleSpy).toHaveBeenCalledWith("ses_main")
  })

  it("does not schedule an idle notification for a subagent session", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_child" } } })
    await h.handler({ event: { type: "session.idle", properties: { sessionID: "ses_child" } } })
    expect(h.scheduleSpy).not.toHaveBeenCalled()
  })

  it("marks activity on message.part.delta", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "message.part.delta", properties: { sessionID: "ses_main" } } })
    expect(h.markActivitySpy).toHaveBeenCalledWith("ses_main")
  })

  it("marks activity on message.updated", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "message.updated", properties: { sessionID: "ses_main" } } })
    expect(h.markActivitySpy).toHaveBeenCalledWith("ses_main")
  })

  it("sends a question notification immediately when AskUserQuestion fires", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: "ses_main", tool: "AskUserQuestion" },
      },
    })
    expect(h.sendSpy).toHaveBeenCalledWith({ title: "AppVerk", message: "question" })
  })

  it("matches the question tool name case-insensitively", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: "ses_main", tool: "ask_user_question" },
      },
    })
    expect(h.sendSpy).toHaveBeenCalledTimes(1)
  })

  it("does not send a question notification for subagent sessions", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_child" } } })
    await h.handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: "ses_child", tool: "AskUserQuestion" },
      },
    })
    expect(h.sendSpy).not.toHaveBeenCalled()
  })

  it("treats non-question tool.execute.before as activity", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: "ses_main", tool: "Read" },
      },
    })
    expect(h.markActivitySpy).toHaveBeenCalledWith("ses_main")
    expect(h.sendSpy).not.toHaveBeenCalled()
  })

  it("sends a permission notification on permission.ask", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "permission.ask", properties: { sessionID: "ses_main" } } })
    expect(h.sendSpy).toHaveBeenCalledWith({ title: "AppVerk", message: "permission" })
  })

  it("filters permission events for subagent sessions", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_child" } } })
    await h.handler({ event: { type: "permission.ask", properties: { sessionID: "ses_child" } } })
    expect(h.sendSpy).not.toHaveBeenCalled()
  })

  it("cleans up on session.deleted", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.deleted", properties: { sessionID: "ses_main" } } })
    expect(h.cancelSpy).toHaveBeenCalledWith("ses_main")
    expect(h.tracker.isMain("ses_main")).toBe(false)
  })

  it("plays a sound when playSound is enabled", async () => {
    const h = buildHarness({ ...CONFIG, playSound: true })
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "permission.ask", properties: { sessionID: "ses_main" } } })
    expect(h.playSpy).toHaveBeenCalledWith("/Sound.aiff")
  })

  it("ignores unknown event types without throwing", async () => {
    const h = buildHarness()
    await expect(
      h.handler({ event: { type: "weird.unknown", properties: { sessionID: "ses_main" } } }),
    ).resolves.toBeUndefined()
  })

  it("ignores events with missing sessionID without throwing", async () => {
    const h = buildHarness()
    await expect(h.handler({ event: { type: "session.idle", properties: undefined } })).resolves.toBeUndefined()
  })

  it("reads sessionID from properties.info as a fallback", async () => {
    const h = buildHarness()
    await h.handler({
      event: { type: "session.created", properties: { info: { sessionID: "ses_main" } } },
    })
    expect(h.tracker.isMain("ses_main")).toBe(true)
  })
})
