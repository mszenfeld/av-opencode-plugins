import { describe, expect, it } from "vitest"
import { buildTriglavPrompt } from "../../../src/modules/explore/prompt.js"
import { TRIGLAV_TOOLS } from "../../../src/modules/explore/allowed-tools.js"

describe("buildTriglavPrompt", () => {
  const prompt = buildTriglavPrompt()

  it("assembles a frontmatter with name, mode, and the exact allow-list", () => {
    expect(prompt).toContain("name: triglav")
    expect(prompt).toContain("mode: subagent")
    expect(prompt).toContain(`allowed-tools: ${TRIGLAV_TOOLS.join(", ")}`)
  })

  it("pins the load-bearing exploration directives", () => {
    expect(prompt).toContain("3+ tools simultaneously")
    expect(prompt).toContain("first action")
    expect(prompt).toContain("You cannot create, modify, or delete files")
    expect(prompt).toContain("absolute")
    expect(prompt).toContain("<analysis>")
    expect(prompt).toContain("<results>")
    expect(prompt).toContain("<files>")
    expect(prompt).toContain("<answer>")
    expect(prompt).toContain("<next_steps>")
    expect(prompt).toContain("FAILED if")
    expect(prompt).toContain("do NOT retry")
  })
})
