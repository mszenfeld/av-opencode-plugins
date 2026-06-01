import { describe, expect, it } from "vitest"
import { COORDINATOR_AGENT_NAME } from "@appverk/opencode-skill-utils"
import { makeBashGate } from "../../../src/modules/coordinator-policy/index.js"

function client(agent: string | undefined) {
  return {
    session: {
      messages: async () => ({ data: agent ? [{ info: { role: "user", agent }, parts: [] }] : [] }),
      get: async () => ({ data: { parentID: agent ? undefined : "p" } }),
    },
  } as never
}
const ALLOW = ["mkdir", "ls", "./scripts/qa-preflight.sh"]

describe("coordinator bash gate", () => {
  // Distinct sessionIDs per case: the gate resolves identity through a process-global
  // memoization keyed by sessionID (a session's agent is immutable), so reusing one key
  // would bleed a resolved identity from one test into the next.
  it("throws for a coordinator git call", async () => {
    const gate = makeBashGate(client(COORDINATOR_AGENT_NAME), ALLOW)
    await expect(
      gate({ tool: "bash", sessionID: "s_coord_git", callID: "c" }, { args: { command: "git log" } }),
    ).rejects.toThrow(/COORDINATOR_POLICY_VIOLATION/)
  })
  it("passes an allowlisted coordinator command", async () => {
    const gate = makeBashGate(client(COORDINATOR_AGENT_NAME), ALLOW)
    await expect(
      gate({ tool: "bash", sessionID: "s_coord_ls", callID: "c" }, { args: { command: "ls docs" } }),
    ).resolves.toBeUndefined()
  })
  it("passes through for a dispatched specialist (fail-open)", async () => {
    const gate = makeBashGate(client("zmora-be"), ALLOW)
    await expect(
      gate({ tool: "bash", sessionID: "s_specialist", callID: "c" }, { args: { command: "git log" } }),
    ).resolves.toBeUndefined()
  })
  it("passes through on unresolved identity (fail-open)", async () => {
    const gate = makeBashGate(client(undefined), ALLOW)
    await expect(
      gate({ tool: "bash", sessionID: "s_unresolved", callID: "c" }, { args: { command: "git log" } }),
    ).resolves.toBeUndefined()
  })
  it("ignores non-bash tools", async () => {
    const gate = makeBashGate(client(COORDINATOR_AGENT_NAME), ALLOW)
    await expect(
      gate({ tool: "read", sessionID: "s_nonbash", callID: "c" }, { args: {} }),
    ).resolves.toBeUndefined()
  })
})
