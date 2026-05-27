# Triglav Exploration Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **Triglav**, a read-only codebase exploration agent Perun can dispatch (blocking, via `dispatch_parallel`) — serena MCP (LSP) first with Grep/Glob fallback, omo-style `<analysis>`/`<results>` output, registered via the Spec 1A metadata bridge.

**Architecture:** A new `src/modules/explore/` module (symmetric to `src/modules/qa/`) registers the `triglav` agent into OpenCode config and pushes its `SpecialistInfo` into the 1A `agent-registry`. The agent prompt is assembled from a static `triglav.md` body + a frontmatter built from `TRIGLAV_TOOLS` (single source of truth, no drift). serena absence degrades gracefully via the prompt's fallback + a one-time warning toast.

**Tech Stack:** TypeScript (ESM/NodeNext), vitest, tsup (`bundle: false`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-27-triglav-explorer-design.md`

**Commit note:** the pre-commit hook blocks `git commit` unless `AV_COMMIT_SKILL=1` is in the command. Every commit step includes it. Never push. Never add Co-Authored-By.

**Test-loop note:** run a single test file with `npx vitest run <path> --config vitest.config.ts` (vitest runs against `src/` directly — `.js` imports resolve to `.ts`). Typecheck with `npx tsc -p tsconfig.json --noEmit`. Final task runs `npm run check`.

**Key facts (verified against the codebase):**
- serena MCP server key is `serena` (`~/.config/opencode/opencode.json` → `mcp.serena`), so allowed-tools use the `serena_<tool>` form and detection checks `config.mcp?.serena`.
- OpenCode honors an agent's `allowed-tools` from its **prompt frontmatter** (same as `perun.md` and the built `zmora-*` prompts), so Triglav's allow-list lives in the assembled prompt's frontmatter.
- `package.json` `files` = `["dist", ...]` (whole `dist`), and `tests/root-plugin.test.ts` packed-files assertion uses `expect.arrayContaining` (subset). **So neither needs changing** for the new module.
- Adding `{USE_AVOID:triglav}` to `perun.md` makes `buildUseAvoidSection` throw unless `triglav` is in the render array — so the `perun.md` edit and the integration-test update are **coupled in one task** (Task 5).

---

## File Structure

**Create (all under `src/modules/explore/`):**
- `allowed-tools.ts` — `TRIGLAV_TOOLS` read-only allow-list (serena read subset + Read/Glob/Grep + read-only Bash).
- `serena-detect.ts` — `isSerenaAvailable(config)` pure predicate.
- `triglav.metadata.ts` — `triglavSpecialistInfo: SpecialistInfo` + exported `TRIGLAV_DESCRIPTION`.
- `triglav.md` — static agent prompt **body** (no frontmatter; frontmatter is assembled).
- `prompt.ts` — `buildTriglavPrompt()` assembles frontmatter (from metadata + TRIGLAV_TOOLS) + body.
- `index.ts` — `AppVerkExplorePlugin` (registers agent + metadata, one-time serena warning).
- Tests: `tests/modules/explore/{allowed-tools,serena-detect,triglav-prompt,plugin}.test.ts`.

**Modify:**
- `src/index.ts` — add `AppVerkExplorePlugin` to `defaultPluginFactories`.
- `src/agents/perun.md` — add `{USE_AVOID:triglav}` placeholder + a trimmed Tool-Usage note.
- `tests/modules/agent-registry/perun-prompt-integration.test.ts` — add `triglav` to the render array + assertions (coupled with the perun.md edit).
- `tests/modules/agent-registry/metadata-coverage.test.ts` — remove `triglav` from the anti-drift allow-list; assert it's covered.

---

## Task 1: Read-only allow-list (`TRIGLAV_TOOLS`)

**Files:**
- Create: `src/modules/explore/allowed-tools.ts`
- Test: `tests/modules/explore/allowed-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest"
import { TRIGLAV_TOOLS } from "../../../src/modules/explore/allowed-tools.js"

// Any tool whose name implies mutation/escape must never be in the allow-list.
const WRITE_VERB = /create|replace|insert|rename|delete|write|edit|memory|execute_shell|activate|onboarding/i

describe("TRIGLAV_TOOLS", () => {
  it("includes the read-only serena LSP subset", () => {
    for (const t of [
      "serena_find_symbol",
      "serena_find_referencing_symbols",
      "serena_get_symbols_overview",
      "serena_search_for_pattern",
      "serena_find_file",
      "serena_list_dir",
      "serena_read_file",
    ]) {
      expect(TRIGLAV_TOOLS).toContain(t)
    }
  })

  it("includes structured fallback search tools", () => {
    expect(TRIGLAV_TOOLS).toEqual(
      expect.arrayContaining(["Read", "Glob", "Grep"]),
    )
  })

  it("contains no structured write/mutation tool (deny-by-pattern)", () => {
    const offenders = TRIGLAV_TOOLS.filter((t) => WRITE_VERB.test(t))
    expect(offenders).toEqual([])
  })

  it("excludes Write, Edit, dispatch_parallel, and Task", () => {
    for (const t of ["Write", "Edit", "dispatch_parallel", "Task"]) {
      expect(TRIGLAV_TOOLS).not.toContain(t)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/explore/allowed-tools.test.ts --config vitest.config.ts`
Expected: FAIL — cannot resolve `allowed-tools.js`.

- [ ] **Step 3: Write the allow-list**

```typescript
// Read-only allow-list for the Triglav exploration agent.
//
// The REAL read-only boundary is the exclusion of every structured write tool
// (Write/Edit/serena-write) — OpenCode's allow-list is deny-by-default, so an
// unlisted write tool is not callable. The Bash entries below are a best-effort
// rail, NOT a sandbox: `:*` permits arbitrary args, so `git log` (pager /
// GIT_EXTERNAL_DIFF / --output), `rg --pre`, and shell redirection are real
// escape vectors. We knowingly accept this (omo-parity); per AGENTS.md, Bash
// token-matching is defense-in-depth, not a security boundary.

const SERENA_READ_TOOLS = [
  "serena_find_symbol",
  "serena_find_referencing_symbols",
  "serena_get_symbols_overview",
  "serena_search_for_pattern",
  "serena_find_file",
  "serena_list_dir",
  "serena_read_file",
]

const STRUCTURED_READ_TOOLS = ["Read", "Glob", "Grep"]

const READONLY_BASH_TOOLS = [
  "Bash(grep:*)",
  "Bash(cat:./*)",
  "Bash(head:./*)",
  "Bash(tail:./*)",
  "Bash(rg:*)",
  "Bash(git log:*)",
  "Bash(git blame:*)",
]

export const TRIGLAV_TOOLS: string[] = [
  ...SERENA_READ_TOOLS,
  ...STRUCTURED_READ_TOOLS,
  ...READONLY_BASH_TOOLS,
]
```

> NOTE: `serena_find_declaration` / `serena_find_implementations` /
> `serena_get_diagnostics_for_file` were deferred from the spec — add them to
> `SERENA_READ_TOOLS` ONLY after confirming the exact names against the installed
> serena build (`mcp.serena` in `~/.config/opencode/opencode.json`). They must
> still pass the write-verb pattern test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/explore/allowed-tools.test.ts --config vitest.config.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/explore/allowed-tools.ts tests/modules/explore/allowed-tools.test.ts && git commit -m "feat(explore): add Triglav read-only allow-list"
```

---

## Task 2: serena detection

**Files:**
- Create: `src/modules/explore/serena-detect.ts`
- Test: `tests/modules/explore/serena-detect.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest"
import {
  isSerenaAvailable,
  type ConfigLike,
} from "../../../src/modules/explore/serena-detect.js"

describe("isSerenaAvailable", () => {
  it("returns true when an mcp.serena entry is present", () => {
    const config: ConfigLike = { mcp: { serena: { type: "local" }, context7: {} } }
    expect(isSerenaAvailable(config)).toBe(true)
  })

  it("returns false when serena is absent from mcp", () => {
    expect(isSerenaAvailable({ mcp: { context7: {} } })).toBe(false)
  })

  it("returns false when there is no mcp map", () => {
    expect(isSerenaAvailable({})).toBe(false)
  })

  it("returns false when serena is explicitly disabled", () => {
    expect(isSerenaAvailable({ mcp: { serena: { enabled: false } } })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/explore/serena-detect.test.ts --config vitest.config.ts`
Expected: FAIL — cannot resolve `serena-detect.js`.

- [ ] **Step 3: Write the predicate**

```typescript
// Advisory-only: this powers a one-time warning toast. Triglav is correct
// WITHOUT detection because the prompt falls back to Grep/Glob when serena is
// absent — so the blast radius of a wrong config shape is "no toast", never a
// broken agent. Structural ConfigLike avoids depending on the exact SDK type.

export interface ConfigLike {
  mcp?: Record<string, { enabled?: boolean } | undefined>
}

export function isSerenaAvailable(config: ConfigLike): boolean {
  const entry = config.mcp?.serena
  if (entry === undefined) return false
  return entry.enabled !== false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/explore/serena-detect.test.ts --config vitest.config.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/explore/serena-detect.ts tests/modules/explore/serena-detect.test.ts && git commit -m "feat(explore): add advisory serena-availability detection"
```

---

## Task 3: Metadata, prompt body, and prompt assembly

**Files:**
- Create: `src/modules/explore/triglav.metadata.ts`
- Create: `src/modules/explore/triglav.md`
- Create: `src/modules/explore/prompt.ts`
- Test: `tests/modules/explore/triglav-prompt.test.ts`

- [ ] **Step 1: Write `triglav.metadata.ts`**

```typescript
import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

export const TRIGLAV_DESCRIPTION =
  "Read-only codebase explorer: maps structure, finds definitions/references/patterns via serena LSP (Grep/Glob fallback). Returns a synthesized answer, not edits."

export const triglavSpecialistInfo: SpecialistInfo = {
  name: "triglav",
  mode: "subagent",
  description: TRIGLAV_DESCRIPTION,
  metadata: {
    category: "exploration",
    cost: "FREE",
    keyTrigger: "2+ modules / unfamiliar area involved → fire `triglav` before planning",
    useWhen: [
      "Multiple search angles needed",
      "Unfamiliar module structure",
      "Cross-layer pattern discovery",
      "User asks where/how something works in the codebase",
    ],
    avoidWhen: [
      "You already know the exact file/location",
      "A single keyword/grep suffices",
      "The target was just shown in this conversation",
    ],
    triggers: [
      {
        domain: "Code exploration",
        trigger: "Find definitions, references, structure, and patterns in the local codebase",
      },
    ],
  },
}
```

- [ ] **Step 2: Write `triglav.md` (body only — frontmatter is assembled in Step 3)**

````markdown
# Triglav — Codebase Exploration Specialist

You are **Triglav**, a read-only codebase exploration specialist for the Perun coordinator. You are a contextual grep for the codebase — broad, parallel, interpretive. You map structure, find definitions/references/patterns, and return a concise synthesis. You do NOT perform work or modify files.

## Before ANY search: analyze

Emit an `<analysis>` block first, with three fields:

- **Literal Request:** what was literally asked.
- **Actual Need:** the underlying goal behind the request.
- **Success Looks Like:** the concrete done-criterion for this exploration.

## Fire in parallel

In your **first action**, launch **3+ tools simultaneously** (semantic + structural + text). Go sequential **only** when an input genuinely depends on a prior result. Cross-validate findings across tools — flood with parallel calls rather than tiptoeing one at a time.

## Tool selection (serena-first)

Reach for serena's semantic LSP tools first; Grep/Glob are peer fallbacks for a different job, not failure modes:

| You need | Use |
|---|---|
| Definitions / references / symbols | `serena_find_symbol`, `serena_find_referencing_symbols`, `serena_get_symbols_overview` |
| Structural code patterns | `serena_search_for_pattern` |
| Raw strings / comments | `Grep` |
| Files by name / extension | `Glob` |
| File contents | `serena_read_file` / `Read` |
| History / who-changed | `Bash(git log:*)`, `Bash(git blame:*)` |

**If a `serena_*` call errors** (server unavailable), do NOT retry it — switch to `Grep`/`Glob`/`Read` and continue. Exploration still works without serena, just less semantically.

## Read-only

You cannot create, modify, or delete files. Report findings as message text — never write files, never edit, never run mutating commands.

## Output

Always end with the EXACT skeleton below. In `<answer>`, **explain the mechanism** you found — never paste whole files. All paths **absolute** (start with `/`). **No emojis** — keep output machine-parseable.

**Output size:** never paste file bodies; cap `<files>` to the ~15-20 most relevant entries (one line each) and summarize the long tail in `<answer>`. Keep total output well under 100KB so it is never truncated mid-block.

```
<analysis>
Literal Request: ...
Actual Need: ...
Success Looks Like: ...
</analysis>
<results>
  <files>
  /abs/path/foo.ts:42 — what is here and why it matters
  </files>
  <answer>
  Direct synthesis answering the actual need (explain the mechanism, not a file list).
  </answer>
  <next_steps>
  Suggested follow-ups, or "Ready to proceed — no follow-up needed".
  </next_steps>
</results>
```

## Your response has FAILED if

- Any path is relative.
- You missed obvious matches.
- The caller must still ask "but where exactly?".
- You answered only the literal question, not the actual need.
- There is no `<results>` block.

## Done

Done = the caller can proceed **without a follow-up question**. Find **ALL** relevant matches, not just the first.
````

- [ ] **Step 3: Write the failing test for `prompt.ts`**

```typescript
import { describe, expect, it } from "vitest"
import { buildTriglavPrompt } from "../../../src/modules/explore/prompt.js"
import { TRIGLAV_TOOLS } from "../../../src/modules/explore/allowed-tools.js"

describe("buildTriglavPrompt", () => {
  const prompt = buildTriglavPrompt()

  it("assembles a frontmatter with name, mode, and the exact allow-list", () => {
    expect(prompt).toContain("name: triglav")
    expect(prompt).toContain("mode: subagent")
    expect(prompt).toContain(`allowed-tools: ${TRIGLAV_TOOLS.join(", ")}`)
  })

  // Anti-regression: pin the load-bearing prompt phrasings (mirrors omo's
  // explore-tool-strategy.test). Keep these to short semantic anchors.
  it("pins the load-bearing exploration directives", () => {
    expect(prompt).toContain("3+ tools simultaneously")
    expect(prompt).toContain("first action")
    expect(prompt).toContain("You cannot create, modify, or delete files")
    expect(prompt).toContain("absolute")
    expect(prompt).toContain("<analysis>")
    expect(prompt).toContain("<results>")
    expect(prompt).toContain("<files>")
    expect(prompt).toContain("<answer>")
    expect(prompt).toContain("<next_steps>")
    expect(prompt).toContain("FAILED if")
    expect(prompt).toContain("do NOT retry") // serena fallback rule
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/modules/explore/triglav-prompt.test.ts --config vitest.config.ts`
Expected: FAIL — cannot resolve `prompt.js`.

- [ ] **Step 5: Write `prompt.ts`**

```typescript
import { loadModuleAsset } from "../_shared/load-asset.js"
import { TRIGLAV_TOOLS } from "./allowed-tools.js"
import { triglavSpecialistInfo } from "./triglav.metadata.js"

let cached: string | undefined

/**
 * Assemble Triglav's full prompt: a frontmatter built from the single-source
 * metadata + TRIGLAV_TOOLS, followed by the static body from triglav.md. This
 * keeps the allow-list in exactly one place (no drift between md + code).
 */
export function buildTriglavPrompt(): string {
  if (cached === undefined) {
    const frontmatter = [
      "---",
      `name: ${triglavSpecialistInfo.name}`,
      `description: ${triglavSpecialistInfo.description}`,
      `mode: ${triglavSpecialistInfo.mode}`,
      `allowed-tools: ${TRIGLAV_TOOLS.join(", ")}`,
      "---",
    ].join("\n")
    const body = loadModuleAsset(import.meta.url, "triglav.md")
    cached = `${frontmatter}\n\n${body}`
  }
  return cached
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/modules/explore/triglav-prompt.test.ts --config vitest.config.ts`
Expected: PASS (2 tests). Then `npx tsc -p tsconfig.json --noEmit` → PASS.

> NOTE on asset copying: the root build copies module assets (e.g. `prompt-sections/`,
> `agents/`) into `dist/` via `scripts/copy-root-assets.mjs`. Verify `triglav.md`
> is picked up by that step in Task 6 (`verify-dist`); if a `.md` under
> `src/modules/explore/` is not copied, add the glob to `scripts/copy-root-assets.mjs`
> following how `src/modules/qa/prompt-sections/*.md` is handled.

- [ ] **Step 7: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/explore/triglav.metadata.ts src/modules/explore/triglav.md src/modules/explore/prompt.ts tests/modules/explore/triglav-prompt.test.ts && git commit -m "feat(explore): add Triglav metadata, prompt body, and assembly"
```

---

## Task 4: The explore plugin (registration + serena warning)

**Files:**
- Create: `src/modules/explore/index.ts`
- Test: `tests/modules/explore/plugin.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppVerkExplorePlugin } from "../../../src/modules/explore/index.js"
import { TRIGLAV_TOOLS } from "../../../src/modules/explore/allowed-tools.js"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"

function fakeInput(showToast = vi.fn(async () => {})) {
  return { client: { tui: { showToast } } } as never
}

describe("AppVerkExplorePlugin", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("registers triglav metadata in the factory body", async () => {
    await AppVerkExplorePlugin(fakeInput())
    expect(getAgentMetadataRegistry().map((a) => a.name)).toContain("triglav")
  })

  it("registers the triglav agent with mode subagent and the allow-list in its prompt", async () => {
    const hooks = await AppVerkExplorePlugin(fakeInput())
    const config: { agent?: Record<string, { mode?: string; prompt?: string; description?: string }> } = {}
    await hooks.config?.(config as never)
    const agent = config.agent?.["triglav"]
    expect(agent?.mode).toBe("subagent")
    expect(agent?.description).toContain("Read-only codebase explorer")
    expect(agent?.prompt).toContain(`allowed-tools: ${TRIGLAV_TOOLS.join(", ")}`)
  })

  it("warns exactly once on session.created when serena is absent", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkExplorePlugin(fakeInput(showToast))
    await hooks.config?.({ mcp: {} } as never) // no serena
    await hooks.event?.({ event: { type: "session.created" } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it("does not warn when serena is present", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkExplorePlugin(fakeInput(showToast))
    await hooks.config?.({ mcp: { serena: { type: "local" } } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/explore/plugin.test.ts --config vitest.config.ts`
Expected: FAIL — cannot resolve `index.js`.

- [ ] **Step 3: Write `index.ts`**

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { triglavSpecialistInfo } from "./triglav.metadata.js"
import { buildTriglavPrompt } from "./prompt.js"
import { isSerenaAvailable } from "./serena-detect.js"

export const AppVerkExplorePlugin: Plugin = async ({ client }) => {
  // Factory body runs in Promise.all before any config hook (src/index.ts), so
  // triglav's metadata is in the registry before getPerunPrompt() renders.
  registerAgentMetadata(triglavSpecialistInfo)

  // serena presence is read in the config hook (where `config` is available) and
  // surfaced as a one-time toast on session.created (where the TUI is ready) —
  // mirrors the coordinator's toast latch.
  let serenaMissing = false
  let toastShown = false

  return {
    config: async (config) => {
      config.agent ??= {}
      config.agent["triglav"] = {
        description: triglavSpecialistInfo.description,
        mode: "subagent",
        get prompt() {
          return buildTriglavPrompt()
        },
      }
      serenaMissing = !isSerenaAvailable(config)
    },
    event: async ({ event }) => {
      if (event.type !== "session.created") return
      if (toastShown || !serenaMissing) return
      const message =
        "Triglav registered but serena MCP not found — exploration runs in degraded mode (Grep/Glob). Install serena for semantic search."
      try {
        console.error(`Pantheon: ${message}`)
        await client.tui.showToast({
          body: { variant: "warning", title: "Pantheon", message },
        })
      } catch {
        // best-effort: headless / non-TUI invocations must not crash.
      }
      toastShown = true
    },
  }
}

export default AppVerkExplorePlugin
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/explore/plugin.test.ts --config vitest.config.ts`
Expected: PASS (4 tests). Then `npx tsc -p tsconfig.json --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/explore/index.ts tests/modules/explore/plugin.test.ts && git commit -m "feat(explore): add explore plugin registering Triglav + serena warning"
```

---

## Task 5: Wire into the harness + activate Perun's sections

**Files:**
- Modify: `src/index.ts`
- Modify: `src/agents/perun.md`
- Modify: `tests/modules/agent-registry/perun-prompt-integration.test.ts`
- Modify: `tests/modules/agent-registry/metadata-coverage.test.ts`

> The `perun.md` edit and the integration-test edit are COUPLED: `buildUseAvoidSection`
> throws on an unknown agent, and the integration test asserts no leftover `{...}`.
> Do them together (Steps 2 + 3) so the suite never goes red mid-task.

- [ ] **Step 1: Register the plugin in `src/index.ts`**

Add the import after the QA import (line 7, `import { AppVerkQAPlugin } from "./modules/qa/index.js"`):

```typescript
import { AppVerkExplorePlugin } from "./modules/explore/index.js"
```

Add `AppVerkExplorePlugin` to `defaultPluginFactories` (insert after `AppVerkQAPlugin`):

```typescript
const defaultPluginFactories: Plugin[] = [
  AppVerkCommitPlugin,
  AppVerkPythonDeveloperPlugin,
  AppVerkCodeReviewPlugin,
  AppVerkFrontendDeveloperPlugin,
  AppVerkSkillRegistryPlugin,
  AppVerkQAPlugin,
  AppVerkExplorePlugin,
  AppVerkSwiftDeveloperPlugin,
  AppVerkCoordinatorPlugin,
  AppVerkPantheonPlugin,
]
```

- [ ] **Step 2: Edit `src/agents/perun.md`**

Replace the placeholder block (the `{DELEGATION_TABLE}` line followed by the `---`):

```markdown
{DELEGATION_TABLE}

---
```

with (add the per-agent use/avoid placeholder):

```markdown
{DELEGATION_TABLE}

{USE_AVOID:triglav}

---
```

Then, in the `## Tool Usage Rules` section, add this bullet (after the existing
"Logical-name label exception" bullet) — only the parts metadata cannot express
(when/avoid guidance is already rendered by `{KEY_TRIGGERS}` + `{USE_AVOID:triglav}`):

```markdown
- **Triglav (exploration) dispatch.** Triglav is blocking — fire up to **4 in parallel** via `dispatch_parallel` for different search angles, then wait for results. **Delegation Trust Rule:** once you dispatch `triglav` for a search, do NOT redo that same search yourself.
```

- [ ] **Step 3: Update the integration test (coupled with Step 2)**

In `tests/modules/agent-registry/perun-prompt-integration.test.ts`, add the import:

```typescript
import { triglavSpecialistInfo } from "../../../src/modules/explore/triglav.metadata.js"
```

Change the `render()` helper's registry array to include triglav:

```typescript
function render(): string {
  const template = readFileSync(PERUN_MD, "utf8")
  return buildPerunPrompt(template, [
    fixAutoSpecialistInfo,
    zmoraSpecialistInfo,
    triglavSpecialistInfo,
  ])
}
```

Add a test asserting Triglav's sections render:

```typescript
it("renders Triglav's table row, key-trigger, delegation row, and use/avoid section", () => {
  const out = render()
  expect(out).toContain("| `triglav` | subagent |")
  expect(out).toContain("fire `triglav` before planning") // KEY_TRIGGERS
  expect(out).toContain("| Code exploration | `triglav` |") // DELEGATION_TABLE
  expect(out).toContain("### Use `triglav` when:") // USE_AVOID:triglav
  expect(out).toContain("Multiple search angles needed")
})
```

(The existing "leaves no unsubstituted placeholder" test now also covers
`{USE_AVOID:triglav}` — it must still pass because triglav is in the render array.)

- [ ] **Step 4: Update the anti-drift coverage test**

In `tests/modules/agent-registry/metadata-coverage.test.ts`, remove `triglav` from the
allow-list (it now MUST have metadata):

```typescript
const allowList = new Set<string>() // triglav now ships metadata (Spec 1B)
```

Construct the explore plugin so its `registerAgentMetadata` participates, and assert
coverage. Add to the existing anti-drift `it(...)` block (after the QA + coordinator
plugins are constructed):

```typescript
const { AppVerkExplorePlugin } = await import("../../../src/modules/explore/index.js")
await AppVerkExplorePlugin({ client: { tui: { showToast: async () => {} } } } as never)
// ... after collecting registered names:
expect(registered.has("triglav")).toBe(true)
```

- [ ] **Step 5: Run the affected tests**

Run: `npx vitest run tests/modules/agent-registry/ tests/modules/explore/ --config vitest.config.ts`
Expected: PASS (all). Then `npx tsc -p tsconfig.json --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/index.ts src/agents/perun.md tests/modules/agent-registry/perun-prompt-integration.test.ts tests/modules/agent-registry/metadata-coverage.test.ts && git commit -m "feat(explore): wire Triglav into the harness and Perun's prompt"
```

---

## Task 6: Full verification + dist sync

**Files:** none (verification only; may regenerate `dist/`)

- [ ] **Step 1: Full check suite**

Run: `npm run check`
Expected: PASS — typecheck + all tests (root vitest including the new `tests/modules/explore/*` + updated agent-registry tests) + build.

- [ ] **Step 2: Verify dist sync (confirms `triglav.md` asset copy)**

Run: `npm run verify-dist`
Expected: PASS. If it reports `dist/modules/explore/triglav.md` missing, the asset-copy
step did not pick it up — add the `src/modules/explore/*.md` glob to
`scripts/copy-root-assets.mjs` (mirroring how `src/modules/qa/prompt-sections/*.md` is
copied), rebuild (`npm run build:root`), and re-run.

- [ ] **Step 3: Commit regenerated dist**

```bash
AV_COMMIT_SKILL=1 git add dist scripts/copy-root-assets.mjs && git commit -m "build(dist): regenerate after Triglav exploration agent"
```

(If `git status` shows no `dist`/script changes, skip this commit.)

---

## Self-Review (completed during planning)

**Spec coverage:**
- New `src/modules/explore/` module (index/metadata/allowed-tools/serena-detect/prompt/triglav.md) → Tasks 1-4. ✓
- serena-first tools + Grep/Glob fallback + read-only allow-list → Task 1 + Task 3 (prompt). ✓
- omo-style `<analysis>`/`<results>` output + 9 prompt techniques + phrase-pin test → Task 3. ✓
- Metadata registration activating `{KEY_TRIGGERS}`/`{DELEGATION_TABLE}`/`{USE_AVOID:triglav}` → Tasks 3, 5. ✓
- serena absence → register + one-time warning + degrade → Task 4 + prompt fallback (Task 3). ✓
- Honest read-only framing (structured boundary; Bash accepted risk) → Task 1 comments + allow-list test. ✓
- Blocking dispatch, fire-up-to-4, Delegation Trust Rule → Task 5 perun.md note. ✓
- Coupled perun.md + integration-test edit → Task 5 (Steps 2-3 together). ✓
- Anti-drift allow-list update → Task 5 Step 4. ✓
- `package.json` files / root-plugin packed-files → verified NO change needed (`dist` glob + `arrayContaining` subset). ✓
- Output-size discipline (truncation safety) → Task 3 prompt body. ✓

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to" — every code step is complete. The two deferred items (extra serena tool names; asset-copy glob) are explicit, conditional NOTE blocks with concrete instructions, not vague placeholders.

**Type consistency:** `TRIGLAV_TOOLS` (string[]), `ConfigLike`, `isSerenaAvailable`, `triglavSpecialistInfo` (`SpecialistInfo`), `TRIGLAV_DESCRIPTION`, `buildTriglavPrompt()`, `AppVerkExplorePlugin` — names are identical across every task and test that references them. `SpecialistInfo` shape matches the 1A `agent-registry/agent-metadata.ts` definition.
