import type { SessionNotificationConfig } from "./session-notification.js"

export const DEFAULT_SESSION_NOTIFICATION_CONFIG: SessionNotificationConfig = {
  title: "AppVerk",
  idleMessage: "Agent is ready for input",
  questionMessage: "Agent is asking a question",
  permissionMessage: "Agent needs permission",
  // 1.5 s: long enough to skip between-tool-call quiet, short enough to feel responsive.
  idleConfirmationDelayMs: 1500,
  playSound: false,
  soundPath: "/System/Library/Sounds/Glass.aiff",
}

export function readConfigFromEnv(env: Record<string, string | undefined>): SessionNotificationConfig {
  const config: SessionNotificationConfig = { ...DEFAULT_SESSION_NOTIFICATION_CONFIG }

  if (typeof env.AV_PANTHEON_NOTIFY_TITLE === "string") {
    config.title = env.AV_PANTHEON_NOTIFY_TITLE
  }
  if (typeof env.AV_PANTHEON_NOTIFY_IDLE_MSG === "string") {
    config.idleMessage = env.AV_PANTHEON_NOTIFY_IDLE_MSG
  }
  if (typeof env.AV_PANTHEON_NOTIFY_QUESTION_MSG === "string") {
    config.questionMessage = env.AV_PANTHEON_NOTIFY_QUESTION_MSG
  }
  if (typeof env.AV_PANTHEON_NOTIFY_PERMISSION_MSG === "string") {
    config.permissionMessage = env.AV_PANTHEON_NOTIFY_PERMISSION_MSG
  }
  if (typeof env.AV_PANTHEON_NOTIFY_DELAY_MS === "string") {
    const raw = env.AV_PANTHEON_NOTIFY_DELAY_MS.trim()
    if (raw.length > 0) {
      const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
      if (Number.isFinite(parsed) && parsed >= 0) {
        config.idleConfirmationDelayMs = parsed
      } else {
        console.warn(
          `[pantheon/session-notification] invalid AV_PANTHEON_NOTIFY_DELAY_MS="${raw}"; using default ${DEFAULT_SESSION_NOTIFICATION_CONFIG.idleConfirmationDelayMs}ms`,
        )
      }
    }
  }
  if (typeof env.AV_PANTHEON_NOTIFY_SOUND === "string") {
    const raw = env.AV_PANTHEON_NOTIFY_SOUND
    if (raw === "1") {
      config.playSound = true
    } else if (raw !== "" && raw !== "0") {
      console.warn(
        `[pantheon/session-notification] unrecognized AV_PANTHEON_NOTIFY_SOUND="${raw}"; expected "1" to enable; treating as disabled`,
      )
    }
  }
  if (typeof env.AV_PANTHEON_NOTIFY_SOUND_PATH === "string") {
    config.soundPath = env.AV_PANTHEON_NOTIFY_SOUND_PATH
  }

  return config
}
