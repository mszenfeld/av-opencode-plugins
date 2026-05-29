import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppVerkPlanPlugin } from "../../../src/modules/plan/index.js"
import { VELES_TOOLS } from "../../../src/modules/plan/allowed-tools.js"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"

function fakeInput(showToast = vi.fn(async () => {})) {
  return { client: { tui: { showToast } } } as never
}

describe("AppVerkPlanPlugin", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("registers veles metadata in the factory body", async () => {
    await AppVerkPlanPlugin(fakeInput())
    expect(getAgentMetadataRegistry().map((a) => a.name)).toContain("veles")
  })

  it("registers the veles agent as mode all with the allow-list in its prompt", async () => {
    const hooks = await AppVerkPlanPlugin(fakeInput())
    const config: {
      agent?: Record<string, { mode?: string; prompt?: string; tools?: Record<string, boolean> }>
    } = {}
    await hooks.config?.(config as never)
    const agent = config.agent?.["veles"]
    expect(agent?.mode).toBe("all")
    expect(agent?.prompt).toContain(`allowed-tools: ${VELES_TOOLS.join(", ")}`)
  })

  it("enables the dispatch plugin tools via the AgentConfig.tools map", async () => {
    const hooks = await AppVerkPlanPlugin(fakeInput())
    const config: { agent?: Record<string, { tools?: Record<string, boolean> }> } = {}
    await hooks.config?.(config as never)
    const tools = config.agent?.["veles"]?.tools
    expect(tools?.dispatch_parallel).toBe(true)
    expect(tools?.dispatch_background).toBe(true)
    expect(tools?.poll_background).toBe(true)
    expect(tools?.wait_background).toBe(true)
  })

  it("warns exactly once on session.created when serena is absent", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkPlanPlugin(fakeInput(showToast))
    await hooks.config?.({ mcp: {} } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
  })
})
