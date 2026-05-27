import type { Plugin } from "@opencode-ai/plugin"
import { readConfigFromEnv } from "./env-config.js"
import { createSessionNotification } from "./session-notification.js"

export const AppVerkPantheonPlugin: Plugin = async (ctx) => {
  if (process.env.AV_PANTHEON_NOTIFY === "0") {
    return {}
  }
  const config = readConfigFromEnv(process.env)
  // No cast needed: OpenCode's `PluginInput` (with `$: BunShell`) is structurally
  // assignable to `NotificationSenderContext`. `BunShell`'s tagged-template
  // signature takes `ShellExpression[]`, which is assignable to `ShellTag`'s
  // narrower `string[]` rest param, and `BunShellPromise` (with `this`-returning
  // `.quiet()`/`.nothrow()`) satisfies the `ShellChain` shape. See the `ShellTag`
  // definition in `notification-sender.ts` for why the param type is `string[]`.
  const handler = createSessionNotification(ctx, config)
  return { event: handler }
}
