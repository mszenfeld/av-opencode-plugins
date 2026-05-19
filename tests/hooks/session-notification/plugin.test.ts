import { describe, expect, it } from "vitest"
import { AppVerkPantheonPlugin } from "../../../src/hooks/session-notification/plugin.js"

describe("AppVerkPantheonPlugin", () => {
  it("returns {} when AV_PANTHEON_NOTIFY=0", async () => {
    const previous = process.env.AV_PANTHEON_NOTIFY
    process.env.AV_PANTHEON_NOTIFY = "0"
    try {
      expect(await AppVerkPantheonPlugin({} as never)).toEqual({})
    } finally {
      if (previous === undefined) delete process.env.AV_PANTHEON_NOTIFY
      else process.env.AV_PANTHEON_NOTIFY = previous
    }
  })

  it("registers an event handler when the kill-switch is unset", async () => {
    const previous = process.env.AV_PANTHEON_NOTIFY
    delete process.env.AV_PANTHEON_NOTIFY
    try {
      const hooks = await AppVerkPantheonPlugin({} as never)
      expect(typeof hooks.event).toBe("function")
    } finally {
      if (previous !== undefined) process.env.AV_PANTHEON_NOTIFY = previous
    }
  })
})
