import type { Plugin } from "@opencode-ai/plugin"
import { readConfigFromEnv } from "./env-config.js"
import type { NotificationSenderContext } from "./notification-sender.js"
import { createSessionNotification } from "./session-notification.js"

export const AppVerkPantheonPlugin: Plugin = async (ctx) => {
  if (process.env.AV_PANTHEON_NOTIFY === "0") {
    return {}
  }
  const config = readConfigFromEnv(process.env)
  // OpenCode's `PluginInput.$` is Bun's `BunShell` / `BunShellPromise`, whose
  // chainable methods (`.quiet()`, `.nothrow()`, …) recursively return `this`
  // rather than a named alias. Our `NotificationSenderContext.$` uses a minimal
  // structural `ShellTag` / `ShellChain` shape where those same methods return
  // `ShellChain`. TypeScript treats the recursive `this` form and our named
  // alias form as structurally incompatible, so a single `as NotificationSenderContext`
  // cast does NOT compile — the `unknown` intermediate is structurally required,
  // not just an ergonomic shortcut. This is a deliberate, narrow type erosion
  // confined to this single line at the plugin boundary; runtime behavior is
  // identical because both shapes describe the same tagged-template shell.
  const handler = createSessionNotification(ctx as unknown as NotificationSenderContext, config)
  return { event: handler }
}
