# Pantheon Agent Metadata Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate Perun's "Available Specialists" prompt section from per-agent metadata pushed into a shared registry, so future agents need only register metadata — no edits to Perun's prose.

**Architecture:** A new `src/modules/agent-registry` module owns (a) the metadata types, (b) a process-singleton registry with `registerAgentMetadata`/`getAgentMetadataRegistry`/`clearAgentMetadataRegistry`, and (c) a set of pure builder functions that render markdown sections + substitute `{PLACEHOLDER}` tokens in a template. Modules push their metadata in their factory body (mirrors the existing `registerDispatchExtensions` bridge, ARCH-002). The QA module registers `zmora`; the coordinator registers `fix-auto` (it lives in `packages/code-review`, a separate build unit that cannot import the bridge — see spec). `getPerunPrompt()` loads `perun.md` as a template and runs it through `buildPerunPrompt`.

**Tech Stack:** TypeScript (ESM/NodeNext), vitest, tsup (`bundle: false`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-26-pantheon-agent-metadata-renderer-design.md`

**Commit note:** the repo pre-commit hook blocks `git commit` unless `AV_COMMIT_SKILL=1` is in the command. Every commit step below includes it. Never push.

**Test-loop note:** vitest runs against `src/` directly (tests import `…/*.js`, resolved to `.ts` by esbuild). For the unit/builder/registry TDD loop, run `npx vitest run <file> --config vitest.config.ts` — no build needed. The final task runs the full `npm run check`.

**Deliberate deviations from the spec (reviewed):**
1. **Specialists table is 3 columns** (`Name | Mode | Purpose`), dropping the old `When to use` column; its content is folded into each agent's `description`. The spec's anti-regression criterion is explicitly "name, mode, purpose", so this is an intended, reviewed formatting delta.
2. **`zmora`/`fix-auto` carry `triggers: []`** in 1A so the Delegation Table renders `""` (spec: "only `{SPECIALISTS_TABLE}` has content; the rest render to `""`"). `buildDelegationTable`/`buildUseAvoidSection` are exercised with synthetic metadata in unit tests; real content arrives in 1B (Triglav).
3. **`fix-auto` is registered from the coordinator factory** (not at module-load of `agent-registry/index.ts`) — avoids top-level import side-effects and is symmetric with QA registering `zmora`.

---

## File Structure

**Create:**
- `src/modules/agent-registry/agent-metadata.ts` — types only (`AgentCategory`, `AgentCost`, `AgentMode`, `DelegationTrigger`, `AgentPromptMetadata`, `SpecialistInfo`).
- `src/modules/agent-registry/perun-prompt-builder.ts` — five pure builder functions + `PERUN_PLACEHOLDERS`.
- `src/modules/agent-registry/index.ts` — registry singleton (`registerAgentMetadata` / `getAgentMetadataRegistry` / `clearAgentMetadataRegistry`) + re-exports of types and builders.
- `src/modules/agent-registry/fix-auto.metadata.ts` — `fixAutoSpecialistInfo` (explicit src-side entry for the packaged `fix-auto` agent).
- `src/modules/qa/zmora.metadata.ts` — `zmoraSpecialistInfo` (one logical entry for the three `zmora-*` variants).
- `tests/modules/agent-registry/perun-prompt-builder.test.ts`
- `tests/modules/agent-registry/agent-registry.test.ts`
- `tests/modules/agent-registry/perun-prompt-integration.test.ts`
- `tests/modules/agent-registry/metadata-coverage.test.ts`
- `tests/modules/agent-registry/__fixtures__/perun-prompt-before.md` — captured copy of the pre-refactor `perun.md` (anti-regression baseline).

**Modify:**
- `src/modules/qa/index.ts` — register `zmora` metadata in the factory body.
- `src/modules/coordinator/index.ts` — register `fix-auto` in the factory body; refactor `getPerunPrompt()` to run the template through `buildPerunPrompt`.
- `src/agents/perun.md` — replace the hand-written specialist table with `{SPECIALISTS_TABLE}` + add `{KEY_TRIGGERS}` and `{DELEGATION_TABLE}`.

---

## Task 1: Metadata types

**Files:**
- Create: `src/modules/agent-registry/agent-metadata.ts`

- [ ] **Step 1: Write the types**

```typescript
export type AgentCategory = "exploration" | "specialist" | "advisor" | "utility"

export type AgentCost = "FREE" | "CHEAP" | "EXPENSIVE"

export type AgentMode = "subagent" | "primary" | "all"

export interface DelegationTrigger {
  domain: string
  trigger: string
}

export interface AgentPromptMetadata {
  category: AgentCategory
  cost: AgentCost
  keyTrigger?: string
  useWhen?: string[]
  avoidWhen?: string[]
  triggers: DelegationTrigger[]
  promptAlias?: string
}

/** Pantheon-specific wrapper. `name`/`mode`/`description` are known where the
 *  agent is registered; `metadata` carries the omo-derived routing fields. */
export interface SpecialistInfo {
  name: string
  mode: AgentMode
  description: string
  metadata: AgentPromptMetadata
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/agent-registry/agent-metadata.ts && git commit -m "feat(agent-registry): add agent metadata types"
```

---

## Task 2: Registry singleton

**Files:**
- Create: `src/modules/agent-registry/index.ts`
- Test: `tests/modules/agent-registry/agent-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it } from "vitest"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
  registerAgentMetadata,
} from "../../../src/modules/agent-registry/index.js"
import type { SpecialistInfo } from "../../../src/modules/agent-registry/agent-metadata.js"

function info(name: string): SpecialistInfo {
  return {
    name,
    mode: "subagent",
    description: `${name} desc`,
    metadata: { category: "specialist", cost: "CHEAP", triggers: [] },
  }
}

describe("agent metadata registry", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("returns empty when nothing is registered", () => {
    expect(getAgentMetadataRegistry()).toEqual([])
  })

  it("adds registered agents", () => {
    registerAgentMetadata(info("zmora"))
    expect(getAgentMetadataRegistry().map((a) => a.name)).toEqual(["zmora"])
  })

  it("throws on duplicate logical name", () => {
    registerAgentMetadata(info("zmora"))
    expect(() => registerAgentMetadata(info("zmora"))).toThrow(
      /Duplicate agent metadata: zmora/,
    )
  })

  it("returns a name-sorted copy", () => {
    registerAgentMetadata(info("zmora"))
    registerAgentMetadata(info("fix-auto"))
    expect(getAgentMetadataRegistry().map((a) => a.name)).toEqual([
      "fix-auto",
      "zmora",
    ])
  })

  it("returns a copy that cannot mutate internal state", () => {
    registerAgentMetadata(info("zmora"))
    getAgentMetadataRegistry().push(info("hacker"))
    expect(getAgentMetadataRegistry().map((a) => a.name)).toEqual(["zmora"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/agent-registry/agent-registry.test.ts --config vitest.config.ts`
Expected: FAIL — cannot resolve `src/modules/agent-registry/index.js`.

- [ ] **Step 3: Write the registry**

```typescript
import type { SpecialistInfo } from "./agent-metadata.js"

export * from "./agent-metadata.js"
export {
  PERUN_PLACEHOLDERS,
  buildDelegationTable,
  buildKeyTriggersSection,
  buildPerunPrompt,
  buildSpecialistsTable,
  buildUseAvoidSection,
} from "./perun-prompt-builder.js"

const registry: SpecialistInfo[] = []

/**
 * Push one logical agent's metadata into the process-wide registry. Called once
 * per agent in its registering module's factory body (mirrors
 * `registerDispatchExtensions`). Throws on duplicate logical name — fail-fast at
 * startup, mirroring the `mergeTools` duplicate-tool throw in `src/index.ts`.
 */
export function registerAgentMetadata(info: SpecialistInfo): void {
  if (registry.some((a) => a.name === info.name)) {
    throw new Error(`Duplicate agent metadata: ${info.name}`)
  }
  registry.push(info)
}

/** Returns a name-sorted copy (deterministic order; callers cannot mutate state). */
export function getAgentMetadataRegistry(): SpecialistInfo[] {
  return [...registry].sort((a, b) => a.name.localeCompare(b.name))
}

/** Reset to empty. Tests only — production code never clears. */
export function clearAgentMetadataRegistry(): void {
  registry.length = 0
}
```

> NOTE: `index.ts` re-exports the builders from Task 3. Until Task 3 exists, the
> re-export line will fail to resolve. Either complete Task 3 immediately after,
> or temporarily comment the builder re-export block while running this task's
> test, then restore it in Task 3 Step 4. The registry tests do not need the builders.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/agent-registry/agent-registry.test.ts --config vitest.config.ts`
Expected: PASS (5 tests). If you see an unresolved `./perun-prompt-builder.js`, comment that re-export temporarily per the note above.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/agent-registry/index.ts tests/modules/agent-registry/agent-registry.test.ts && git commit -m "feat(agent-registry): add metadata registry with duplicate guard"
```

---

## Task 3: Prompt builder — specialists table + key triggers

**Files:**
- Create: `src/modules/agent-registry/perun-prompt-builder.ts`
- Test: `tests/modules/agent-registry/perun-prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/agent-registry/perun-prompt-builder.test.ts --config vitest.config.ts`
Expected: FAIL — cannot resolve `perun-prompt-builder.js`.

- [ ] **Step 3: Write the two builders (partial file)**

```typescript
import type { SpecialistInfo } from "./agent-metadata.js"

export const PERUN_PLACEHOLDERS = [
  "SPECIALISTS_TABLE",
  "KEY_TRIGGERS",
  "DELEGATION_TABLE",
] as const

function byName(a: SpecialistInfo, b: SpecialistInfo): number {
  return a.name.localeCompare(b.name)
}

export function buildSpecialistsTable(registry: SpecialistInfo[]): string {
  if (registry.length === 0) return ""
  const rows = [...registry]
    .sort(byName)
    .map((a) => `| \`${a.name}\` | ${a.mode} | ${a.description} |`)
  return ["| Name | Mode | Purpose |", "|---|---|---|", ...rows].join("\n")
}

export function buildKeyTriggersSection(registry: SpecialistInfo[]): string {
  const withTrigger = [...registry]
    .sort(byName)
    .filter((a) => a.metadata.keyTrigger !== undefined)
  if (withTrigger.length === 0) return ""
  const bullets = withTrigger.map((a) => `- ${a.metadata.keyTrigger}`)
  return ["### Key Triggers (check BEFORE classification):", "", ...bullets].join("\n")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/agent-registry/perun-prompt-builder.test.ts --config vitest.config.ts`
Expected: PASS. Now restore the builder re-export in `index.ts` if you commented it in Task 2 (the remaining builders are added in Tasks 4-5; the re-export will resolve once Task 5 completes — if running this task in isolation, restore only `PERUN_PLACEHOLDERS`, `buildSpecialistsTable`, `buildKeyTriggersSection` and add the rest as you go).

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/agent-registry/perun-prompt-builder.ts tests/modules/agent-registry/perun-prompt-builder.test.ts && git commit -m "feat(agent-registry): add specialists-table and key-triggers builders"
```

---

## Task 4: Prompt builder — delegation table

**Files:**
- Modify: `src/modules/agent-registry/perun-prompt-builder.ts`
- Test: `tests/modules/agent-registry/perun-prompt-builder.test.ts` (append)

- [ ] **Step 1: Append the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/agent-registry/perun-prompt-builder.test.ts --config vitest.config.ts`
Expected: FAIL — `buildDelegationTable is not a function`.

- [ ] **Step 3: Add the builder to `perun-prompt-builder.ts`**

```typescript
export function buildDelegationTable(registry: SpecialistInfo[]): string {
  const rows: string[] = []
  for (const agent of [...registry].sort(byName)) {
    for (const t of agent.metadata.triggers) {
      rows.push(`| ${t.domain} | \`${agent.name}\` | ${t.trigger} |`)
    }
  }
  if (rows.length === 0) return ""
  return [
    "### Delegation Table:",
    "",
    "| Domain | Agent | Trigger |",
    "|---|---|---|",
    ...rows,
  ].join("\n")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/agent-registry/perun-prompt-builder.test.ts --config vitest.config.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/agent-registry/perun-prompt-builder.ts tests/modules/agent-registry/perun-prompt-builder.test.ts && git commit -m "feat(agent-registry): add delegation-table builder"
```

---

## Task 5: Prompt builder — use/avoid section + buildPerunPrompt

**Files:**
- Modify: `src/modules/agent-registry/perun-prompt-builder.ts`
- Test: `tests/modules/agent-registry/perun-prompt-builder.test.ts` (append)

- [ ] **Step 1: Append the failing test**

```typescript
import {
  buildPerunPrompt,
  buildUseAvoidSection,
} from "../../../src/modules/agent-registry/perun-prompt-builder.js"

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/agent-registry/perun-prompt-builder.test.ts --config vitest.config.ts`
Expected: FAIL — `buildUseAvoidSection`/`buildPerunPrompt` not exported.

- [ ] **Step 3: Add the remaining builders to `perun-prompt-builder.ts`**

```typescript
export function buildUseAvoidSection(
  agentName: string,
  registry: SpecialistInfo[],
): string {
  const agent = registry.find((a) => a.name === agentName)
  if (agent === undefined) {
    throw new Error(`Unknown agent in placeholder: ${agentName}`)
  }
  const useWhen = agent.metadata.useWhen ?? []
  const avoidWhen = agent.metadata.avoidWhen ?? []
  if (useWhen.length === 0 && avoidWhen.length === 0) return ""
  const lines: string[] = [`### Use \`${agentName}\` when:`]
  for (const u of useWhen) lines.push(`- ${u}`)
  if (avoidWhen.length > 0) {
    lines.push("", `### Avoid \`${agentName}\` when:`)
    for (const a of avoidWhen) lines.push(`- ${a}`)
  }
  return lines.join("\n")
}

export function buildPerunPrompt(
  template: string,
  registry: SpecialistInfo[],
): string {
  const sections: Record<(typeof PERUN_PLACEHOLDERS)[number], string> = {
    SPECIALISTS_TABLE: buildSpecialistsTable(registry),
    KEY_TRIGGERS: buildKeyTriggersSection(registry),
    DELEGATION_TABLE: buildDelegationTable(registry),
  }
  let out = template
  for (const key of PERUN_PLACEHOLDERS) {
    out = out.replaceAll(`{${key}}`, sections[key])
  }
  out = out.replace(/\{USE_AVOID:([A-Za-z0-9_-]+)\}/g, (_match, name: string) =>
    buildUseAvoidSection(name, registry),
  )
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/agent-registry/perun-prompt-builder.test.ts --config vitest.config.ts`
Expected: PASS (all builder tests).

- [ ] **Step 5: Confirm `index.ts` re-exports resolve and typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS. (Ensure the builder re-export block in `index.ts` lists exactly: `PERUN_PLACEHOLDERS`, `buildDelegationTable`, `buildKeyTriggersSection`, `buildPerunPrompt`, `buildSpecialistsTable`, `buildUseAvoidSection`.)

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/agent-registry/perun-prompt-builder.ts tests/modules/agent-registry/perun-prompt-builder.test.ts && git commit -m "feat(agent-registry): add use/avoid section and buildPerunPrompt"
```

---

## Task 6: Agent metadata objects (zmora + fix-auto)

**Files:**
- Create: `src/modules/qa/zmora.metadata.ts`
- Create: `src/modules/agent-registry/fix-auto.metadata.ts`

- [ ] **Step 1: Write `zmora.metadata.ts`**

```typescript
import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/**
 * One logical entry for the three physical `zmora-fe` / `zmora-be` /
 * `zmora-setup` variants registered in `qa/index.ts`. The variant suffix is an
 * internal detail; Perun's table shows only `zmora`.
 */
export const zmoraSpecialistInfo: SpecialistInfo = {
  name: "zmora",
  mode: "subagent",
  description:
    "Execute a single QA scenario (FE or BE). Internally split into variants `zmora-fe` / `zmora-be`; Perun routes by scenario prefix. Dispatched once per scenario by Perun.",
  metadata: {
    category: "specialist",
    cost: "EXPENSIVE",
    triggers: [],
  },
}
```

- [ ] **Step 2: Write `fix-auto.metadata.ts`**

```typescript
import type { SpecialistInfo } from "./agent-metadata.js"

/**
 * Explicit src-side entry for `fix-auto`, which lives in `packages/code-review`
 * (a separate build unit that cannot import the registry bridge during the
 * plugins->harness migration — see spec). Registered from the coordinator factory.
 */
export const fixAutoSpecialistInfo: SpecialistInfo = {
  name: "fix-auto",
  mode: "subagent",
  description:
    "Auto-fix code issues from reports. Used when the user accepts a fix proposal after a QA run.",
  metadata: {
    category: "utility",
    cost: "CHEAP",
    triggers: [],
  },
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/zmora.metadata.ts src/modules/agent-registry/fix-auto.metadata.ts && git commit -m "feat(agent-registry): add zmora and fix-auto metadata"
```

---

## Task 7: Capture the anti-regression baseline (BEFORE any refactor)

**Files:**
- Create: `tests/modules/agent-registry/__fixtures__/perun-prompt-before.md`

> Do this BEFORE Task 8/9 edit `perun.md` or `getPerunPrompt()`. Today
> `getPerunPrompt()` returns `perun.md` verbatim, so the current `perun.md` IS the
> baseline output. We snapshot it so the post-refactor render can be checked for
> the same specialist rows.

- [ ] **Step 1: Copy the current prompt to a fixture**

```bash
mkdir -p tests/modules/agent-registry/__fixtures__
cp src/agents/perun.md tests/modules/agent-registry/__fixtures__/perun-prompt-before.md
```

- [ ] **Step 2: Sanity-check the fixture contains both specialist rows**

Run: `grep -E '\| `(zmora|fix-auto)`' tests/modules/agent-registry/__fixtures__/perun-prompt-before.md`
Expected: two matching lines (`zmora` and `fix-auto`).

- [ ] **Step 3: Commit**

```bash
AV_COMMIT_SKILL=1 git add tests/modules/agent-registry/__fixtures__/perun-prompt-before.md && git commit -m "test(agent-registry): capture pre-refactor perun prompt baseline"
```

---

## Task 8: Register metadata + refactor getPerunPrompt + template

**Files:**
- Modify: `src/modules/qa/index.ts`
- Modify: `src/modules/coordinator/index.ts`
- Modify: `src/agents/perun.md`

- [ ] **Step 1: Register `zmora` in the QA factory**

In `src/modules/qa/index.ts`, add the imports near the other module imports (after the line importing `registerDispatchExtensions`):

```typescript
import { registerAgentMetadata } from "../agent-registry/index.js"
import { zmoraSpecialistInfo } from "./zmora.metadata.js"
```

Then, immediately AFTER the `registerDispatchExtensions({ ... })` call (the closing `})` around line 124) and before the `// Periodic TTL sweep` comment, add:

```typescript
  // Contribute zmora's metadata to the agent registry so Perun's prompt renders
  // its specialist row. One logical entry for all three zmora-* variants.
  registerAgentMetadata(zmoraSpecialistInfo)
```

- [ ] **Step 2: Register `fix-auto` + refactor `getPerunPrompt` in the coordinator**

In `src/modules/coordinator/index.ts`, add imports after the `loadModuleAsset` import (line 20):

```typescript
import {
  buildPerunPrompt,
  getAgentMetadataRegistry,
  registerAgentMetadata,
} from "../agent-registry/index.js"
import { fixAutoSpecialistInfo } from "../agent-registry/fix-auto.metadata.js"
```

Replace the current `getPerunPrompt` (lines 33-39):

```typescript
let cachedPerunPrompt: string | undefined
function getPerunPrompt(): string {
  if (cachedPerunPrompt === undefined) {
    cachedPerunPrompt = loadAgentPrompt("perun")
  }
  return cachedPerunPrompt
}
```

with:

```typescript
let cachedPerunPrompt: string | undefined
function getPerunPrompt(): string {
  if (cachedPerunPrompt === undefined) {
    const template = loadAgentPrompt("perun")
    cachedPerunPrompt = buildPerunPrompt(template, getAgentMetadataRegistry())
  }
  return cachedPerunPrompt
}
```

Then register `fix-auto` in the factory body. Inside `AppVerkCoordinatorPlugin`, immediately after `let toastShown = false` (line 43), add:

```typescript
  // fix-auto lives in packages/code-review (a separate build unit that cannot
  // import this bridge); register its metadata here so Perun's specialist table
  // keeps its row. Explicit src-side entry — see the renderer spec.
  registerAgentMetadata(fixAutoSpecialistInfo)
```

- [ ] **Step 3: Edit `perun.md` to use placeholders**

In `src/agents/perun.md`, replace the block at lines 14-21:

```markdown
## Available Specialists

| Name | Mode | Purpose | When to use |
|---|---|---|---|
| `zmora` | subagent | Execute a single QA scenario (FE or BE). Internally split into variants `zmora-fe` / `zmora-be`; Perun routes by scenario prefix. | Dispatched once per scenario by Perun |
| `fix-auto` | subagent | Auto-fix code issues from reports | When user accepts a fix proposal after a QA run |

---
```

with:

```markdown
## Available Specialists

{SPECIALISTS_TABLE}

{KEY_TRIGGERS}

{DELEGATION_TABLE}

---
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Smoke-check the wiring renders both rows**

Run:
```bash
npx tsx -e "import('./src/modules/qa/index.js').then(async (qa)=>{ const h=await qa.AppVerkQAPlugin({client:{}}); await h.config?.({}); const cr=await import('./src/modules/agent-registry/index.js'); const {fixAutoSpecialistInfo}=await import('./src/modules/agent-registry/fix-auto.metadata.js'); cr.registerAgentMetadata(fixAutoSpecialistInfo); const fs=await import('node:fs'); const t=fs.readFileSync('src/agents/perun.md','utf8'); const out=cr.buildPerunPrompt(t, cr.getAgentMetadataRegistry()); console.log(/\\| \`zmora\` \\| subagent/.test(out), /\\| \`fix-auto\` \\| subagent/.test(out), /\\{[A-Z_][A-Za-z0-9_:-]*\\}/.test(out)); })"
```
Expected: `true true false` (both rows present; no leftover placeholder). If `tsx` is unavailable, skip this manual smoke step — Task 9's integration test covers it.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/index.ts src/modules/coordinator/index.ts src/agents/perun.md && git commit -m "feat(coordinator): render Perun specialists table from metadata registry"
```

---

## Task 9: Integration test — full render, placeholder guard, template↔code sync

**Files:**
- Create: `tests/modules/agent-registry/perun-prompt-integration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
  // Mirror the production registry's name-sorted order.
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/modules/agent-registry/perun-prompt-integration.test.ts --config vitest.config.ts`
Expected: PASS (3 tests). It should pass immediately because Task 8 already edited `perun.md` and the metadata objects exist. If "no unsubstituted placeholder" fails, check that `perun.md` contains only `{SPECIALISTS_TABLE}`, `{KEY_TRIGGERS}`, `{DELEGATION_TABLE}` and no stray braces.

- [ ] **Step 3: Commit**

```bash
AV_COMMIT_SKILL=1 git add tests/modules/agent-registry/perun-prompt-integration.test.ts && git commit -m "test(agent-registry): integration test for rendered Perun prompt"
```

---

## Task 10: Anti-regression test against the baseline fixture

**Files:**
- Create: `tests/modules/agent-registry/metadata-coverage.test.ts`

> This file holds BOTH the anti-regression check (post-refactor render keeps the
> baseline's specialist names) AND the anti-drift coverage check (every registered
> subagent has metadata).

- [ ] **Step 1: Write the failing anti-regression test**

```typescript
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

const here = path.dirname(fileURLToPath(import.meta.url))
const PERUN_MD = path.resolve(here, "../../../src/agents/perun.md")
const BEFORE = path.resolve(here, "__fixtures__/perun-prompt-before.md")

/** Extract backtick-wrapped specialist names from a markdown table column. */
function specialistNames(markdown: string): string[] {
  const names = new Set<string>()
  for (const m of markdown.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|\s*subagent\s*\|/gim)) {
    names.add(m[1]!)
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/modules/agent-registry/metadata-coverage.test.ts --config vitest.config.ts`
Expected: PASS.

- [ ] **Step 3: Append the anti-drift coverage test**

```typescript
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"

/** Strip the zmora variant suffix so zmora-fe/be/setup map to the logical name. */
function logicalName(agentKey: string): string {
  return agentKey.replace(/^(zmora)-(fe|be|setup)$/, "$1")
}

describe("anti-drift: every registered subagent has metadata", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("covers each mode:subagent agent registered by QA + coordinator", async () => {
    // Construct both plugins — their factory bodies push metadata into the
    // registry (zmora from QA, fix-auto from the coordinator).
    const fakeClient = {} as never
    const qa = await AppVerkQAPlugin({ client: fakeClient } as never)
    const coord = await AppVerkCoordinatorPlugin({ client: fakeClient } as never)

    // Collect the agent keys each plugin registers into OpenCode config.
    const config: { agent?: Record<string, { mode?: string }> } = {}
    await qa.config?.(config as never)
    await coord.config?.(config as never)

    const subagentLogicalNames = new Set(
      Object.entries(config.agent ?? {})
        .filter(([, def]) => def.mode === "subagent")
        .map(([key]) => logicalName(key)),
    )

    const registered = new Set(getAgentMetadataRegistry().map((a) => a.name))

    // Allow-list: agents that may exist without metadata yet (none in 1A;
    // `triglav` until Spec 1B lands).
    const allowList = new Set<string>(["triglav"])

    for (const name of subagentLogicalNames) {
      if (allowList.has(name)) continue
      expect(registered.has(name)).toBe(true)
    }

    // The coordinator factory registered fix-auto explicitly (it is in a package
    // and not in this config map); assert both known specialists are covered.
    expect(registered.has("zmora")).toBe(true)
    expect(registered.has("fix-auto")).toBe(true)
  })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/agent-registry/metadata-coverage.test.ts --config vitest.config.ts`
Expected: PASS (2 describe blocks). If the QA factory throws on `client` usage at construction time, note it only reads `client` inside async hooks (not the factory body) — the empty stub is sufficient. The `setInterval` sweep timer is `unref`'d and will not keep the test process alive.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add tests/modules/agent-registry/metadata-coverage.test.ts && git commit -m "test(agent-registry): anti-regression + anti-drift metadata coverage"
```

---

## Task 11: Full verification + dist sync

**Files:** none (verification only)

- [ ] **Step 1: Run the full check suite**

Run: `npm run check`
Expected: PASS — `typecheck` (root + all workspaces), `test` (root vitest + workspace tests), and `build` all succeed. This also rebuilds `dist/` so the new module files are emitted.

- [ ] **Step 2: Verify dist is in sync**

Run: `npm run verify-dist`
Expected: PASS — `dist/` matches `src/` after the build (no uncommitted dist drift). If it reports drift, the build in Step 1 produced new `dist/` files that must be committed.

- [ ] **Step 3: Commit any regenerated dist**

```bash
AV_COMMIT_SKILL=1 git add dist && git commit -m "build(dist): regenerate after agent metadata renderer"
```

(If `git status` shows no `dist` changes, skip this commit.)

---

## Self-Review (completed during planning)

**Spec coverage:**
- Renderer infra (types, registry, builders) → Tasks 1-5. ✓
- Module-contributed metadata via bridge → Tasks 6, 8 (zmora from QA, fix-auto from coordinator). ✓
- `fix-auto` explicit src-side entry (package boundary) → Tasks 6, 8. ✓
- `perun.md` placeholders, `getPerunPrompt` refactor → Task 8. ✓
- Error handling: duplicate-name throw (Task 2), unknown-target throw (Task 5), placeholder guard regex with `a-z` (Tasks 5, 9). ✓
- Testing buckets 1-5: unit (Tasks 3-5), registry (Task 2), integration + placeholder guard + template↔code sync (Task 9), anti-drift coverage (Task 10), anti-regression fixture (Tasks 7, 10). ✓
- No-collision rename `getAgentMetadataRegistry` (not `loadAgentRegistry`) → Task 2. ✓

**Type consistency:** `SpecialistInfo` / `AgentPromptMetadata` shape is identical across Tasks 1, 2, 3, 6, and tests. Builder names (`buildSpecialistsTable`, `buildKeyTriggersSection`, `buildUseAvoidSection`, `buildDelegationTable`, `buildPerunPrompt`, `PERUN_PLACEHOLDERS`) match between `perun-prompt-builder.ts`, the `index.ts` re-export, and every test import. `registerAgentMetadata` / `getAgentMetadataRegistry` / `clearAgentMetadataRegistry` names are consistent across registry, QA, coordinator, and tests.

**Placeholder scan:** no "TBD"/"TODO"/"handle edge cases" — every code step shows complete code.
