# Veles Planning Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **Veles**, a general planning specialist (`mode: "all"`) that Perun dispatches to author a QA test plan when `/run-qa` finds none, reusing a shared `qa-plan-authoring` skill; Veles can also be invoked directly by the user and can dispatch read-only helpers (Triglav now).

**Architecture:** New `src/modules/plan/` module mirrors the existing `src/modules/explore/` (Triglav) pattern. A narrow, caller-aware relaxation of the coordinator's anti-recursion guard lets a `primary` caller (Perun) dispatch the allowlisted `all`-mode Veles, while keeping every other invariant. The QA-plan authoring workflow is extracted from the `/create-qa-plan` command into a shared skill so both the command and Veles produce identical plans. Perun's Workflow 1 gains a no-plan branch (dispatch Veles → consent gate → run).

**Tech Stack:** TypeScript, `@opencode-ai/plugin` SDK, Bun, Vitest, tsup (bundle:false). OpenCode harness conventions (agents via `config.agent`, plugin tools via `AgentConfig.tools`, skills auto-discovered from `dist/skills`).

---

## Reference: verified codebase facts (read before starting)

- `validateDispatchable(agentRegistry, name)` is at `src/modules/coordinator/dispatch.ts:55-66`; it rejects any target whose `mode !== "subagent"`. Called at `dispatch.ts:173` (parallel) and `src/modules/coordinator/background.ts:39` (background).
- `loadAgentRegistry(client)` (`src/modules/coordinator/sdk-specialist.ts:~178-201`) returns `Record<string, { mode }>` for **every** agent, keyed by display name (Perun is `"Perun - Coordinator"`, mode `"primary"`).
- The dispatch tools' `execute(args, context)` receive `context.agent` — the **caller's** agent name (`ToolContext.agent`, `node_modules/@opencode-ai/plugin/dist/tool.d.ts`). So `agentRegistry[context.agent]?.mode` = caller's mode. No name comparison needed → the `"Perun - Coordinator"` naming pitfall is avoided.
- Agent module pattern to mirror: `src/modules/explore/{index.ts,prompt.ts,allowed-tools.ts,triglav.metadata.ts,serena-detect.ts}`.
- `mode: "all"` is a valid SDK `AgentConfig.mode` value (`node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`).
- Plugin tools (`dispatch_parallel` etc.) are enabled per-agent via the `AgentConfig.tools: { name: boolean }` map (see `src/modules/qa/index.ts:160-164`), NOT via the markdown `allowed-tools` frontmatter.
- Skills auto-discovered from `dist/skills/**/SKILL.md` (`packages/skill-registry/src/skill-catalog.ts:74-112`); the native `skill()` loader uses `config.skills.paths`. `parseSkillFrontmatter` splits `allowed-tools` on commas, line-by-line — frontmatter must be a **single line**.
- `/create-qa-plan` command frontmatter `allowed-tools` (`src/commands/create-qa-plan.md:2`) already grants: `Bash(gh:*), Bash(git:*), Bash(command:*), Bash(echo:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(mkdir:*), Bash(jq:*), Bash(date:*), Read, Write, Glob, Grep, todowrite, skill, question`.
- Build: `scripts/copy-root-assets.mjs` copies `commands/`, `agents/`, `skills/` and walks `src/modules/<name>/**/*.md`. `scripts/verify-dist-sync.mjs` fails if `dist` is stale → **rebuild + commit `dist`**.
- Test runner: `bun run test` (vitest). Single file: `bunx vitest run <path>`.

**Skill tool-set decision (resolves the exact-token subset concern):** the `qa-plan-authoring` skill declares `allowed-tools` using the **broad** tokens that are exact members of BOTH the command's and Veles's tool sets — `Bash(gh:*), Bash(git:*), Bash(command:*), Bash(date:*), Bash(mkdir:*), Read, Write, Glob, Grep`. `Bash(git:*)` covers the body's plain `git diff` / `git symbolic-ref … | sed …`. This makes `isToolSubset(skillTools, commandTools)` and `isToolSubset(skillTools, velesTools)` exact-true.

---

## Phase 1 — Caller-aware dispatch guard

### Task 1: Allowlist + caller-aware `validateDispatchable`

**Files:**
- Modify: `src/modules/coordinator/dispatch.ts:49-66`
- Test: `tests/modules/coordinator/validate-dispatchable.test.ts`

- [ ] **Step 1: Extend the failing test**

Replace the whole body of `tests/modules/coordinator/validate-dispatchable.test.ts` with:

```ts
import { describe, expect, it } from "vitest"
import {
  validateDispatchable,
  DISPATCHABLE_ALL_AGENTS,
  type AgentInfo,
} from "../../../src/modules/coordinator/dispatch.js"

const registry: Record<string, AgentInfo> = {
  zmora: { mode: "subagent" },
  perun: { mode: "primary" },
  omni: { mode: "all" },
  veles: { mode: "all" },
}

describe("validateDispatchable", () => {
  it("accepts a subagent regardless of caller mode", () => {
    expect(() => validateDispatchable(registry, "zmora")).not.toThrow()
    expect(() => validateDispatchable(registry, "zmora", "all")).not.toThrow()
    expect(() => validateDispatchable(registry, "zmora", "primary")).not.toThrow()
  })
  it("throws on an unknown agent", () => {
    expect(() => validateDispatchable(registry, "ghost")).toThrow(/Unknown agent: ghost/)
  })
  it("throws on a primary agent", () => {
    expect(() => validateDispatchable(registry, "perun", "primary")).toThrow(
      /Cannot dispatch primary agent: perun/,
    )
  })
  it("throws on a non-allowlisted all-agent even from a primary caller", () => {
    expect(() => validateDispatchable(registry, "omni", "primary")).toThrow(
      /Cannot dispatch all agent: omni/,
    )
  })
  it("allows an allowlisted all-agent (veles) when the caller is primary", () => {
    expect(() => validateDispatchable(registry, "veles", "primary")).not.toThrow()
  })
  it("rejects an allowlisted all-agent (veles) when the caller is not primary", () => {
    expect(() => validateDispatchable(registry, "veles", "all")).toThrow(
      /Cannot dispatch all agent: veles/,
    )
    expect(() => validateDispatchable(registry, "veles", "subagent")).toThrow(
      /Cannot dispatch all agent: veles/,
    )
  })
  it("rejects an allowlisted all-agent (veles) when caller mode is unknown", () => {
    expect(() => validateDispatchable(registry, "veles")).toThrow(
      /Cannot dispatch all agent: veles/,
    )
  })
  it("exposes the allowlist", () => {
    expect(DISPATCHABLE_ALL_AGENTS.has("veles")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/modules/coordinator/validate-dispatchable.test.ts`
Expected: FAIL — `DISPATCHABLE_ALL_AGENTS` is not exported; `validateDispatchable` ignores the 3rd arg.

- [ ] **Step 3: Implement the guard change**

In `src/modules/coordinator/dispatch.ts`, replace the existing comment block + `validateDispatchable` (lines 49-66) with:

```ts
/**
 * Names of `mode: "all"` agents that MAY be dispatched — but ONLY by a
 * primary-mode caller. This is the single narrow relaxation of the otherwise
 * subagent-only rule: it lets the primary coordinator (Perun) dispatch the
 * planning agent (Veles, a `mode: "all"` agent that is also user-switchable)
 * while still blocking Veles→Veles, *→Perun, and any other `primary`/`all`
 * target. Keep this set MINIMAL — every entry widens the anti-recursion surface.
 */
export const DISPATCHABLE_ALL_AGENTS = new Set<string>(["veles"])

/**
 * Anti-recursion guard. Dispatchable targets:
 *   - any strict `subagent` (from any caller), OR
 *   - an allowlisted `all` agent (DISPATCHABLE_ALL_AGENTS) when the CALLER is
 *     `primary`.
 * Everything else throws: a `primary` target, a non-allowlisted `all` target,
 * or an allowlisted `all` target dispatched by a non-primary caller (this last
 * case blocks Veles→Veles self/nested recursion). `callerMode` is resolved by
 * the dispatch tool from `agentRegistry[context.agent].mode`; when omitted
 * (legacy callers / unit tests) the allowlisted-`all` path is closed, so the
 * default stays safe. Shared by `dispatchParallel` and the background path.
 */
export function validateDispatchable(
  agentRegistry: Record<string, AgentInfo>,
  name: string,
  callerMode?: AgentInfo["mode"],
): void {
  const agentInfo = agentRegistry[name]
  if (agentInfo === undefined) {
    throw new Error(`Unknown agent: ${name}`)
  }
  if (agentInfo.mode === "subagent") {
    return
  }
  if (
    agentInfo.mode === "all" &&
    DISPATCHABLE_ALL_AGENTS.has(name) &&
    callerMode === "primary"
  ) {
    return
  }
  throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${name}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/modules/coordinator/validate-dispatchable.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Commit**

```bash
git add src/modules/coordinator/dispatch.ts tests/modules/coordinator/validate-dispatchable.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(coordinator): caller-aware dispatch guard with all-agent allowlist"
```

---

### Task 2: Thread `callerMode` through the parallel path

**Files:**
- Modify: `src/modules/coordinator/dispatch.ts` (`DispatchParallelInput`, the validate loop)
- Modify: `src/modules/coordinator/index.ts:133-172` (`dispatchParallelTool.execute`)
- Test: `tests/modules/coordinator/dispatch.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `tests/modules/coordinator/dispatch.test.ts` (inside the top-level `describe`, after the existing tests — reuse the file's existing fake `specialist`/`agentRegistry` helpers; if it defines a local registry, add a `veles: { mode: "all" }` entry there too):

```ts
it("dispatches an allowlisted all-agent only when callerMode is primary", async () => {
  const agentRegistry = { veles: { mode: "all" as const }, triglav: { mode: "subagent" as const } }
  const specialist = makeFakeSpecialist() // existing helper in this file
  // primary caller → veles dispatch succeeds
  const ok = await dispatchParallel({
    tasks: [{ name: "veles", prompt: "plan" }],
    agentRegistry,
    specialist,
    callerMode: "primary",
  })
  expect(ok[0]!.status).toBe("success")
  // non-primary caller → veles task fails validation (thrown before spawn)
  await expect(
    dispatchParallel({
      tasks: [{ name: "veles", prompt: "plan" }],
      agentRegistry,
      specialist,
      callerMode: "all",
    }),
  ).rejects.toThrow(/Cannot dispatch all agent: veles/)
})
```

> If `dispatch.test.ts` has no reusable `makeFakeSpecialist`, define a minimal inline one implementing `DispatchSpecialist` (`startTask`/`fetchMessages`/`abortTask`/`startBackground`) that returns a session id and one assistant message with `finish_reason` set — copy the shape already used elsewhere in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/modules/coordinator/dispatch.test.ts`
Expected: FAIL — `callerMode` is not a recognized input field; validation does not receive it.

- [ ] **Step 3: Implement threading**

In `src/modules/coordinator/dispatch.ts`:

a) Add to the `DispatchParallelInput` interface (near the other fields, e.g. after `parentSessionID?`):

```ts
  /**
   * Mode of the agent that invoked the dispatch tool (resolved from
   * `agentRegistry[context.agent]`). Passed to `validateDispatchable` so an
   * allowlisted `all` target (Veles) is dispatchable only from a `primary`
   * caller (Perun). Omitted ⇒ allowlisted-`all` dispatch is rejected.
   */
  callerMode?: AgentInfo["mode"]
```

b) Destructure it in `dispatchParallel` (add `callerMode` to the `const { … } = input` block).

c) Update the validation loop (currently `dispatch.ts:172-174`):

```ts
  // Anti-recursion: validate every task BEFORE any session spawns.
  for (const task of tasks) {
    validateDispatchable(agentRegistry, task.name, callerMode)
  }
```

In `src/modules/coordinator/index.ts`, inside `dispatchParallelTool.execute`, after `const agentRegistry = await loadAgentRegistry(client)` (line 151) add:

```ts
      // Caller mode gates the allowlisted-`all` relaxation (Perun→Veles).
      // `context.agent` is the calling agent's name; look up its mode.
      const callerMode = agentRegistry[context.agent]?.mode
```

and add `callerMode,` to the `dispatchParallel({ … })` input object (line 157-170).

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/modules/coordinator/dispatch.test.ts`
Expected: PASS. Also run `bunx vitest run tests/modules/coordinator/dispatch-payload-passthrough.test.ts` to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/modules/coordinator/dispatch.ts src/modules/coordinator/index.ts tests/modules/coordinator/dispatch.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(coordinator): thread callerMode through dispatch_parallel"
```

---

### Task 3: Thread `callerMode` through the background path

**Files:**
- Modify: `src/modules/coordinator/background.ts:18-39` (`StartBackgroundInput`, the validate call)
- Modify: `src/modules/coordinator/index.ts:264-282` (`dispatchBackgroundTool.execute`)
- Test: `tests/modules/coordinator/background.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `tests/modules/coordinator/background.test.ts` (reuse the file's existing fakes for `store`/`specialist`; add `veles: { mode: "all" }` to the registry it uses):

```ts
it("starts an allowlisted all-agent in background only when callerMode is primary", async () => {
  const store = makeStore()            // existing helper
  const specialist = makeFakeSpecialist() // existing helper
  const agentRegistry = { veles: { mode: "all" as const } }
  await expect(
    startBackgroundTask({
      store, specialist, agentRegistry,
      parentSessionId: "s1", agent: "veles", prompt: "plan", callerMode: "primary",
    }),
  ).resolves.toMatchObject({ agent: "veles", status: "running" })
  await expect(
    startBackgroundTask({
      store, specialist, agentRegistry,
      parentSessionId: "s1", agent: "veles", prompt: "plan", callerMode: "all",
    }),
  ).rejects.toThrow(/Cannot dispatch all agent: veles/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/modules/coordinator/background.test.ts`
Expected: FAIL — `callerMode` not accepted; validation does not receive it.

- [ ] **Step 3: Implement threading**

In `src/modules/coordinator/background.ts`:

a) Add to `StartBackgroundInput`:

```ts
  /** Caller's mode — see dispatch.ts DispatchParallelInput.callerMode. */
  callerMode?: AgentInfo["mode"]
```

b) Destructure `callerMode` in `startBackgroundTask` and update the guard call (line 39):

```ts
  validateDispatchable(agentRegistry, agent, callerMode)
```

In `src/modules/coordinator/index.ts`, inside `dispatchBackgroundTool.execute`, after `const agentRegistry = await loadAgentRegistry(client)` (line 270) add:

```ts
      const callerMode = agentRegistry[context.agent]?.mode
```

and add `callerMode,` to the `startBackgroundTask({ … })` input (line 271-279).

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/modules/coordinator/background.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/coordinator/background.ts src/modules/coordinator/index.ts tests/modules/coordinator/background.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(coordinator): thread callerMode through dispatch_background"
```

---

### Task 4: Update model/user-visible guard strings

**Files:**
- Modify: `src/modules/coordinator/index.ts:87` (dispatch_parallel tool description bullet)

- [ ] **Step 1: Update the tool description**

In `src/modules/coordinator/index.ts`, replace the anti-recursion bullet (line 87):

```ts
        "- Anti-recursion pre-flight: every task is validated against the live agent registry BEFORE any session is created. Tasks targeting an unknown agent, a `mode: primary` agent, or a `mode: all` agent are rejected with a thrown error and no work is dispatched.",
```

with:

```ts
        "- Anti-recursion pre-flight: every task is validated against the live agent registry BEFORE any session is created. Tasks targeting an unknown agent or a `mode: primary` agent are rejected. A `mode: all` agent is rejected UNLESS it is on the dispatch allowlist (currently only `veles`) AND the caller is a primary agent; this lets the coordinator dispatch the planner while blocking self/nested recursion. Rejections throw and dispatch nothing.",
```

- [ ] **Step 2: Verify the perun-tools-sync test still passes (no tool name changed)**

Run: `bunx vitest run tests/modules/coordinator/perun-tools-sync.test.ts`
Expected: PASS (this task only edits a description string).

- [ ] **Step 3: Commit**

```bash
git add src/modules/coordinator/index.ts
AV_COMMIT_SKILL=1 git commit -m "docs(coordinator): document all-agent allowlist in dispatch_parallel description"
```

---

## Phase 2 — Shared `qa-plan-authoring` skill + thin command

### Task 5: Create the `qa-plan-authoring` skill

**Files:**
- Create: `src/skills/qa/qa-plan-authoring/SKILL.md`
- Test: `tests/skills/qa-plan-authoring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/skills/qa-plan-authoring.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/skills/qa-plan-authoring.test.ts`
Expected: FAIL — `SKILL.md` does not exist.

- [ ] **Step 3: Create the skill**

Create `src/skills/qa/qa-plan-authoring/SKILL.md` (note: `allowed-tools` is ONE line):

```markdown
---
name: qa-plan-authoring
description: Author a QA test plan from a code diff — resolve diff source, classify FE/BE, gather context, detect tools, infer Setup, generate scenarios, save the plan.
activation: Load when generating a QA test plan from code changes (used by /create-qa-plan and by the Veles planner).
allowed-tools: Bash(gh:*), Bash(git:*), Bash(command:*), Bash(date:*), Bash(mkdir:*), Read, Write, Glob, Grep
---

# QA Plan Authoring

Produce a comprehensive QA test plan from a set of code changes. The caller
decides what to do with the saved plan (the `/create-qa-plan` command tells the
user to review and run `/run-qa`; the Veles planner returns a JSON summary to
Perun). This skill covers ONLY authoring + saving.

## Step 1: Resolve the diff source

Parse the caller's argument to choose the diff:

| Argument | Diff |
|----------|------|
| (empty) | open PR on current branch, else branch diff vs main |
| `#123` / `PR #123` | `gh pr diff 123` |
| `feature/xyz` | `git diff <main>...feature/xyz` |
| `this branch` / `current branch` | `git diff <main>...HEAD` |
| `last N commits` | `git diff HEAD~N...HEAD` |
| `staged` | `git diff --staged` |

Default (no argument):

```bash
gh pr view --json number,title,headRefName,baseRefName 2>/dev/null
# if a PR exists:
gh pr diff <number>
# else, branch diff:
MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
git diff $MAIN_BRANCH...HEAD
```

Also collect the changed file list (`gh pr diff <n> --name-only`, or `git diff --name-only <range>`).

## Step 2: Classify each changed file FE vs BE

- **Frontend:** `.tsx/.jsx/.vue/.svelte/.css/.scss/.html`; paths with `components/ pages/ views/ layouts/ styles/ public/ assets/ frontend/ client/ web/`.
- **Backend:** `.py/.php/.go/.java/.rb/.rs`; paths with `api/ controllers/ models/ migrations/ serializers/ services/ repositories/ backend/ server/`; `urls.py routes.py routes.php router.go`.
- **Ambiguous** (`.ts/.js`): inspect imports/path context.

For each file note: what changed, change kind (new/modify/delete/refactor), what behavior to test.

## Step 3: Gather context

Read related files: routers/URL configs, serializers/schemas, models for changed endpoints; parent components, stores, API calls for changed components; endpoints using changed models/migrations. Look for `docs/`, OpenAPI/Swagger (`openapi.{json,yaml}`, `swagger.{json,yaml}`), READMEs, and existing tests (what is already covered vs missing).

## Step 4: Detect available tools

```bash
command -v curl >/dev/null 2>&1 && echo "curl: available" || echo "curl: unavailable"
command -v http >/dev/null 2>&1 && echo "httpie: available" || echo "httpie: unavailable"
command -v psql >/dev/null 2>&1 && echo "psql: available" || echo "psql: unavailable"
command -v sqlite3 >/dev/null 2>&1 && echo "sqlite3: available" || echo "sqlite3: unavailable"
command -v mysql >/dev/null 2>&1 && echo "mysql: available" || echo "mysql: unavailable"
command -v playwright >/dev/null 2>&1 && echo "Playwright CLI: available" || echo "Playwright CLI: unavailable"
```

## Step 5: Output format + Setup section

Load the format skill: `skill(name: "test-plan-format")`. Follow it for frontmatter (`source`, `branch`, `base-url`, `detected-tools`) and overall structure.

Generate the `## Setup` section (placed after frontmatter, before `## FE Test Scenarios` / `## BE Test Scenarios`) by inferring from the diff:

- New `process.env.X` / `os.environ["X"]` / `getenv("X")` / `ENV["X"]` → add `X` to `**Required environment variables:**` (name must match `^[A-Z_][A-Z0-9_]*$`).
- New service URL (`https?://localhost:\d+`, `redis://`, `postgres://`, `mongodb://`) → `**Required services:**`.
- New DB connection string → `**Required databases:**` with an explicit scheme (`postgresql://…`, `mysql://…`, `redis://…`, `sqlite:///…`).

Rules: one backtick group per item; free text after it is for humans; ≤50 items; omit the whole `## Setup` section if nothing is needed. Mark items as best-effort inferences for the user to review.

## Step 6: Generate scenarios

- **FE** (if FE changes): one scenario per changed component/page/feature, concrete UI element names from the code, ≥2 edge cases each.
- **BE** (if BE changes): one scenario per changed endpoint, real paths/methods/payloads, DB checks with real table/column names, ≥2 edge cases each (error handling, auth, validation).

## Step 7: Save

```bash
mkdir -p docs/testing/plans
date +%Y-%m-%d
```

Write with the `Write` tool to `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md`, where `<topic>` is a slug (lowercase, hyphens) summarizing the changes. Return the saved path to the caller.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/skills/qa-plan-authoring.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/skills/qa/qa-plan-authoring/SKILL.md tests/skills/qa-plan-authoring.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(qa): add shared qa-plan-authoring skill"
```

---

### Task 6: Refactor `/create-qa-plan.md` to a thin command

**Files:**
- Modify: `src/commands/create-qa-plan.md`
- Test: `tests/commands/create-qa-plan-thin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commands/create-qa-plan-thin.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const md = readFileSync(
  path.resolve(__dirname, "../../src/commands/create-qa-plan.md"),
  "utf8",
)

describe("/create-qa-plan thin command", () => {
  it("delegates to the qa-plan-authoring skill", () => {
    expect(md).toContain('skill(name: "qa-plan-authoring")')
  })
  it("keeps the todowrite progress tasks command-side", () => {
    expect(md).toContain("todowrite")
  })
  it("keeps the closing /run-qa proposal", () => {
    expect(md).toContain("/run-qa")
  })
  it("no longer inlines the full diff-classification workflow", () => {
    expect(md).not.toContain("Frontend indicators:")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/commands/create-qa-plan-thin.test.ts`
Expected: FAIL — the command still inlines the workflow; no `skill(name: "qa-plan-authoring")`.

- [ ] **Step 3: Rewrite the command**

Replace the entire contents of `src/commands/create-qa-plan.md` with:

```markdown
---
allowed-tools: Bash(gh:*), Bash(git:*), Bash(command:*), Bash(echo:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(mkdir:*), Bash(jq:*), Bash(date:*), Read, Write, Glob, Grep, todowrite, skill, question
argument-hint: [PR number, branch name, or natural language description of changes to analyze]
description: Analyze code changes (PR, branch, commits) and generate a detailed QA test plan with FE and BE scenarios, edge cases, and tool detection.
---

# QA Test Plan Generator

Analyze code changes and generate a comprehensive QA test plan.

**Input:** `$ARGUMENTS` (PR number, branch, `last N commits`, `staged`, or empty for the default: open PR on current branch → branch diff vs main).

## Workflow

### Step 1: Create progress tasks

Create these tasks with `todowrite`:

| # | subject | activeForm |
|---|---------|-----------|
| 1 | Author test plan | Authoring test plan... |
| 2 | Save & propose next step | Saving test plan... |

Mark task 1 `in_progress`.

### Step 2: Author the plan

Load and follow the authoring skill, passing `$ARGUMENTS` as the diff-source argument:

```
skill(name: "qa-plan-authoring")
```

The skill resolves the diff source, classifies FE/BE, gathers context, detects tools, generates the `## Setup` section and FE/BE scenarios (loading `test-plan-format` for the structure), and saves the plan to `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md`.

Mark task 1 `completed`, task 2 `in_progress`.

### Step 3: Propose next step

After the skill saves the plan, display:

> **Test plan saved to `docs/testing/plans/<filename>`.**
>
> Review the plan, then run the tests with:
>
> `/run-qa`
>
> or specify the plan path:
>
> `/run-qa docs/testing/plans/<filename>`

Mark task 2 `completed`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/commands/create-qa-plan-thin.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/commands/create-qa-plan.md tests/commands/create-qa-plan-thin.test.ts
AV_COMMIT_SKILL=1 git commit -m "refactor(qa): make /create-qa-plan a thin wrapper over qa-plan-authoring"
```

---

## Phase 3 — Veles agent module

### Task 7: `veles.metadata.ts`

**Files:**
- Create: `src/modules/plan/veles.metadata.ts`
- Test: `tests/modules/plan/veles-metadata.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/plan/veles-metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  VELES_AGENT_KEY,
  velesSpecialistInfo,
} from "../../../src/modules/plan/veles.metadata.js"

describe("velesSpecialistInfo", () => {
  it("is keyed 'veles' and is mode all", () => {
    expect(VELES_AGENT_KEY).toBe("veles")
    expect(velesSpecialistInfo.name).toBe("veles")
    expect(velesSpecialistInfo.mode).toBe("all")
  })
  it("is a specialist with EXPENSIVE cost and a planning trigger", () => {
    expect(velesSpecialistInfo.metadata.category).toBe("specialist")
    expect(velesSpecialistInfo.metadata.cost).toBe("EXPENSIVE")
    expect(velesSpecialistInfo.metadata.triggers.length).toBeGreaterThan(0)
    expect(velesSpecialistInfo.metadata.keyTrigger).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/modules/plan/veles-metadata.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the metadata**

Create `src/modules/plan/veles.metadata.ts`:

```ts
import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/** Canonical agent key for the Veles planning specialist. */
export const VELES_AGENT_KEY = "veles" as const

export const VELES_DESCRIPTION =
  "Planning specialist: authors QA test plans (and other work plans) from a diff or request. Dispatches read-only helpers (triglav) and returns a plan it saved — it does not execute the planned work."

export const velesSpecialistInfo: SpecialistInfo = {
  name: VELES_AGENT_KEY,
  mode: "all",
  description: VELES_DESCRIPTION,
  metadata: {
    category: "specialist",
    cost: "EXPENSIVE",
    keyTrigger:
      "QA run requested but no plan exists → dispatch `veles` to author one before attempting QA",
    useWhen: [
      "No QA plan exists and the user wants to run QA",
      "User asks to plan QA scenarios or a piece of work from a diff/request",
    ],
    avoidWhen: [
      "A current QA plan already exists in docs/testing/plans/",
      "The task is execution, not planning (dispatch zmora / fix-auto instead)",
    ],
    triggers: [
      {
        domain: "Planning",
        trigger: "Author a QA test plan (or other work plan) from a diff or request",
      },
    ],
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/modules/plan/veles-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/plan/veles.metadata.ts tests/modules/plan/veles-metadata.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(plan): add veles specialist metadata"
```

---

### Task 8: `allowed-tools.ts` (`VELES_TOOLS`)

**Files:**
- Create: `src/modules/plan/allowed-tools.ts`
- Test: `tests/modules/plan/allowed-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/plan/allowed-tools.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/modules/plan/allowed-tools.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the tool set**

Create `src/modules/plan/allowed-tools.ts`:

```ts
// Built-in tool allow-list for the Veles planning agent (emitted into the
// prompt frontmatter). PLUGIN tools (dispatch_parallel / dispatch_background /
// poll_background / wait_background) are NOT listed here — they are enabled via
// the `AgentConfig.tools` boolean map in index.ts (mirrors QA's execute_recipe
// opt-in). The git/gh/command/date/mkdir Bash tokens are the BROAD forms that
// are exact members of the /create-qa-plan command's allow-list, so the shared
// qa-plan-authoring skill's allowed-tools are an exact subset of both callers.

const SERENA_READ_TOOLS = [
  "serena_find_symbol",
  "serena_find_referencing_symbols",
  "serena_get_symbols_overview",
  "serena_search_for_pattern",
  "serena_find_file",
  "serena_list_dir",
  "serena_read_file",
]

const STRUCTURED_TOOLS = ["Read", "Glob", "Grep", "Write"]

const BASH_TOOLS = [
  "Bash(gh:*)",
  "Bash(git:*)",
  "Bash(command:*)",
  "Bash(date:*)",
  "Bash(mkdir:*)",
]

const HARNESS_TOOLS = ["skill", "question"]

export const VELES_TOOLS: string[] = [
  ...SERENA_READ_TOOLS,
  ...STRUCTURED_TOOLS,
  ...BASH_TOOLS,
  ...HARNESS_TOOLS,
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/modules/plan/allowed-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/plan/allowed-tools.ts tests/modules/plan/allowed-tools.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(plan): add VELES_TOOLS built-in allow-list"
```

---

### Task 9: `veles.md` prompt + `prompt.ts`

**Files:**
- Create: `src/modules/plan/veles.md`
- Create: `src/modules/plan/prompt.ts`
- Test: `tests/modules/plan/veles-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/plan/veles-prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildVelesPrompt } from "../../../src/modules/plan/prompt.js"
import { VELES_TOOLS } from "../../../src/modules/plan/allowed-tools.js"

describe("buildVelesPrompt", () => {
  const prompt = buildVelesPrompt()

  it("assembles frontmatter with name, mode all, and the exact allow-list", () => {
    expect(prompt).toContain("name: veles")
    expect(prompt).toContain("mode: all")
    expect(prompt).toContain(`allowed-tools: ${VELES_TOOLS.join(", ")}`)
  })
  it("pins the load-bearing planner directives", () => {
    expect(prompt).toContain("You are **Veles**")
    expect(prompt).toContain("do not execute")
    expect(prompt).toContain("qa-plan-authoring")
    expect(prompt).toContain("triglav")
    expect(prompt).toContain('"plan_path"')
    expect(prompt).toContain('"status"')
    expect(prompt).toContain("(reserved)")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/modules/plan/veles-prompt.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Create the prompt body and builder**

Create `src/modules/plan/veles.md`:

```markdown
# Veles — Pantheon Planning Specialist

You are **Veles**, the Pantheon planning specialist. You author plans and specs for the coordinator and the user. You **do not execute** the planned work — no source edits, no running the work. You write only the plan markdown.

## What you may write

Only plan/spec markdown files (e.g. under `docs/`). For QA plans, save under `docs/testing/plans/`. Never edit source code; never run build/test/deploy commands.

## Helpers you can dispatch

You may dispatch read-only helpers in parallel and synthesize their findings (do NOT redo a search you delegated):

- **`triglav`** — read-only codebase exploration (serena-first; maps structure, finds definitions/references/patterns). Fire it for unfamiliar areas before planning.
- **`oracle`** — strategic/architectural consultation. *(reserved — not yet available)*
- **`momus`** — adversarial plan critique. *(reserved — not yet available)*

Never dispatch yourself (`veles`) or the coordinator (Perun). Prefer your own `Read`/`Grep`/`Glob` (serena-first) for small lookups; delegate broad exploration to `triglav`.

## Context gathering

Serena-first: reach for `serena_find_symbol` / `serena_find_referencing_symbols` / `serena_get_symbols_overview` / `serena_search_for_pattern` before `Grep`/`Glob`. If a `serena_*` call errors, fall back to `Grep`/`Glob`/`Read` — do not retry the serena call.

## Modes

### Mode: QA test plan (active)

When asked to produce a QA test plan (the common case — input is a diff/scope):

1. Load and follow the authoring skill: `skill(name: "qa-plan-authoring")`. Pass the diff source / scope you were given. The skill resolves the diff, classifies FE/BE, gathers context, detects tools, generates `## Setup` + FE/BE scenarios (loading `test-plan-format`), and saves the plan.
2. Do NOT enter interview mode when the input is a clear diff/scope — just author the plan.
3. After the skill saves the plan, return your result as the JSON object below.

### Other modes *(reserved)*

Implementation plans, refactor plans, etc. — not yet wired. Do not attempt them yet.

## Interview mode

For ambiguous, custom planning requests (NOT the QA-from-diff path), use `question` to clarify scope before authoring. Skip it whenever the input already pins the scope.

## Output contract (REQUIRED)

End your turn with a single JSON object as your final message — nothing after it:

```json
{
  "status": "ok",
  "plan_path": "docs/testing/plans/2026-05-29-example-test-plan.md",
  "fe_count": 3,
  "be_count": 2,
  "setup_prereqs": ["TEST_USER_EMAIL", "http://localhost:3000"],
  "topic": "example"
}
```

- `status`: `"ok"` when a plan was written; `"error"` if you could not (e.g. no diff/changes — then `plan_path` empty and `fe_count`/`be_count` 0).
- `setup_prereqs`: the items from the plan's `## Setup` (empty array if none).
- `topic`: the slug used in the filename.

Return ONLY this JSON as the final message so the coordinator can parse it.
```

Create `src/modules/plan/prompt.ts`:

```ts
import { loadModuleAsset } from "../_shared/load-asset.js"
import { VELES_TOOLS } from "./allowed-tools.js"
import { velesSpecialistInfo } from "./veles.metadata.js"

let cached: string | undefined

export function buildVelesPrompt(): string {
  if (cached === undefined) {
    const frontmatter = [
      "---",
      `name: ${velesSpecialistInfo.name}`,
      `description: ${velesSpecialistInfo.description}`,
      `mode: ${velesSpecialistInfo.mode}`,
      `allowed-tools: ${VELES_TOOLS.join(", ")}`,
      "---",
    ].join("\n")
    const body = loadModuleAsset(import.meta.url, "veles.md")
    cached = `${frontmatter}\n\n${body}`
  }
  return cached
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/modules/plan/veles-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/plan/veles.md src/modules/plan/prompt.ts tests/modules/plan/veles-prompt.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(plan): add Veles prompt and builder"
```

---

### Task 10: `AppVerkPlanPlugin` + register in `src/index.ts`

**Files:**
- Create: `src/modules/plan/index.ts`
- Modify: `src/index.ts` (import + `defaultPluginFactories`)
- Create: `tests/modules/plan/plugin.test.ts`
- Create: `tests/modules/plan/veles-model-injection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/modules/plan/plugin.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppVerkPlanPlugin } from "../../../src/modules/plan/index.js"
import { VELES_TOOLS } from "../../../src/modules/plan/allowed-tools.js"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"

function fakeInput(showToast = vi.fn(async () => {})) {
  return { client: { tui: { showToast } } } as never
}

describe("AppVerkPlanPlugin", () => {
  beforeEach(() => clearAgentMetadataRegistry())

  it("registers veles metadata in the factory body", async () => {
    await AppVerkPlanPlugin(fakeInput())
    expect(getAgentMetadataRegistry().map((a) => a.name)).toContain("veles")
  })

  it("registers the veles agent as mode all with the allow-list in its prompt", async () => {
    const hooks = await AppVerkPlanPlugin(fakeInput())
    const config: {
      agent?: Record<string, { mode?: string; prompt?: string; tools?: Record<string, boolean> }>
    } = {}
    await hooks.config?.(config as never)
    const agent = config.agent?.["veles"]
    expect(agent?.mode).toBe("all")
    expect(agent?.prompt).toContain(`allowed-tools: ${VELES_TOOLS.join(", ")}`)
  })

  it("enables the dispatch plugin tools via the AgentConfig.tools map", async () => {
    const hooks = await AppVerkPlanPlugin(fakeInput())
    const config: { agent?: Record<string, { tools?: Record<string, boolean> }> } = {}
    await hooks.config?.(config as never)
    const tools = config.agent?.["veles"]?.tools
    expect(tools?.dispatch_parallel).toBe(true)
    expect(tools?.dispatch_background).toBe(true)
    expect(tools?.poll_background).toBe(true)
    expect(tools?.wait_background).toBe(true)
  })

  it("warns exactly once on session.created when serena is absent", async () => {
    const showToast = vi.fn(async () => {})
    const hooks = await AppVerkPlanPlugin(fakeInput(showToast))
    await hooks.config?.({ mcp: {} } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    await hooks.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
  })
})
```

Create `tests/modules/plan/veles-model-injection.test.ts` (copy `tests/modules/explore/triglav-model-injection.test.ts` verbatim, then change: import `AppVerkPlanPlugin` from `../../../src/modules/plan/index.js`; import `VELES_AGENT_KEY` from `../../../src/modules/plan/veles.metadata.js`; replace `TRIGLAV_AGENT_KEY`→`VELES_AGENT_KEY` and the JSON key `"triglav"`→`"veles"` in each `writeUserGlobal(...)`; rename the temp-dir prefix to `pantheon-plan-`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/modules/plan/plugin.test.ts tests/modules/plan/veles-model-injection.test.ts`
Expected: FAIL — `src/modules/plan/index.ts` does not exist.

- [ ] **Step 3: Create the plugin**

Create `src/modules/plan/index.ts`:

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import { VELES_AGENT_KEY, velesSpecialistInfo } from "./veles.metadata.js"
import { buildVelesPrompt } from "./prompt.js"
import { isSerenaAvailable } from "../explore/serena-detect.js"

export const AppVerkPlanPlugin: Plugin = async ({ client }) => {
  registerAgentMetadata(velesSpecialistInfo)

  let serenaMissing = false
  let toastShown = false

  return {
    config: async (config) => {
      config.agent ??= {}
      config.agent[VELES_AGENT_KEY] = {
        description: velesSpecialistInfo.description,
        mode: "all",
        get prompt() {
          return buildVelesPrompt()
        },
        // Plugin tools are opt-in per agent. Veles orchestrates read-only
        // helpers (triglav now), so it needs the dispatch tools. These are
        // the coordinator's process-wide tools — enabling here, not in the
        // markdown allow-list (which is a no-op for plugin tools).
        tools: {
          dispatch_parallel: true,
          dispatch_background: true,
          poll_background: true,
          wait_background: true,
        },
      }
      // Inject model AFTER registration (mirrors triglav/zmora/perun). Model
      // already validated by MODEL_REGEX — see pantheon-config/schema.ts.
      const velesModel = loadPantheonConfig().agents.veles?.model
      if (velesModel !== undefined) {
        config.agent[VELES_AGENT_KEY].model = velesModel
      }
      serenaMissing = !isSerenaAvailable(config)
    },
    event: async ({ event }) => {
      if (event.type !== "session.created") return
      if (toastShown || !serenaMissing) return
      const message =
        "Veles registered but serena MCP not found — planning runs in degraded mode (Grep/Glob). Install serena for semantic context."
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

export default AppVerkPlanPlugin
```

In `src/index.ts`, add the import (next to the other module imports, after the explore import):

```ts
import { AppVerkPlanPlugin } from "./modules/plan/index.js"
```

and add `AppVerkPlanPlugin,` to the `defaultPluginFactories` array (place it right after `AppVerkExplorePlugin,`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/modules/plan/`
Expected: PASS (metadata + prompt + allowed-tools + plugin + model-injection).

- [ ] **Step 5: Commit**

```bash
git add src/modules/plan/index.ts src/index.ts tests/modules/plan/plugin.test.ts tests/modules/plan/veles-model-injection.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(plan): register AppVerkPlanPlugin (Veles) in the harness"
```

---

### Task 11: Renderer test for an `all`-mode specialist row

**Files:**
- Test: `tests/modules/agent-registry/all-mode-row.test.ts`

- [ ] **Step 1: Write the test (no current specialist is `all`)**

Create `tests/modules/agent-registry/all-mode-row.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildSpecialistsTable,
  type SpecialistInfo,
} from "../../../src/modules/agent-registry/index.js"

const veles: SpecialistInfo = {
  name: "veles",
  mode: "all",
  description: "planner",
  metadata: { category: "specialist", cost: "EXPENSIVE", triggers: [] },
}

describe("buildSpecialistsTable with an all-mode specialist", () => {
  it("renders the mode value verbatim in the row", () => {
    const table = buildSpecialistsTable([veles])
    expect(table).toContain("| `veles` | all | planner |")
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bunx vitest run tests/modules/agent-registry/all-mode-row.test.ts`
Expected: PASS (the renderer already interpolates `mode` verbatim — this locks the `all` value in).

- [ ] **Step 3: Commit**

```bash
git add tests/modules/agent-registry/all-mode-row.test.ts
AV_COMMIT_SKILL=1 git commit -m "test(agent-registry): cover all-mode specialist table row"
```

---

## Phase 4 — Perun + run-qa integration

### Task 12: `run-qa.md` — hand off instead of hard-aborting on no plan

**Files:**
- Modify: `src/commands/run-qa.md` (the "no plans found" branch)
- Test: `tests/commands/run-qa-no-plan-handoff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commands/run-qa-no-plan-handoff.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const md = readFileSync(
  path.resolve(__dirname, "../../src/commands/run-qa.md"),
  "utf8",
)

describe("/run-qa no-plan handoff", () => {
  it("no longer tells the user to run /create-qa-plan first", () => {
    expect(md).not.toContain("Run `/create-qa-plan` first")
  })
  it("hands off the no-plan case to @perun", () => {
    expect(md).toContain("@perun")
    expect(md).toMatch(/no QA plan/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/commands/run-qa-no-plan-handoff.test.ts`
Expected: FAIL — `run-qa.md` still contains "Run `/create-qa-plan` first".

- [ ] **Step 3: Edit `run-qa.md`**

In `src/commands/run-qa.md`, find the "no plans found" block (around line 30):

```markdown
If no plans found, inform the user and stop:

> No test plans found in `docs/testing/plans/`. Run `/create-qa-plan` first.
```

Replace it with:

```markdown
If no plans found, do NOT stop — hand the no-plan case to `@perun`, forwarding any scope the user passed in `$ARGUMENTS`:

```
@perun no QA plan found — author one for "<$ARGUMENTS or 'current changes'>" then run it
```

Perun will dispatch the Veles planner, show a consent gate, and run the generated plan on approval. (Do NOT dispatch or author the plan yourself — your `allowed-tools` deliberately omit dispatch.)
```

Leave the user-supplied bad-path branch ("Test plan not found: `<path>`…") unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/commands/run-qa-no-plan-handoff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/run-qa.md tests/commands/run-qa-no-plan-handoff.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(qa): /run-qa hands no-plan case to @perun instead of aborting"
```

---

### Task 13: `perun.md` — no-plan branch + Planning-consent gate

**Files:**
- Modify: `src/agents/perun.md` (Workflow 1 Step 1; new dialog-state section)
- Test: `tests/modules/coordinator/perun-veles-flow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/coordinator/perun-veles-flow.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/modules/coordinator/perun-veles-flow.test.ts`
Expected: FAIL — perun.md has none of these strings yet.

- [ ] **Step 3: Edit `perun.md`**

a) Replace Workflow 1, Step 1 (currently `perun.md:47`):

```markdown
1. **Read the test plan.** Use `Read` to load the file. If no path is given, scan `docs/testing/plans/` via `Bash(ls:*)` and pick the most recent `.md` file.
```

with:

```markdown
1. **Read the test plan, or author one if none exists.** Use `Read` to load the file. If no path is given, scan `docs/testing/plans/` via `Bash(ls:*)` and pick the most recent `.md` file.

   **No-plan branch.** If the scan finds no `.md` plan (or you were handed off from `/run-qa` with "no QA plan found"):

   a. Dispatch the Veles planner to author one:
   ```
   dispatch_parallel({
     agent: "veles",
     summary: "author QA plan: <short topic, ≤80 chars total>",
     tasks: [{ name: "veles", prompt: "Generate a QA test plan for <diff source / scope forwarded from the user>. Default diff source: open PR on current branch, else branch diff vs main." }]
   })
   ```
   b. Parse Veles's result as JSON: `{ status, plan_path, fe_count, be_count, setup_prereqs, topic }`. This is the planner's summary — do NOT run it through `assign_issue_ids` or the Step-6 finding parser.
   c. If `status` is `"error"`/`"timeout"`, or `fe_count + be_count === 0`, tell the user no runnable plan could be authored and STOP (do not show the consent gate).
   d. Otherwise enter the **Planning-consent gate** (see the dedicated section below). On approval, continue this workflow at **Step 2** using `plan_path`.
```

b) Add a new subsection immediately AFTER the existing "### Resume semantics" block (so it sits with the other dialog states):

```markdown
### Planning-consent gate

Used only by Workflow 1 Step 1's no-plan branch, after Veles authors a plan. This is a distinct cross-turn dialog state. Unlike NEED_INFO/preflight resume, there is NO wave snapshot — the canonical state carried across the pause is the `plan_path` Veles returned, which you MUST include in your turn text so the next turn can act on it.

Emit this template verbatim, filling the slots:

```
🧭 No QA plan existed — Veles authored one:

  Plan: <plan_path>
  Scenarios: <fe_count> FE, <be_count> BE
  Setup prerequisites: <setup_prereqs joined by ", ", or "none">

Run QA on this plan now? Reply 'yes' to run, 'abort' to stop
(the plan is saved either way — you can review/edit it first).
```

On the next turn:
- Reply is `yes` (or yes-equivalent per the resume intent map) → start Workflow 1 at **Step 2** using `plan_path` (Read → sanitize → preflight → dispatch).
- Reply is `abort` (or abort-equivalent) → stop; the plan stays saved.
- Ambiguous reply → ask once: "Run QA on `<plan_path>`? Reply 'yes' or 'abort'."

This gate is INTRA-Workflow-1 and does NOT emit a Composability proposal. The normal post-run fix proposal still fires after the QA run completes.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/modules/coordinator/perun-veles-flow.test.ts`
Expected: PASS. Also run `bunx vitest run tests/modules/coordinator/perun-qa-flow.test.ts` to confirm no regression in the existing flow assertions.

- [ ] **Step 5: Commit**

```bash
git add src/agents/perun.md tests/modules/coordinator/perun-veles-flow.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(coordinator): Perun authors a QA plan via Veles when none exists"
```

---

## Phase 5 — Build, full verification, finalize

### Task 14: Rebuild `dist`, run the full suite, commit artifacts

**Files:**
- Modify: `dist/**` (generated)

- [ ] **Step 1: Typecheck + lint**

Run: `bun run typecheck` (or `bunx tsc --noEmit -p tsconfig.json`) and `bun run lint`
Expected: no errors. Fix any type/lint issues inline (e.g. unused imports).

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: all tests pass, including the new `tests/modules/plan/`, `tests/skills/`, `tests/commands/`, and the coordinator guard tests.

- [ ] **Step 3: Build and verify dist sync**

Run: `bun run build` then `node scripts/verify-dist-sync.mjs` (or `bun run verify-dist` if that script exists)
Expected: build emits `dist/modules/plan/{index.js,prompt.js,allowed-tools.js,veles.metadata.js,veles.md}` and `dist/skills/qa/qa-plan-authoring/SKILL.md`; verify-dist-sync reports the tree is in sync after you stage the new dist files.

- [ ] **Step 4: Commit the rebuilt dist**

```bash
git add dist
AV_COMMIT_SKILL=1 git commit -m "chore(build): rebuild dist with Veles planner + qa-plan-authoring skill"
```

- [ ] **Step 5: Final smoke check of the whole branch**

Run: `git log --oneline origin/master..HEAD`
Expected: the ordered set of feat/refactor/test/chore commits from Tasks 1–14 on `feature/veles-planning-agent`.

---

## Self-review checklist (completed during planning)

- **Spec coverage:** §1 role → Tasks 7-10; §2 module → Tasks 7-10; §3 guard → Tasks 1-4; §4 skill → Task 5; §5 command → Task 6; §6 prompt/contract → Task 9; §7 Perun+run-qa → Tasks 12-13; §8 plumbing → Tasks 10, 14; §9 testing → tests in every task + Tasks 11; §10 out-of-scope (Oracle/Momus) → represented as `(reserved)` in `veles.md`, no tasks (correct).
- **Guard mechanism:** uses the verified `agentRegistry[context.agent].mode` signal (not the non-existent `resolveParentID`); both call sites (Tasks 2, 3) updated; description string (Task 4) updated.
- **isToolSubset:** used only as a static authoring-discipline assertion (Tasks 5, 8), broad `Bash(git:*)` makes the subset exact-true; not presented as a runtime guard.
- **Type/name consistency:** `VELES_AGENT_KEY="veles"`, `velesSpecialistInfo`, `buildVelesPrompt`, `VELES_TOOLS`, `AppVerkPlanPlugin`, `DISPATCHABLE_ALL_AGENTS`, `callerMode` used identically across tasks. Veles output JSON keys (`status/plan_path/fe_count/be_count/setup_prereqs/topic`) match between `veles.md` (Task 9) and `perun.md` (Task 13).
- **No placeholders:** every code/markdown step contains the full content.
```
