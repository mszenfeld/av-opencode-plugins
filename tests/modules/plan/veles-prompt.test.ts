import { describe, expect, it } from "vitest"
import { buildVelesPrompt } from "../../../src/modules/plan/prompt.js"
import { VELES_TOOLS } from "../../../src/modules/plan/allowed-tools.js"

describe("buildVelesPrompt", () => {
  const prompt = buildVelesPrompt()

  it("assembles frontmatter with name, mode all, and the exact allow-list", () => {
    expect(prompt).toContain("name: veles")
    expect(prompt).toContain("mode: all")
    expect(prompt).toContain(`allowed-tools: ${VELES_TOOLS.join(", ")}`)
  })
  it("pins the load-bearing planner directives", () => {
    expect(prompt).toContain("You are **Veles**")
    expect(prompt).toContain("do not execute")
    expect(prompt).toContain("qa-plan-authoring")
    expect(prompt).toContain("triglav")
    expect(prompt).toContain('"plan_path"')
    expect(prompt).toContain('"status"')
    expect(prompt).toContain('"timeout"')
    expect(prompt).toContain('"fe_count"')
    expect(prompt).toContain('"be_count"')
    expect(prompt).toContain('"setup_prereqs"')
    expect(prompt).toContain('"topic"')
    expect(prompt).toContain("(reserved)")
  })
})
