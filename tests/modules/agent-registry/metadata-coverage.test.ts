import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import {
  buildPerunPrompt,
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
  registerAgentMetadata,
} from "../../../src/modules/agent-registry/index.js"
import { zmoraSpecialistInfo } from "../../../src/modules/qa/zmora.metadata.js"
import { fixAutoSpecialistInfo } from "../../../src/modules/agent-registry/fix-auto.metadata.js"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const PERUN_MD = path.resolve(here, "../../../src/agents/perun.md")
const BEFORE = path.resolve(here, "__fixtures__/perun-prompt-before.md")

function specialistNames(markdown: string): string[] {
  const names = new Set<string>()
  for (const m of markdown.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|\s*subagent\s*\|/gim)) {
    const name = m[1]
    if (name !== undefined) names.add(name)
  }
  return [...names].sort()
}

describe("anti-regression: specialist rows preserved", () => {
  it("renders rows for every specialist present in the pre-refactor baseline", () => {
    const baselineNames = specialistNames(readFileSync(BEFORE, "utf8"))
    expect(baselineNames).toEqual(["fix-auto", "zmora"])

    const template = readFileSync(PERUN_MD, "utf8")
    const rendered = buildPerunPrompt(template, [
      fixAutoSpecialistInfo,
      zmoraSpecialistInfo,
    ])
    expect(specialistNames(rendered)).toEqual(baselineNames)
  })
})

function logicalName(agentKey: string): string {
  return agentKey.replace(/^(zmora)-(fe|be|setup)$/, "$1")
}

describe("anti-drift: every registered subagent has metadata", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("covers each mode:subagent agent registered by QA + coordinator", async () => {
    const fakeClient = {} as never
    const qa = await AppVerkQAPlugin({ client: fakeClient } as never)
    const coord = await AppVerkCoordinatorPlugin({ client: fakeClient } as never)

    const config: { agent?: Record<string, { mode?: string }> } = {}
    await qa.config?.(config as never)
    await coord.config?.(config as never)

    const subagentLogicalNames = new Set(
      Object.entries(config.agent ?? {})
        .filter(([, def]) => def.mode === "subagent")
        .map(([key]) => logicalName(key)),
    )

    const registered = new Set(getAgentMetadataRegistry().map((a) => a.name))
    const allowList = new Set<string>(["triglav"])

    for (const name of subagentLogicalNames) {
      if (allowList.has(name)) continue
      expect(registered.has(name)).toBe(true)
    }

    expect(registered.has("zmora")).toBe(true)
    expect(registered.has("fix-auto")).toBe(true)
  })
})
