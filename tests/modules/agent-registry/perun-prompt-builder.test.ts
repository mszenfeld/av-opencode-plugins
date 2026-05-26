import { describe, expect, it } from "vitest"
import {
  buildKeyTriggersSection,
  buildSpecialistsTable,
} from "../../../src/modules/agent-registry/perun-prompt-builder.js"
import type { SpecialistInfo } from "../../../src/modules/agent-registry/agent-metadata.js"

function info(over: Partial<SpecialistInfo> & { name: string }): SpecialistInfo {
  return {
    name: over.name,
    mode: over.mode ?? "subagent",
    description: over.description ?? `${over.name} desc`,
    metadata: over.metadata ?? { category: "specialist", cost: "CHEAP", triggers: [] },
  }
}

describe("buildSpecialistsTable", () => {
  it("returns empty string for no agents", () => {
    expect(buildSpecialistsTable([])).toBe("")
  })

  it("renders one row", () => {
    const out = buildSpecialistsTable([info({ name: "zmora", description: "QA work" })])
    expect(out).toBe(
      ["| Name | Mode | Purpose |", "|---|---|---|", "| `zmora` | subagent | QA work |"].join("\n"),
    )
  })

  it("renders rows in name-sorted order", () => {
    const out = buildSpecialistsTable([
      info({ name: "zmora", description: "z" }),
      info({ name: "fix-auto", description: "f" }),
    ])
    const lines = out.split("\n")
    expect(lines[2]).toBe("| `fix-auto` | subagent | f |")
    expect(lines[3]).toBe("| `zmora` | subagent | z |")
  })
})

describe("buildKeyTriggersSection", () => {
  it("returns empty string when no agent has a keyTrigger", () => {
    expect(buildKeyTriggersSection([info({ name: "zmora" })])).toBe("")
  })

  it("renders a bullet per agent with a keyTrigger, skipping others", () => {
    const out = buildKeyTriggersSection([
      info({ name: "zmora" }),
      info({
        name: "triglav",
        metadata: { category: "exploration", cost: "FREE", triggers: [], keyTrigger: "user asks where X is" },
      }),
    ])
    expect(out).toBe(
      ["### Key Triggers (check BEFORE classification):", "", "- user asks where X is"].join("\n"),
    )
  })
})

import { buildDelegationTable } from "../../../src/modules/agent-registry/perun-prompt-builder.js"

describe("buildDelegationTable", () => {
  it("returns empty string when no agent declares triggers", () => {
    expect(buildDelegationTable([info({ name: "zmora" })])).toBe("")
  })

  it("expands triggers[] into Domain/Agent/Trigger rows", () => {
    const out = buildDelegationTable([
      info({
        name: "triglav",
        metadata: {
          category: "exploration",
          cost: "FREE",
          triggers: [
            { domain: "Code search", trigger: "find where X is defined" },
            { domain: "Impact analysis", trigger: "what calls Y" },
          ],
        },
      }),
    ])
    expect(out).toBe(
      [
        "### Delegation Table:",
        "",
        "| Domain | Agent | Trigger |",
        "|---|---|---|",
        "| Code search | `triglav` | find where X is defined |",
        "| Impact analysis | `triglav` | what calls Y |",
      ].join("\n"),
    )
  })
})
