import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import {
  buildViolationError,
  classifyCoordinatorBash,
  isCoordinatorSession,
} from "@appverk/opencode-skill-utils"
import { readCoordinatorBashAllowlist } from "./read-allowlist.js"

type Client = PluginInput["client"]

/** Pure-ish handler factory (client + allowlist injected) so it is unit-testable. */
export function makeBashGate(client: Client, allowed: string[]) {
  return async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: { command?: unknown } },
  ) => {
    if (input.tool !== "bash") return
    // Fail-OPEN: only enforce when positively identified as the coordinator.
    if (!(await isCoordinatorSession(input.sessionID, client))) return
    const command = String(output.args?.command ?? "")
    const verdict = classifyCoordinatorBash(command, allowed)
    if (!verdict.allowed) throw buildViolationError({ tool: "bash", command, reason: "not-allowlisted" })
  }
}

export const AppVerkCoordinatorPolicyPlugin: Plugin = async ({ client }) => {
  const allowed = readCoordinatorBashAllowlist()
  const gate = makeBashGate(client, allowed)
  return {
    "tool.execute.before": gate,
  }
}
