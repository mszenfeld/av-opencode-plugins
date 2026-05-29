import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { VELES_TOOLS } from "../../../src/modules/plan/allowed-tools.js"
import {
  parseSkillFrontmatter,
  isToolSubset,
} from "../../../packages/skill-registry/src/skill-catalog.js"

describe("VELES_TOOLS", () => {
  it("includes serena read tools, plan-writing, and skill/question — but NOT plugin dispatch tools", () => {
    expect(VELES_TOOLS).toContain("serena_find_symbol")
    expect(VELES_TOOLS).toContain("Write")
    expect(VELES_TOOLS).toContain("skill")
    expect(VELES_TOOLS).toContain("question")
    // dispatch_* are plugin tools enabled via AgentConfig.tools, never here:
    expect(VELES_TOOLS).not.toContain("dispatch_parallel")
    expect(VELES_TOOLS).not.toContain("dispatch_background")
  })
  it("grants the broad git/gh/command tokens the authoring skill needs", () => {
    expect(VELES_TOOLS).toContain("Bash(gh:*)")
    expect(VELES_TOOLS).toContain("Bash(git:*)")
  })
  it("is a superset of the qa-plan-authoring skill's allowed-tools", () => {
    const skill = readFileSync(
      path.resolve(__dirname, "../../../src/skills/qa/qa-plan-authoring/SKILL.md"),
      "utf8",
    )
    const skillTools = parseSkillFrontmatter(skill, "SKILL.md")!.allowedTools!
    expect(isToolSubset(skillTools, VELES_TOOLS)).toBe(true)
  })
})
