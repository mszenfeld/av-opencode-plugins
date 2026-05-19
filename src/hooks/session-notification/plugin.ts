import type { Plugin } from "@opencode-ai/plugin"
import { readConfigFromEnv } from "./env-config.js"
import type { NotificationSenderContext } from "./notification-sender.js"
import { createSessionNotification } from "./session-notification.js"

export const AppVerkPantheonPlugin: Plugin = async (ctx) => {
  if (process.env.AV_PANTHEON_NOTIFY === "0") {
    return {}
  }
  const config = readConfigFromEnv(process.env)
  // OpenCode's PluginInput.$ is Bun's `$`, whose parameter type is tighter
  // than our structural ShellTag. The cast is safe at runtime — both shapes
  // expose the same tagged-template shell with `.quiet()` / `.nothrow()`.
  const handler = createSessionNotification(ctx as unknown as NotificationSenderContext, config)
  return { event: handler }
}
