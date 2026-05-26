import { SessionAgentRegistry } from "../_shared/session-agent-registry.js"
import type { BindingsStore } from "./bindings-store.js"

// Re-export for backwards compatibility. The canonical definition lives in
// `_shared/session-agent-registry.ts` so the coordinator can depend on the
// type without reaching into a feature module.
export { SessionAgentRegistry }

export interface ShellEnvHookDeps {
  store: BindingsStore
  registry: SessionAgentRegistry
  resolveParentID: (sessionID: string) => Promise<string | undefined>
}

export interface ShellEnvHookInput {
  sessionID?: string
  cwd: string
  callID?: string
}

export interface ShellEnvHookOutput {
  env: Record<string, string>
}

export function makeShellEnvHook(
  deps: ShellEnvHookDeps,
): (i: ShellEnvHookInput, o: ShellEnvHookOutput) => Promise<void> {
  return async (input, output) => {
    try {
      if (input.sessionID === undefined) return
      const agent = deps.registry.lookup(input.sessionID)
      if (agent === undefined || !agent.startsWith("zmora-")) return
      const parentID = await deps.resolveParentID(input.sessionID)
      if (parentID === undefined) return
      const entries = deps.store.listForParent(parentID)
      for (const [name, entry] of entries) {
        if (output.env[name] !== undefined) continue
        try {
          output.env[name] = entry.value.unwrap()
        } catch {
          // silently skip — never log value
        }
      }
    } catch {
      // never throw from a hook
    }
  }
}
