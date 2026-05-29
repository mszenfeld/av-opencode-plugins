import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const md = readFileSync(
  path.resolve(__dirname, "../../../src/agents/perun.md"),
  "utf8",
)

describe("perun.md Veles no-plan flow", () => {
  it("dispatches veles when no plan is found", () => {
    expect(md).toMatch(/no plan/i)
    expect(md).toContain('agent: "veles"')
  })
  it("defines the Planning-consent gate dialog state with a verbatim template", () => {
    expect(md).toContain("Planning-consent gate")
    expect(md).toContain("Veles authored one")
    expect(md).toContain("Run QA on this plan")
  })
  it("parses the Veles JSON result and branches on status", () => {
    expect(md).toContain("plan_path")
    expect(md).toContain("status")
  })
})
