import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it } from "vitest"
import {
  buildPerunPrompt,
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"
import { zmoraSpecialistInfo } from "../../../src/modules/qa/zmora.metadata.js"
import { fixAutoSpecialistInfo } from "../../../src/modules/agent-registry/fix-auto.metadata.js"
import { triglavSpecialistInfo } from "../../../src/modules/explore/triglav.metadata.js"
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
    // triglavSpecialistInfo is required so the {USE_AVOID:triglav} placeholder
    // resolves; it also adds a `triglav` row, so the baseline (fix-auto, zmora)
    // must be a subset of — not equal to — the rendered specialist set.
    const rendered = buildPerunPrompt(template, [
      fixAutoSpecialistInfo,
      zmoraSpecialistInfo,
      triglavSpecialistInfo,
    ])
    const renderedNames = new Set(specialistNames(rendered))
    for (const name of baselineNames) {
      expect(renderedNames.has(name)).toBe(true)
    }
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
    const { AppVerkExplorePlugin } = await import("../../../src/modules/explore/index.js")
    await AppVerkExplorePlugin({ client: { tui: { showToast: async () => {} } } } as never)

    const config: { agent?: Record<string, { mode?: string }> } = {}
    await qa.config?.(config as never)
    await coord.config?.(config as never)

    const subagentLogicalNames = new Set(
      Object.entries(config.agent ?? {})
        .filter(([, def]) => def.mode === "subagent")
        .map(([key]) => logicalName(key)),
    )

    const registered = new Set(getAgentMetadataRegistry().map((a) => a.name))
    const allowList = new Set<string>() // triglav now ships metadata (Spec 1B)

    for (const name of subagentLogicalNames) {
      if (allowList.has(name)) continue
      expect(registered.has(name)).toBe(true)
    }

    expect(registered.has("zmora")).toBe(true)
    expect(registered.has("fix-auto")).toBe(true)
    expect(registered.has("triglav")).toBe(true)
  })
})
