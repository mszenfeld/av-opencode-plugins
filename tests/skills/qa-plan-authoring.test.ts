import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  parseSkillFrontmatter,
  isToolSubset,
} from "../../packages/skill-registry/src/skill-catalog.js"

const SKILL_PATH = path.resolve(
  __dirname,
  "../../src/skills/qa/qa-plan-authoring/SKILL.md",
)
const COMMAND_PATH = path.resolve(__dirname, "../../src/commands/create-qa-plan.md")

function frontmatterToolList(md: string): string[] {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const line = (m?.[1] ?? "").split(/\r?\n/).find((l) => l.startsWith("allowed-tools:"))
  return (line ?? "").replace("allowed-tools:", "").split(",").map((t) => t.trim()).filter(Boolean)
}

describe("qa-plan-authoring skill", () => {
  const md = readFileSync(SKILL_PATH, "utf8")

  it("parses with a name and a single-line allowed-tools", () => {
    const entry = parseSkillFrontmatter(md, SKILL_PATH)
    expect(entry?.name).toBe("qa-plan-authoring")
    expect(entry?.allowedTools?.length).toBeGreaterThan(0)
  })

  it("loads test-plan-format and saves to the plans dir", () => {
    expect(md).toContain("test-plan-format")
    expect(md).toContain("docs/testing/plans/")
  })

  it("its allowed-tools are an exact subset of the /create-qa-plan command's", () => {
    const skillTools = parseSkillFrontmatter(md, SKILL_PATH)!.allowedTools!
    const commandTools = frontmatterToolList(readFileSync(COMMAND_PATH, "utf8"))
    expect(isToolSubset(skillTools, commandTools)).toBe(true)
  })
})
