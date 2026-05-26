import { describe, expect, it } from "vitest"
import {
  buildKeyTriggersSection,
  buildSpecialistsTable,
  buildDelegationTable,
  buildUseAvoidSection,
  buildPerunPrompt,
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

const triglav = info({
  name: "triglav",
  metadata: {
    category: "exploration",
    cost: "FREE",
    triggers: [],
    useWhen: ["you need to find code", "you need impact analysis"],
    avoidWhen: ["you already know the file"],
  },
})

describe("buildUseAvoidSection", () => {
  it("returns empty string for an agent without useWhen/avoidWhen", () => {
    expect(buildUseAvoidSection("zmora", [info({ name: "zmora" })])).toBe("")
  })

  it("throws for an unknown agent target", () => {
    expect(() => buildUseAvoidSection("ghost", [info({ name: "zmora" })])).toThrow(
      /Unknown agent in placeholder: ghost/,
    )
  })

  it("renders use and avoid bullets", () => {
    expect(buildUseAvoidSection("triglav", [triglav])).toBe(
      [
        "### Use `triglav` when:",
        "- you need to find code",
        "- you need impact analysis",
        "",
        "### Avoid `triglav` when:",
        "- you already know the file",
      ].join("\n"),
    )
  })
})

describe("buildPerunPrompt", () => {
  it("substitutes known placeholders", () => {
    const out = buildPerunPrompt("X\n{SPECIALISTS_TABLE}\nY", [
      info({ name: "zmora", description: "QA work" }),
    ])
    expect(out).toContain("| `zmora` | subagent | QA work |")
    expect(out.startsWith("X\n")).toBe(true)
    expect(out.endsWith("\nY")).toBe(true)
  })

  it("leaves an unknown placeholder literal", () => {
    expect(buildPerunPrompt("{UNKNOWN_X}", [])).toBe("{UNKNOWN_X}")
  })

  it("substitutes a lowercase-named per-agent placeholder", () => {
    const out = buildPerunPrompt("{USE_AVOID:triglav}", [triglav])
    expect(out).toContain("### Use `triglav` when:")
    expect(out).not.toContain("{USE_AVOID:triglav}")
  })

  it("throws when a per-agent placeholder targets an unknown agent", () => {
    expect(() => buildPerunPrompt("{USE_AVOID:ghost}", [triglav])).toThrow(
      /Unknown agent in placeholder: ghost/,
    )
  })

  it("renders empty sections to nothing", () => {
    const out = buildPerunPrompt("a{KEY_TRIGGERS}b{DELEGATION_TABLE}c", [
      info({ name: "zmora" }),
    ])
    expect(out).toBe("abc")
  })
})
