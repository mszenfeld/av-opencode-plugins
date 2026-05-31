import { readFileSync } from "node:fs"
import { COORDINATOR_AGENT_NAME } from "@appverk/opencode-skill-utils"
import { describe, expect, it } from "vitest"

describe("coordinator name stays in sync with the registered agent key", () => {
  it("COORDINATOR_AGENT_NAME appears verbatim as the agent key in the coordinator module", () => {
    // Guards the resolver constant against drift: the bash gate and injection
    // suppression key off COORDINATOR_AGENT_NAME, but the runtime stamps the
    // session's `info.agent` with the `config.agent[...]` key registered here.
    // If they diverge, the coordinator silently stops being recognised and the
    // whole policy layer fails open — so assert the constant still matches the key.
    const src = readFileSync("src/modules/coordinator/index.ts", "utf8")
    expect(src).toContain(`"${COORDINATOR_AGENT_NAME}"`)
  })
})
