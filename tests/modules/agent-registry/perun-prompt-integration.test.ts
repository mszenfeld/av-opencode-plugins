import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  PERUN_PLACEHOLDERS,
  buildPerunPrompt,
} from "../../../src/modules/agent-registry/index.js"
import { zmoraSpecialistInfo } from "../../../src/modules/qa/zmora.metadata.js"
import { fixAutoSpecialistInfo } from "../../../src/modules/agent-registry/fix-auto.metadata.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const PERUN_MD = path.resolve(here, "../../../src/agents/perun.md")

function render(): string {
  const template = readFileSync(PERUN_MD, "utf8")
  return buildPerunPrompt(template, [fixAutoSpecialistInfo, zmoraSpecialistInfo])
}

describe("perun prompt integration", () => {
  it("renders both specialist rows", () => {
    const out = render()
    expect(out).toContain("| `zmora` | subagent |")
    expect(out).toContain("| `fix-auto` | subagent |")
  })

  it("leaves no unsubstituted placeholder", () => {
    expect(render()).not.toMatch(/\{[A-Z_][A-Za-z0-9_:-]*\}/)
  })

  it("declares every builder placeholder in perun.md", () => {
    const template = readFileSync(PERUN_MD, "utf8")
    for (const name of PERUN_PLACEHOLDERS) {
      expect(template).toContain(`{${name}}`)
    }
  })
})
