import { describe, expect, it } from "vitest"
import {
  dispatchParallel,
  type AgentInfo,
  type DispatchSpecialist,
  type DispatchTask,
} from "../../../src/modules/coordinator/dispatch.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

/**
 * Regression test for the contract Perun's Step 6.5 (NEED_INFO parsing)
 * depends on: `dispatchParallel` must pass the specialist's final assistant
 * `content` through to `DispatchResult.result` unmodified.
 *
 * If `dispatch.ts` ever starts post-processing the payload (re-encoding,
 * trimming, transforming) the JSON.parse in Perun's Step 6.5 will break and
 * NEED_INFO routing will silently regress to "treat as PASS/FAIL output".
 *
 * Note: `neutralizeUntrustedOutput` (called inside dispatch) HTML-escapes `<`
 * and `>` and strips ANSI/control bytes. The payloads in this file are pure
 * JSON object literals with no angle brackets and no control bytes, so the
 * neutralizer is a no-op for them — which is exactly the realistic shape
 * Zmora emits via `STRUCTURED_PAYLOAD_GUIDELINE`.
 */

function finishedMessage(content: string): PollerMessage {
  return { role: "assistant", content, finish_reason: "end_turn" }
}

function makeEchoSpecialist(payload: string): DispatchSpecialist {
  return {
    async startTask(): Promise<string> {
      return "fake-session"
    },
    async fetchMessages(): Promise<PollerMessage[]> {
      return [finishedMessage(payload)]
    },
    async abortTask(): Promise<void> {
      /* never aborted in these tests */
    },
    async startBackground(): Promise<string> {
      return "fake-session"
    },
  }
}

const ZMORA_BE_REGISTRY: Record<string, AgentInfo> = {
  "zmora-be": { mode: "subagent" },
}

const baseTask: DispatchTask = {
  name: "zmora-be",
  prompt: "run BE scenario",
  context: "...",
}

describe("dispatchParallel — payload passthrough", () => {
  it("preserves a JSON-shaped NEED_INFO payload byte-for-byte in result", async () => {
    const needInfoPayload = JSON.stringify({
      status: "NEED_INFO",
      scenario: "BE-03",
      kind: "credentials",
      missing: ["STRIPE_TEST_KEY"],
      hint: "Set STRIPE_TEST_KEY in shell, restart OpenCode, reply 'resume'.",
    })

    const results = await dispatchParallel({
      tasks: [baseTask],
      agentRegistry: ZMORA_BE_REGISTRY,
      specialist: makeEchoSpecialist(needInfoPayload),
      signal: new AbortController().signal,
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe("success")
    expect(results[0]?.result).toBe(needInfoPayload)

    // Round-trip parse — guards Step 6.5's JSON.parse contract.
    const firstResult = results[0]
    if (firstResult === undefined) {
      throw new Error("expected at least one result")
    }
    const parsed: { status: string; missing: string[] } = JSON.parse(
      firstResult.result,
    )
    expect(parsed.status).toBe("NEED_INFO")
    expect(parsed.missing).toEqual(["STRIPE_TEST_KEY"])
  })

  it("preserves PASS payloads identically (regression for existing behaviour)", async () => {
    const passPayload = JSON.stringify({ status: "PASS", scenario: "BE-01" })

    const results = await dispatchParallel({
      tasks: [baseTask],
      agentRegistry: ZMORA_BE_REGISTRY,
      specialist: makeEchoSpecialist(passPayload),
      signal: new AbortController().signal,
    })

    expect(results[0]?.status).toBe("success")
    expect(results[0]?.result).toBe(passPayload)
  })
})
