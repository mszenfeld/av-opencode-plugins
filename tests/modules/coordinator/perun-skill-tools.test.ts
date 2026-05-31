import { describe, expect, it } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"

describe("Perun config gates skill-loading tools", () => {
  it("disables `skill` and `load_appverk_skill` via Perun's tools dict", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["Perun - Coordinator"]!.tools).toMatchObject({
      skill: false,
      load_appverk_skill: false,
    })
  })
})
