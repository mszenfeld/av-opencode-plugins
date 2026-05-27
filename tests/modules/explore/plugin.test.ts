import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppVerkExplorePlugin } from "../../../src/modules/explore/index.js"
import { TRIGLAV_TOOLS } from "../../../src/modules/explore/allowed-tools.js"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"

function fakeInput(showToast = vi.fn(async () => {})) {
  return { client: { tui: { showToast } } } as never
}

describe("AppVerkExplorePlugin", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("registers triglav metadata in the factory body", async () => {
    await AppVerkExplorePlugin(fakeInput())
    expect(getAgentMetadataRegistry().map((a) => a.name)).toContain("triglav")
  })

  it("registers the triglav agent with mode subagent and the allow-list in its prompt", async () => {
    const hooks = await AppVerkExplorePlugin(fakeInput())
    const config: { agent?: Record<string, { mode?: string; prompt?: string; description?: string }> } = {}
    await hooks.config?.(config as never)
    const agent = config.agent?.["triglav"]
    expect(agent?.mode).toBe("subagent")
    expect(agent?.description).toContain("Read-only codebase explorer")
    expect(agent?.prompt).toContain(`allowed-tools: ${TRIGLAV_TOOLS.join(", ")}`)
  })

  it("warns exactly once on session.created when serena is absent", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkExplorePlugin(fakeInput(showToast))
    await hooks.config?.({ mcp: {} } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it("does not warn when serena is present", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkExplorePlugin(fakeInput(showToast))
    await hooks.config?.({ mcp: { serena: { type: "local" } } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).not.toHaveBeenCalled()
  })
})
