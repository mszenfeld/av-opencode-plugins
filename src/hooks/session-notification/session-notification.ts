import { IdleScheduler } from "./idle-scheduler.js"
import { NotificationSender, type NotificationSenderContext } from "./notification-sender.js"
import { SessionTracker } from "./session-tracker.js"

export interface SessionNotificationConfig {
  title: string
  idleMessage: string
  questionMessage: string
  permissionMessage: string
  idleConfirmationDelayMs: number
  playSound: boolean
  soundPath: string
}

export type SessionNotificationEvent = {
  type: string
  properties?: unknown
}

export interface SessionNotificationDeps {
  tracker?: SessionTracker
  scheduler?: IdleScheduler
  sender?: NotificationSender
}

const QUESTION_TOOL_PATTERN = /^(question|ask_user_question|askuserquestion)$/i

const PERMISSION_EVENT_TYPES = new Set([
  "permission.ask",
  "permission.asked",
  "permission.requested",
  "permission.updated",
])

const ACTIVITY_EVENT_TYPES = new Set([
  "message.updated",
  "message.part.updated",
  "message.part.delta",
])

function readSessionId(properties: unknown): string | undefined {
  if (typeof properties !== "object" || properties === null) return undefined
  const obj = properties as Record<string, unknown>
  if (typeof obj.sessionID === "string") return obj.sessionID
  if (typeof obj.sessionId === "string") return obj.sessionId
  const info = obj.info
  if (typeof info === "object" && info !== null) {
    const i = info as Record<string, unknown>
    if (typeof i.sessionID === "string") return i.sessionID
    if (typeof i.sessionId === "string") return i.sessionId
  }
  return undefined
}

function readToolName(properties: unknown): string | undefined {
  if (typeof properties !== "object" || properties === null) return undefined
  const obj = properties as Record<string, unknown>
  if (typeof obj.tool === "string") return obj.tool
  if (typeof obj.toolName === "string") return obj.toolName
  return undefined
}

export function createSessionNotification(
  ctx: NotificationSenderContext,
  config: SessionNotificationConfig,
  deps: SessionNotificationDeps = {},
): (input: { event: SessionNotificationEvent }) => Promise<void> {
  const tracker = deps.tracker ?? new SessionTracker()
  const sender = deps.sender ?? new NotificationSender(ctx)
  const scheduler =
    deps.scheduler ??
    new IdleScheduler(config.idleConfirmationDelayMs, async () => {
      await sender.send({ title: config.title, message: config.idleMessage })
      if (config.playSound) await sender.playSound(config.soundPath)
    })

  return async ({ event }) => {
    try {
      const sessionId = readSessionId(event.properties)

      if (event.type === "session.created") {
        if (sessionId !== undefined) tracker.registerSession(sessionId)
        return
      }

      if (event.type === "session.deleted") {
        if (sessionId !== undefined) {
          tracker.deleteSession(sessionId)
          scheduler.cancel(sessionId)
        }
        return
      }

      if (sessionId === undefined) return

      if (event.type === "session.idle") {
        if (tracker.isMain(sessionId)) scheduler.schedule(sessionId)
        return
      }

      if (ACTIVITY_EVENT_TYPES.has(event.type)) {
        scheduler.markActivity(sessionId)
        return
      }

      if (event.type === "tool.execute.before") {
        const toolName = readToolName(event.properties)
        if (toolName !== undefined && QUESTION_TOOL_PATTERN.test(toolName)) {
          if (tracker.isMain(sessionId)) {
            await sender.send({ title: config.title, message: config.questionMessage })
            if (config.playSound) await sender.playSound(config.soundPath)
          }
          return
        }
        scheduler.markActivity(sessionId)
        return
      }

      if (event.type === "tool.execute.after") {
        scheduler.markActivity(sessionId)
        return
      }

      if (PERMISSION_EVENT_TYPES.has(event.type)) {
        if (tracker.isMain(sessionId)) {
          await sender.send({ title: config.title, message: config.permissionMessage })
          if (config.playSound) await sender.playSound(config.soundPath)
        }
      }
    } catch (err) {
      console.error("[pantheon/session-notification]", err)
    }
  }
}
