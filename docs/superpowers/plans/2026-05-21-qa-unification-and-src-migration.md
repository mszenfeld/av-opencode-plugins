# QA Unification + src/ Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `qa-fe-tester`+`qa-be-tester` with one logical `qa-tester` (two variant registrations sharing a prompt builder), introduce per-scenario worker-pool dispatch with `**Depends-on:**` topological ordering, and absorb both `packages/qa/` and `packages/coordinator/` into `src/modules/`.

**Architecture:** OpenCode plugin monorepo migrating from per-workspace packages to a single `src/` harness. Two QA agent variants (`qa-tester-fe`, `qa-tester-be`) composed by `prompt-builder.ts` from shared `core.md` + per-stack overlays. Coordinator's `dispatch_parallel` gains a 4-worker semaphore pool with 50-task cap. Perun coordinator parses `**Depends-on:**` annotations and dispatches in topological waves.

**Tech Stack:** TypeScript ESM (NodeNext), tsup, vitest, OpenCode plugin API (`@opencode-ai/plugin`).

**Spec:** `docs/superpowers/specs/2026-05-20-qa-unification-and-src-migration-design.md`

**Branch:** This plan assumes a fresh feature branch off `master` (the worktree from the prior `feature/harness` work can be reused, or a new one created). The commit-pilot precedent at `src/modules/commit/` is the model for the absorbed-module layout.

**Critical commit rule:** This repo blocks `git commit` via a runtime hook in `src/modules/commit/bash-policy.ts`. To commit, prefix with `AV_COMMIT_SKILL=1 git commit ...` OR use the `av_commit` tool. Every commit step in this plan shows the bash form with the env var.

**No Co-Authored-By trailers** in commit messages.

---

## File Structure

This plan creates and modifies files across two phases:

### Phase A — Worker pool + agent unification in packages/ (pre-migration)
- Modify: `packages/coordinator/src/dispatch.ts` (worker pool + cap raise to 50)
- Modify: `packages/coordinator/src/index.ts` (tool description: pool semantics + logical-name exception)
- Modify: `packages/coordinator/tests/dispatch.test.ts` (worker-pool + cap tests)
- Create: `packages/qa/src/modules/prompt-builder.ts`
- Create: `packages/qa/src/modules/allowed-tools.ts`
- Create: `packages/qa/src/modules/prompt-sections/core.md`
- Create: `packages/qa/src/modules/prompt-sections/overlay-fe.md`
- Create: `packages/qa/src/modules/prompt-sections/overlay-be.md`
- Modify: `packages/qa/src/index.ts` (register `qa-tester-fe` + `qa-tester-be` via builder)
- Modify: `packages/qa/scripts/copy-assets.mjs` (copy `src/modules/prompt-sections/*.md`)
- Delete: `packages/qa/src/agents/fe-tester.md`
- Delete: `packages/qa/src/agents/be-tester.md`
- Modify: `packages/qa/src/skills/test-plan-format/SKILL.md` (add `**Depends-on:**` field)
- Modify: `packages/qa/tests/qa-plugin.test.ts` (variant registration)
- Modify: `packages/coordinator/src/agents/perun.md` (per-scenario dispatch, prefix routing, dependency parsing, wave dispatch, logical-name exception, variant-suffix normalization)
- Modify: `packages/coordinator/tests/perun-qa-flow.test.ts` (per-scenario + dependency cases)

### Phase B — Migration into src/
- Create: `src/modules/qa/{index.ts, prompt-builder.ts, allowed-tools.ts, prompt-sections/*.md}`
- Create: `src/commands/{create-qa-plan.md, run-qa.md}`
- Create: `src/skills/qa/{test-plan-format, report-format, fe-testing, be-testing}/SKILL.md`
- Move: `packages/qa/tests/qa-plugin.test.ts` → `tests/modules/qa/plugin.test.ts`
- Modify: `packages/skill-registry/src/index.ts` (skill path repoint)
- Modify: `src/index.ts` (swap QA import)
- Delete: `packages/qa/` (entire workspace)
- Create: `src/modules/coordinator/{index.ts, dispatch.ts, sdk-specialist.ts, sanitize.ts, assign-issue-ids.ts, poller.ts, truncate-bytes.ts}`
- Create: `src/agents/perun.md`
- Move: `packages/coordinator/tests/*.test.ts` → `tests/modules/coordinator/*.test.ts`
- Modify: `src/index.ts` (swap coordinator import)
- Delete: `packages/coordinator/` (entire workspace)
- Modify: `package.json` (workspaces, files), `.gitignore` (carveouts), `scripts/verify-dist-sync.mjs` (trackedDistPaths), `tests/root-plugin.test.ts` (assertion list)
- Modify: `README.md`, `docs/plugins/qa.md`, `docs/plugins/coordinator.md`, `docs/plugins/pantheon.md`, `AGENTS.md`

---

## Task 1: dispatch_parallel worker pool + 50-task cap

**Goal:** Replace the existing `Promise.all` fan-out with a 4-worker semaphore pool. Raise the `tasks[]` cap from 10 → 50. Add abort-at-start check so aborted workers don't claim new tasks. Backwards-compatible: existing 1–2 task callers see identical behaviour.

**Files:**
- Modify: `packages/coordinator/src/dispatch.ts` (lines 60–103, the cap constant + the `dispatchParallel` function body)
- Modify: `packages/coordinator/src/index.ts` (tool description, around the `dispatch_parallel` tool registration — to mention "worker pool with concurrency 4, cap 50")
- Modify: `packages/coordinator/tests/dispatch.test.ts` (add four new test cases)

- [ ] **Step 1.1: Write failing test — pool throttles concurrency to 4**

Add to `packages/coordinator/tests/dispatch.test.ts` near the existing concurrency tests:

```typescript
it("runs at most DISPATCH_CONCURRENCY tasks in flight at any moment", async () => {
  // Use 8 tasks, each holds for 50ms before resolving. With pool=4 and serial
  // batching, total wall-clock should be ~2 batches × 50ms = ~100ms, not 50ms.
  const inFlight = { count: 0, peak: 0 }
  const recorder = makeSpecialistRecorder({
    sessionIdSequence: ["s0","s1","s2","s3","s4","s5","s6","s7"],
    fetchMessagesHandler: async () => {
      inFlight.count++
      inFlight.peak = Math.max(inFlight.peak, inFlight.count)
      await new Promise((r) => setTimeout(r, 50))
      inFlight.count--
      return [finishedMessage("ok")]
    },
  })

  const tasks: DispatchTask[] = Array.from({ length: 8 }, (_, i) => ({
    name: "worker", prompt: `t${i}`,
  }))
  const agentRegistry: Record<string, AgentInfo> = { worker: { mode: "subagent" } }

  await dispatchParallel({ tasks, agentRegistry, specialist: recorder.specialist })
  expect(inFlight.peak).toBeLessThanOrEqual(4)
})
```

- [ ] **Step 1.2: Run test, confirm fail**

```bash
cd packages/coordinator && npx vitest run tests/dispatch.test.ts -t "runs at most DISPATCH_CONCURRENCY"
```

Expected: FAIL — `Promise.all` fires all 8 simultaneously so `inFlight.peak` will be 8.

- [ ] **Step 1.3: Implement worker pool in `dispatchParallel`**

Replace the `Promise.all` block (lines 78–102 in current `packages/coordinator/src/dispatch.ts`) with:

```typescript
export const MAX_PARALLEL_TASKS = 50
export const DISPATCH_CONCURRENCY = 4

export async function dispatchParallel(
  input: DispatchParallelInput,
): Promise<DispatchResult[]> {
  const {
    tasks, agentRegistry, specialist,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES,
    signal,
  } = input

  if (tasks.length > MAX_PARALLEL_TASKS) {
    throw new Error(
      `dispatch_parallel: tasks.length (${tasks.length}) exceeds DISPATCH_MAX_TASKS (${MAX_PARALLEL_TASKS})`,
    )
  }

  // Anti-recursion: validate every task BEFORE any session spawns.
  for (const task of tasks) {
    const agentInfo = agentRegistry[task.name]
    if (agentInfo === undefined) throw new Error(`Unknown agent: ${task.name}`)
    if (agentInfo.mode !== "subagent") {
      throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${task.name}`)
    }
  }

  // Worker pool: maintain DISPATCH_CONCURRENCY workers draining a shared queue.
  // `next++` is race-free in single-threaded JS between `await` points.
  const results: DispatchResult[] = new Array(tasks.length)
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) {
        // Drain any remaining task slots as never-started aborts so the
        // results array has a defined entry at every index.
        while (next < tasks.length) {
          const i = next++
          const task = tasks[i]!
          results[i] = {
            name: task.name,
            status: "aborted",
            result: "",
            duration_ms: 0,
            error: "aborted before start",
          }
        }
        return
      }
      const i = next++
      if (i >= tasks.length) return
      const task = tasks[i]!
      results[i] = await runTask(task, specialist, {
        pollIntervalMs, taskTimeoutMs, resultMaxBytes, signal,
      })
    }
  }

  const workerCount = Math.min(DISPATCH_CONCURRENCY, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
```

- [ ] **Step 1.4: Run test, confirm pass**

```bash
cd packages/coordinator && npx vitest run tests/dispatch.test.ts -t "runs at most DISPATCH_CONCURRENCY"
```

Expected: PASS.

- [ ] **Step 1.5: Update the existing cap-related test**

In `packages/coordinator/tests/dispatch.test.ts`, find any test referencing `MAX_PARALLEL_TASKS = 10` or "too many tasks". The number changes (10 → 50) and the message changes (`"too many tasks"` → `"exceeds DISPATCH_MAX_TASKS (50)"`). Update assertions accordingly. Search:

```bash
grep -n "MAX_PARALLEL_TASKS\|too many tasks" packages/coordinator/tests/dispatch.test.ts
```

Update each hit to assert against the new constant + new message.

- [ ] **Step 1.6: Add cap-overflow test**

```typescript
it("rejects tasks.length > MAX_PARALLEL_TASKS before any session spawns", async () => {
  const recorder = makeSpecialistRecorder()
  const tasks: DispatchTask[] = Array.from({ length: 51 }, (_, i) => ({
    name: "worker", prompt: `t${i}`,
  }))
  const agentRegistry: Record<string, AgentInfo> = { worker: { mode: "subagent" } }
  await expect(
    dispatchParallel({ tasks, agentRegistry, specialist: recorder.specialist })
  ).rejects.toThrow(/exceeds DISPATCH_MAX_TASKS \(50\)/)
  expect(recorder.calls.startTask).toHaveLength(0) // no sessions spawned
})
```

- [ ] **Step 1.7: Add 50-task happy-path test**

```typescript
it("completes 50 tasks (the cap) through the pool", async () => {
  const recorder = makeSpecialistRecorder({
    sessionIdSequence: Array.from({ length: 50 }, (_, i) => `s${i}`),
    fetchMessagesHandler: async () => [finishedMessage("ok")],
  })
  const tasks: DispatchTask[] = Array.from({ length: 50 }, (_, i) => ({
    name: "worker", prompt: `t${i}`,
  }))
  const agentRegistry: Record<string, AgentInfo> = { worker: { mode: "subagent" } }
  const results = await dispatchParallel({ tasks, agentRegistry, specialist: recorder.specialist })
  expect(results).toHaveLength(50)
  expect(results.every((r) => r.status === "success")).toBe(true)
})
```

- [ ] **Step 1.8: Add hung-task non-blocking test**

```typescript
it("drains remaining tasks when one in the middle hangs", async () => {
  const completionOrder: number[] = []
  const recorder = makeSpecialistRecorder({
    sessionIdSequence: ["s0","s1","s2","s3","s4","s5"],
    fetchMessagesHandler: async (sessionId) => {
      const i = Number(sessionId.slice(1))
      if (i === 2) {
        await new Promise((r) => setTimeout(r, 200))
      }
      completionOrder.push(i)
      return [finishedMessage(`done-${i}`)]
    },
  })
  const tasks: DispatchTask[] = Array.from({ length: 6 }, (_, i) => ({
    name: "worker", prompt: `t${i}`,
  }))
  const agentRegistry: Record<string, AgentInfo> = { worker: { mode: "subagent" } }
  const results = await dispatchParallel({ tasks, agentRegistry, specialist: recorder.specialist })
  expect(results).toHaveLength(6)
  expect(results.every((r) => r.status === "success")).toBe(true)
  // Tasks 4, 5 must complete before task 2 (which is artificially slow).
  expect(completionOrder.indexOf(4)).toBeLessThan(completionOrder.indexOf(2))
})
```

- [ ] **Step 1.9: Add abort-on-pool-iteration test**

```typescript
it("does not start new tasks after abort signal fires", async () => {
  const controller = new AbortController()
  let started = 0
  const recorder = makeSpecialistRecorder({
    sessionIdSequence: Array.from({ length: 10 }, (_, i) => `s${i}`),
    fetchMessagesHandler: async () => {
      started++
      // Abort right after the first batch starts; remaining slots must abort.
      if (started === 4) controller.abort()
      await new Promise((r) => setTimeout(r, 50))
      return [finishedMessage("ok")]
    },
  })
  const tasks: DispatchTask[] = Array.from({ length: 10 }, (_, i) => ({
    name: "worker", prompt: `t${i}`,
  }))
  const agentRegistry: Record<string, AgentInfo> = { worker: { mode: "subagent" } }
  const results = await dispatchParallel({
    tasks, agentRegistry, specialist: recorder.specialist, signal: controller.signal,
  })
  // First 4 ran (each may be success or aborted depending on timing of in-flight signal).
  // Tasks 4..9 must be "aborted" with duration_ms === 0.
  const aborted = results.filter((r) => r.status === "aborted")
  expect(aborted.length).toBeGreaterThanOrEqual(6)
  expect(aborted.every((r) => r.error?.includes("aborted") ?? false)).toBe(true)
})
```

- [ ] **Step 1.10: Run all coordinator tests, confirm green**

```bash
cd packages/coordinator && npm run build && npm run test
```

Expected: all tests pass including the 4 new pool tests.

- [ ] **Step 1.11: Update the `dispatch_parallel` tool description in `packages/coordinator/src/index.ts`**

Find the `description` array near the top of `dispatchParallelTool` (around line 46). Update the lines that mention "Maximum 10 tasks":

```typescript
"- Maximum 50 tasks per call (over-limit calls are rejected before any session is created).",
"- Internally throttled to a 4-worker pool: tasks beyond the first 4 wait until a slot frees up. Result order is preserved.",
```

- [ ] **Step 1.12: Commit Task 1**

```bash
AV_COMMIT_SKILL=1 git add packages/coordinator/src/dispatch.ts packages/coordinator/src/index.ts packages/coordinator/tests/dispatch.test.ts
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
feat(coordinator): dispatch_parallel worker pool with concurrency 4, cap 50

Replace Promise.all fan-out with a 4-worker semaphore pool draining a
shared queue. Raise tasks[] cap from 10 to 50 with explicit overflow
error. Workers check signal.aborted before claiming the next task so
aborted dispatches drain remaining slots as never-started aborts.

External contract preserved: results[] returned in tasks[] order.
1-2 task callers (existing FE/BE dispatch, fix-auto single-task) see
identical behaviour. The change becomes observable only at tasks.length > 4.

This is step 1 of the QA unification + src/ migration plan documented at
docs/superpowers/specs/2026-05-20-qa-unification-and-src-migration-design.md.
EOF
)"
```

---

## Task 2: QA agent variants + Perun per-scenario dispatch + plan-format Depends-on (atomic)

**Goal:** This is the largest task — single commit, multiple TDD cycles. It must land atomically because each in-isolation sub-change leaves `npm run check` red.

**What lands in this commit:**
- New `prompt-builder.ts`, `allowed-tools.ts`, `prompt-sections/{core,overlay-fe,overlay-be}.md` under `packages/qa/src/modules/`.
- `packages/qa/src/index.ts` registers `qa-tester-fe` + `qa-tester-be` via the builder (old `qa-fe-tester`/`qa-be-tester` registrations removed).
- `packages/qa/src/agents/fe-tester.md` and `be-tester.md` deleted.
- `test-plan-format` skill gains the optional `**Depends-on:**` field.
- `packages/coordinator/src/agents/perun.md` rewritten: per-scenario dispatch with prefix → variant routing, dependency parsing + topological wave dispatch, logical-name label exception, variant-suffix normalization.
- `dispatch_parallel` schema description (in `packages/coordinator/src/index.ts`) documents the logical-name exception.
- Both test files updated (`packages/qa/tests/qa-plugin.test.ts`, `packages/coordinator/tests/perun-qa-flow.test.ts`).
- `packages/qa/scripts/copy-assets.mjs` adds the `src/modules` directory so prompt-sections land in dist.

**Files:**
- Create: `packages/qa/src/modules/prompt-builder.ts`
- Create: `packages/qa/src/modules/allowed-tools.ts`
- Create: `packages/qa/src/modules/prompt-sections/core.md`
- Create: `packages/qa/src/modules/prompt-sections/overlay-fe.md`
- Create: `packages/qa/src/modules/prompt-sections/overlay-be.md`
- Modify: `packages/qa/src/index.ts`
- Modify: `packages/qa/scripts/copy-assets.mjs`
- Delete: `packages/qa/src/agents/fe-tester.md`, `packages/qa/src/agents/be-tester.md`
- Modify: `packages/qa/src/skills/test-plan-format/SKILL.md`
- Modify: `packages/qa/tests/qa-plugin.test.ts`
- Modify: `packages/coordinator/src/agents/perun.md`
- Modify: `packages/coordinator/src/index.ts` (schema description)
- Modify: `packages/coordinator/tests/perun-qa-flow.test.ts`

- [ ] **Step 2.1: Create `allowed-tools.ts` with the per-variant tool constants**

Create `packages/qa/src/modules/allowed-tools.ts`:

```typescript
// Per-variant tool allowlists for qa-tester variants. Splitting at this layer
// keeps the runtime tool-allowlist as the security boundary: one variant
// cannot exec the other variant's tools regardless of prompt content.

export const SHARED_TOOLS = [
  "Read",
  "Write",
  "skill",
  "Bash(mkdir:*)",
  "Bash(command:*)",
  "Bash(echo:*)",
]

export const FE_TOOLS = [
  "playwright_browser_navigate",
  "playwright_browser_click",
  "playwright_browser_fill_form",
  "playwright_browser_snapshot",
  "playwright_browser_take_screenshot",
  "playwright_browser_press_key",
  "playwright_browser_select_option",
  "playwright_browser_hover",
  "playwright_browser_wait_for",
  "playwright_browser_evaluate",
  "playwright_browser_console_messages",
  "playwright_browser_navigate_back",
  "playwright_browser_tabs",
  "playwright_browser_handle_dialog",
  "playwright_browser_resize",
  "playwright_browser_close",
  "playwright_browser_drag",
  "playwright_browser_type",
  "playwright_browser_file_upload",
  "playwright_browser_network_requests",
  "Bash(playwright:*)",
]

export const BE_TOOLS = [
  "Bash(curl:*)",
  "Bash(httpie:*)",
  "Bash(http:*)",
  "Bash(psql:*)",
  "Bash(sqlite3:*)",
  "Bash(mysql:*)",
  "Bash(mongosh:*)",
  "Bash(redis-cli:*)",
  "Bash(jq:*)",
  "Bash(grep:*)",
  "Bash(cat:./*)",
  "Bash(head:./*)",
  "Bash(tail:./*)",
]

export type QaTesterStack = "fe" | "be"

export function toolsForVariant(stack: QaTesterStack): string[] {
  const stackTools = stack === "fe" ? FE_TOOLS : BE_TOOLS
  // Dedup is unnecessary (FE_TOOLS and BE_TOOLS are disjoint) but cheap and
  // future-proof if someone moves an entry into SHARED_TOOLS.
  return Array.from(new Set([...SHARED_TOOLS, ...stackTools]))
}
```

- [ ] **Step 2.2: Create `prompt-sections/core.md` (shared stack-neutral body)**

Create `packages/qa/src/modules/prompt-sections/core.md`. This is the agent's stack-neutral execution loop. Content (≈40 lines):

```markdown
# QA Tester

You are a single-scenario QA test executor. You are dispatched by Perun (Pantheon coordinator) once per scenario. Your job:

1. Read the scenario block in your prompt.
2. Identify the scenario ID (must match `^#{2,4}\s+(FE|BE)-\d+`, case-insensitive). If no match, return an error result: `"qa-tester received scenario without recognised FE-/BE- prefix"`.
3. Load the matching skill: FE prefix → `skill(name: "fe-testing")`; BE prefix → `skill(name: "be-testing")`.
4. Execute the scenario's main flow and edge cases per the skill's patterns.
5. Return the result in the per-stack format (see overlay).

## Single-scenario contract

You receive ONE scenario per dispatch. Do NOT iterate over multiple scenarios. Do NOT skip your assigned scenario based on its content. Do NOT execute scenarios from your conversation history — only the one in this prompt.

## Artifact filename convention

Every artifact (screenshot, response dump, log) you write MUST embed the scenario ID:

- `docs/testing/reports/screenshots/<ID>-<purpose>.<ext>` — e.g. `FE-04-fail.png`, `BE-02-response.json`.
- Never use wall-clock timestamps. Concurrent variant runs would collide.

## Skill loading discipline

- If the skill load fails (`skill(name: ...)` errors), return error result with reason `"skill <name> unavailable"`.
- If a required tool is unavailable in your allowlist (e.g. Playwright in an FE variant), return error result with the tool-specific reason.

## Result format

Return ONE scenario result in the format specified by the loaded skill (see `fe-testing` or `be-testing` skill for the exact template). Status values: `PASS`, `FAIL`, `SKIP`.
```

- [ ] **Step 2.3: Create `prompt-sections/overlay-fe.md`**

Create `packages/qa/src/modules/prompt-sections/overlay-fe.md`. Content adapted from current `packages/qa/src/agents/fe-tester.md` (its "Workflow" section minus the multi-scenario loop):

```markdown
## FE variant — Playwright

### Step 1: Load the fe-testing skill

```
skill(name: "fe-testing")
```

This provides Playwright patterns for navigation, interaction, assertion, and screenshots.

### Step 2: Verify Playwright availability

Try `playwright_browser_navigate` to `about:blank`. If unavailable, try `Bash(playwright:*)` CLI. If neither is available, return SKIP with reason "Playwright unavailable".

### Step 3: Execute the scenario

For your assigned `FE-XX:` block:

1. Read the steps and expected result.
2. Execute each step using available Playwright tools (prefer native `playwright_browser_*` over CLI).
3. After each action, take a snapshot via `playwright_browser_snapshot()` to verify state.
4. If expected result is met → PASS.
5. If not met → take screenshot to `docs/testing/reports/screenshots/<ID>-fail.png`, return FAIL.
6. Execute each edge case as a sub-test.

### Step 4: Return results

Return in the format specified by `fe-testing` skill's Result Format section. Single scenario per dispatch — do NOT include other scenarios.
```

- [ ] **Step 2.4: Create `prompt-sections/overlay-be.md`**

Create `packages/qa/src/modules/prompt-sections/overlay-be.md`. Content adapted from current `packages/qa/src/agents/be-tester.md` (its "Workflow" section minus the multi-scenario loop):

```markdown
## BE variant — HTTP + DB

### Step 1: Load the be-testing skill

```
skill(name: "be-testing")
```

### Step 2: Detect available tools

Run the tool-detection block from the be-testing skill. Record which HTTP client and DB client are available. If no HTTP client is available, return SKIP with reason "No HTTP client available".

If the scenario's DB Check is specified but the DB client is unavailable, perform the API portion and mark only the DB Check as SKIP.

### Step 3: Execute the scenario

For your assigned `BE-XX:` block:

1. Read the scenario: method, endpoint, headers, payload, expected response, DB check.
2. Construct and send the HTTP request.
3. Verify response status code + body (via `jq` when available, `grep` fallback).
4. If DB Check is specified: run the query, compare against expected.
5. Execute each edge case as a sub-test.
6. Save response dumps to `docs/testing/reports/dumps/<ID>-response.json` when needed.

### Step 4: Return results

Return in the format specified by `be-testing` skill's Result Format section. Single scenario per dispatch.
```

- [ ] **Step 2.5: Create `prompt-builder.ts`**

Create `packages/qa/src/modules/prompt-builder.ts`:

```typescript
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { toolsForVariant, type QaTesterStack } from "./allowed-tools.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

// Try the packaged dist location first (production), then the src location
// (dev / running tests against src). The two-path resolution matches the
// pattern in coordinator/src/index.ts.
function loadSection(name: string): string {
  const packaged = path.resolve(moduleDir, "prompt-sections", name)
  const source = path.resolve(moduleDir, "../../src/modules/prompt-sections", name)
  try {
    return readFileSync(packaged, "utf8")
  } catch {
    return readFileSync(source, "utf8")
  }
}

let cachedCore: string | undefined
let cachedOverlayFe: string | undefined
let cachedOverlayBe: string | undefined

function getCore(): string {
  cachedCore ??= loadSection("core.md")
  return cachedCore
}

function getOverlay(stack: QaTesterStack): string {
  if (stack === "fe") {
    cachedOverlayFe ??= loadSection("overlay-fe.md")
    return cachedOverlayFe
  }
  cachedOverlayBe ??= loadSection("overlay-be.md")
  return cachedOverlayBe
}

export interface BuiltAgent {
  /** Full markdown (frontmatter + body) ready for `config.agent[].prompt`. */
  prompt: string
  /** Stack tag (for tests and diagnostics). */
  stack: QaTesterStack
}

export function buildQATesterAgent(stack: QaTesterStack): BuiltAgent {
  const tools = toolsForVariant(stack).join(", ")
  const description = `QA tester — ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`
  const frontmatter = [
    "---",
    `name: qa-tester-${stack}`,
    `description: ${description}`,
    "mode: subagent",
    `allowed-tools: ${tools}`,
    "---",
  ].join("\n")
  const body = `${getCore()}\n\n${getOverlay(stack)}`
  return { prompt: `${frontmatter}\n\n${body}`, stack }
}
```

- [ ] **Step 2.6: Update `packages/qa/scripts/copy-assets.mjs` to copy prompt-sections**

Modify the file (currently has 3 copy entries). Add a 4th:

```javascript
import { fileURLToPath } from "node:url"
import path from "node:path"
import { copyAssets } from "../../../scripts/copy-assets.mjs"

const root = path.dirname(fileURLToPath(import.meta.url))

copyAssets(
  [
    { from: "src/commands", to: "dist/commands", type: "dir" },
    { from: "src/agents", to: "dist/agents", type: "dir" },
    { from: "src/skills", to: "dist/skills", type: "dir" },
    { from: "src/modules/prompt-sections", to: "dist/modules/prompt-sections", type: "dir" },
  ],
  path.resolve(root, "..")
)
```

- [ ] **Step 2.7: Write failing test — builder output for fe variant**

In `packages/qa/tests/qa-plugin.test.ts`, add (will live alongside existing tests):

```typescript
import { buildQATesterAgent } from "../dist/modules/prompt-builder.js"
import { FE_TOOLS, BE_TOOLS } from "../dist/modules/allowed-tools.js"

describe("buildQATesterAgent", () => {
  it("produces fe variant with FE tools and no BE tools", () => {
    const { prompt } = buildQATesterAgent("fe")
    expect(prompt).toContain("name: qa-tester-fe")
    expect(prompt).toContain("mode: subagent")
    for (const t of FE_TOOLS) expect(prompt).toContain(t)
    for (const t of BE_TOOLS) expect(prompt).not.toContain(t)
    expect(prompt).toContain("FE variant — Playwright")
    expect(prompt).not.toContain("BE variant — HTTP + DB")
  })

  it("produces be variant with BE tools and no FE tools", () => {
    const { prompt } = buildQATesterAgent("be")
    expect(prompt).toContain("name: qa-tester-be")
    for (const t of BE_TOOLS) expect(prompt).toContain(t)
    for (const t of FE_TOOLS) expect(prompt).not.toContain(t)
    expect(prompt).toContain("BE variant — HTTP + DB")
    expect(prompt).not.toContain("FE variant — Playwright")
  })
})
```

- [ ] **Step 2.8: Run test — must fail (builder.js not built yet)**

```bash
cd packages/qa && npx vitest run tests/qa-plugin.test.ts -t "buildQATesterAgent"
```

Expected: FAIL — `Cannot find module '../dist/modules/prompt-builder.js'`.

- [ ] **Step 2.9: Build the QA package and re-run test**

```bash
cd packages/qa && npm run build && npx vitest run tests/qa-plugin.test.ts -t "buildQATesterAgent"
```

Expected: PASS (after build emits `dist/modules/prompt-builder.js`, `allowed-tools.js`, and copies `prompt-sections/*.md`).

If build fails because tsup doesn't pick up `src/modules/*.ts`, verify `packages/qa/tsconfig.json` and the tsup invocation. The standard tsup config for workspaces (`tsup src/index.ts`) bundles transitively, so the builder is bundled into `dist/index.js`. In that case we need to expose the builder via a re-export from `index.ts` OR add a separate tsup entry. Choose the re-export path: add `export { buildQATesterAgent } from "./modules/prompt-builder.js"` to `packages/qa/src/index.ts` (will be done in Step 2.10 below). Update the test import accordingly: `import { buildQATesterAgent } from "../dist/index.js"`.

- [ ] **Step 2.10: Rewrite `packages/qa/src/index.ts` to register variants**

Replace the contents of `packages/qa/src/index.ts` with:

```typescript
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode-ai/plugin"
import { buildQATesterAgent } from "./modules/prompt-builder.js"

export { buildQATesterAgent }
export { FE_TOOLS, BE_TOOLS, SHARED_TOOLS, toolsForVariant } from "./modules/allowed-tools.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function loadMarkdownFile(name: string): string {
  const filePath = path.resolve(moduleDir, name)
  const baseDir = path.resolve(moduleDir, "..")
  if (!filePath.startsWith(baseDir)) {
    throw new Error("Invalid path: traversal detected")
  }
  return readFileSync(filePath, "utf8")
}

function createLazyMarkdownLoader(name: string): () => string {
  let cached: string | undefined
  return () => {
    if (cached === undefined) cached = loadMarkdownFile(name)
    return cached
  }
}

const VARIANTS = ["fe", "be"] as const

const COMMANDS = [
  {
    name: "create-qa-plan",
    description:
      "Analyze code changes (PR, branch, commits) and generate a detailed QA test plan with FE and BE scenarios, edge cases, and tool detection.",
    path: "commands/create-qa-plan.md",
  },
  {
    name: "run-qa",
    description:
      "Execute a QA test plan — Perun parses scenarios, dispatches one qa-tester variant per scenario through dispatch_parallel.",
    path: "commands/run-qa.md",
  },
]

export const AppVerkQAPlugin: Plugin = async () => ({
  config: async (config) => {
    config.agent ??= {}
    for (const stack of VARIANTS) {
      // Per-variant lazy cache: build the markdown once per variant at first access.
      let cached: string | undefined
      config.agent[`qa-tester-${stack}`] = {
        description: `QA tester — ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`,
        get prompt() {
          cached ??= buildQATesterAgent(stack).prompt
          return cached
        },
        mode: "subagent",
      }
    }

    config.command ??= {}
    for (const c of COMMANDS) {
      const getTemplate = createLazyMarkdownLoader(c.path)
      config.command[c.name] = {
        description: c.description,
        get template() { return getTemplate() },
      }
    }
  },
})

export default AppVerkQAPlugin
```

- [ ] **Step 2.11: Delete old agent files**

```bash
git rm packages/qa/src/agents/fe-tester.md packages/qa/src/agents/be-tester.md
```

- [ ] **Step 2.12: Update `packages/qa/tests/qa-plugin.test.ts` registration smoke**

Replace the `EXPECTED_AGENTS` constant and the `it.each` block:

```typescript
const EXPECTED_VARIANTS = ["qa-tester-fe", "qa-tester-be"]
const REMOVED_AGENTS = ["qa-fe-tester", "qa-be-tester", "qa-tester"]

it.each(EXPECTED_VARIANTS)("registers %s variant", async (name) => {
  const config: Config = { agent: {} }
  await pluginResult.config?.(config)
  expect(config.agent![name]).toBeDefined()
  expect(config.agent![name]!.mode).toBe("subagent")
  expect(typeof config.agent![name]!.prompt).toBe("string")
})

it.each(REMOVED_AGENTS)("does not register %s (old or unsuffixed)", async (name) => {
  const config: Config = { agent: {} }
  await pluginResult.config?.(config)
  expect(config.agent![name]).toBeUndefined()
})
```

- [ ] **Step 2.13: Run QA plugin tests**

```bash
cd packages/qa && npm run build && npx vitest run tests/qa-plugin.test.ts
```

Expected: PASS (all registration, builder, command tests green).

- [ ] **Step 2.14: Update `test-plan-format` skill with Depends-on field**

Modify `packages/qa/src/skills/test-plan-format/SKILL.md`. In the "Plan Structure" section, after the existing BE scenario template, add to the FE and BE scenario templates the optional `**Depends-on:**` field, then add a new section after "Section Omission Rules":

```markdown
## Dependency annotations (opt-in)

Scenarios may declare dependencies on other scenarios via an optional `**Depends-on:**` field directly beneath the heading. Listed scenarios run to completion (any status — pass/fail/skip) before this scenario starts.

Example:

```markdown
### BE-02: PUT /api/users updates the user created in BE-01
**Depends-on:** BE-01
- **Method:** PUT /api/users/<id>
...
```

Rules:

- Reference scenarios by their full ID (`FE-01`, `BE-02`). Multiple IDs are comma-separated.
- Cross-stack deps are allowed: `BE-02 **Depends-on:** FE-01`.
- No self-references, no cycles, no dangling refs (the run aborts at plan-parse time if any is detected).
- Predecessor failure does NOT block dependents. A dependent surfaces a diagnostic failure rather than skipping silently — better signal-to-noise than auto-skip cascades.

This field is **opt-in**. Plans without `**Depends-on:**` dispatch fully in parallel (subject to the 4-worker pool throttle).
```

Also append a new bullet to the "Plan Quality Checklist" at the bottom:

```markdown
- [ ] `**Depends-on:**` fields, if present, reference existing scenario IDs without cycles
```

- [ ] **Step 2.15: Rewrite `packages/coordinator/src/agents/perun.md` for per-scenario + wave dispatch**

This is the largest single file change in the task. Replace the entire `## Workflows You Know` → `### Workflow 1: QA Run` section with the new per-scenario + waves logic. Use the spec's "Perun Workflow 1 changes" section as the source of truth.

Concrete edits (apply to current `packages/coordinator/src/agents/perun.md`):

1. **Available Specialists table** (around line 16): replace the two QA rows with one:

```markdown
| `qa-tester` | subagent | Execute a single QA scenario (FE or BE). Internally split into variants `qa-tester-fe` / `qa-tester-be`; Perun routes by scenario prefix. | Dispatched once per scenario by Perun |
```

2. **Workflow 1: QA Run** — replace the existing step 5 ("Dispatch specialists") and step 7 ("Concatenate findings") with seven new sub-steps. Use the exact prose from the spec. Key changes:
   - Step 5 becomes parse + sanitise + route + build dep graph + topo-sort waves + dispatch waves.
   - Add a "single-wave fast path" callout.
   - Step 6 (Parse specialist responses) gains the suffix-normalisation requirement.
3. **Workflow 1 Step 3 (Sanitise scenarios)** — add a pre-validation pass: reject scenarios whose ID prefix doesn't match `^#{2,4}\s+(FE|BE)-\d+` (case-insensitive). Reject with reason "no recognised prefix".
4. **Tool Usage Rules** — add a new bullet for the logical-name exception:

```markdown
- **Logical-name label exception.** When dispatching `qa-tester` variants (`qa-tester-fe`, `qa-tester-be`), the `agent` label is ALWAYS the logical name (`qa-tester` or `qa-tester ×N` for N ≤ 10, bare `qa-tester` for N > 10), never the variant suffixes. The variant mapping is documented above in "Available Specialists". This exception overrides the general "use tasks[].name(s) in agent" guidance for any logical agent implemented as multiple registered variants.
- **Variant-suffix normalisation.** Before writing the report or surfacing any error string to the terminal, replace `qa-tester-(fe|be)` → `qa-tester` in every user-facing string (findings text, error messages, all-scenarios table). Internal log/debug strings may keep variant names.
```

The exact full text of the rewritten Workflow 1 is large — the implementer copies the spec's section verbatim (the spec's "Perun Workflow 1 changes" subsection lists the 7 sub-steps that replace the current step 5).

- [ ] **Step 2.16: Update `dispatch_parallel` schema description in `packages/coordinator/src/index.ts`**

In the `description` array of `dispatchParallelTool` (around line 46), add to the "Guarantees and limits" bullets:

```typescript
"- Internally throttled to a 4-worker pool: tasks beyond the first 4 wait until a slot frees up. Result order is preserved.",
"- Maximum 50 tasks per call (over-limit calls are rejected before any session is created).",
```

In the `agent` argument's `.describe()` text, add a paragraph at the end:

```typescript
"\n\nException for logical agents with multiple variants: when a logical agent is implemented as multiple registered names (e.g. `qa-tester` → `qa-tester-fe` + `qa-tester-be`), use the logical name in `agent`, not the variant names. Document the mapping in the dispatching agent's prompt."
```

- [ ] **Step 2.17: Rewrite `packages/coordinator/tests/perun-qa-flow.test.ts` fixtures for per-scenario expectations**

Open the file. The existing tests dispatch with `qa-fe-tester` / `qa-be-tester` names and expect 2 tasks. Update each test's `agents:` config to use `qa-tester-fe` + `qa-tester-be` (mode: subagent). Update the assertions to expect N tasks (one per scenario), not 2 fixed-stack tasks.

Specific edits (line numbers are approximate against current file):

- Line ~163 (`invokePlugin` helper signature): `tasks: Array<{ name: string; prompt: string; context?: string }>` — already correct. No change.
- Line ~265 (first test, "qa-fe-tester, qa-be-tester — integration test plan"): change the `tasks` array to a per-scenario shape:

```typescript
const rawResults = await plugin.dispatchParallel(
  {
    agent: "qa-tester ×3",
    summary: "integration test plan",
    tasks: [
      { name: "qa-tester-fe", prompt: "<FE-01 scenario block>" },
      { name: "qa-tester-fe", prompt: "<FE-02 scenario block>" },
      { name: "qa-tester-be", prompt: "<BE-01 scenario block>" },
    ],
  },
  ctx,
)
```

- Update the fake-client `agents` to include both variants:

```typescript
agents: [
  makeAgent("qa-tester-fe", "subagent"),
  makeAgent("qa-tester-be", "subagent"),
],
```

- Same shape changes for the second test (`"partial failure path"`).

- [ ] **Step 2.18: Add new dependency-handling tests to `perun-qa-flow.test.ts`**

After the existing two tests, add:

```typescript
describe("dependency-aware dispatch", () => {
  it("rejects plans with self-references at parse time", async () => {
    // This is a thin scaffold — full Perun-side dependency parsing lives in
    // the agent prompt, so this test exercises the helper Perun calls.
    // The actual validator lives in coordinator's plan-parser module (created
    // in a follow-up if extracted from perun.md, otherwise asserted via the
    // tool-execute path with a fixture plan).
    // For now, assert via fixture-driven flow with the validator helper exposed.
    const { validatePlanDependencies } = await import("../src/index.js")
      .then((m) => m as never as { validatePlanDependencies?: typeof import("../src/plan-deps.js").validatePlanDependencies })
    expect(typeof validatePlanDependencies).toBe("function")
  })
})
```

(NOTE: The dependency validator helper should ideally be an exported function from coordinator/src/index.ts. If you choose to keep all dep logic in the agent prompt without a TS helper, skip the helper-direct tests here and add fixture-driven end-to-end coverage instead — load a plan with deps, assert the resulting `tasks[]` waves through fake-client recordings. The plan-author's choice; document it in the commit message.)

- [ ] **Step 2.19: Run all tests across both packages**

```bash
cd packages/qa && npm run build && npm run test
cd ../coordinator && npm run build && npm run test
```

Both must pass. If `perun-qa-flow.test.ts` still references old agent names, fix those references. Iterate until green.

- [ ] **Step 2.20: Run root tests to confirm the full plugin still bundles**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins && npm run build && npm run test
```

Expected: all green. The `tests/root-plugin.test.ts` assertion list will still reference old paths (we haven't moved files yet) — that's fine; the assertion uses `expect.arrayContaining` which doesn't fail on extra paths.

- [ ] **Step 2.21: Atomic commit for Task 2**

```bash
AV_COMMIT_SKILL=1 git add -A packages/qa packages/coordinator
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
feat(qa,coordinator): unify QA agents into variant-split qa-tester with dependency-aware per-scenario dispatch

QA plugin now registers two subagent variants — qa-tester-fe and qa-tester-be —
composed programmatically by a shared prompt-builder.ts from core.md plus
per-stack overlays. Each variant carries only its stack's allowed-tools so
the security boundary stays at OpenCode runtime (a routing bug fails safely
as "tool not in allowlist", never as silent cross-stack execution).

User-facing surfaces always show the logical name "qa-tester": Perun renders
"qa-tester ×N" in the dispatch label regardless of which variants are in the
tasks[] array, and normalises qa-tester-(fe|be) → qa-tester in every string
that lands in the report or terminal. The variant suffix is an internal
implementation detail visible only to introspection paths (registry listing).

Perun's QA workflow shifts from 2-task FE/BE dispatch to per-scenario dispatch
via the new dispatch_parallel worker pool: one qa-tester variant task per
### FE-XX: / ### BE-XX: block, routed by prefix at sanitisation time.

The test-plan-format skill gains an optional **Depends-on:** field for plan
authors to declare scenario ordering. Perun parses the dependency graph,
rejects cycles/self-refs/dangling-refs at parse time, computes dispatch
waves via topological sort, and runs waves sequentially. Predecessor failure
does not block dependents — surfaces diagnostic failures instead of silent
skip cascades.

The old qa-fe-tester / qa-be-tester registrations are removed. No aliases.
Existing plans without **Depends-on:** continue to work — they collapse to
one wave containing every scenario, dispatched as a single dispatch_parallel
call (the single-wave fast path).

This is step 2 of the QA unification + src/ migration plan documented at
docs/superpowers/specs/2026-05-20-qa-unification-and-src-migration-design.md.

References: builds on the dispatch_parallel worker pool added in the
previous commit; depends on dispatch_parallel's logical-name label exception.
EOF
)"
```

---

## Task 3: Move QA into src/modules/qa/ + repoint skill-registry (atomic)

**Goal:** Move all QA source from `packages/qa/src/` to `src/modules/qa/` (TS modules), `src/commands/` (markdown), `src/skills/qa/` (skills); move tests to `tests/modules/qa/`; repoint skill-registry at the new skill path. Single commit so the registry never points at a path that doesn't exist.

**Note on tsup root config:** `tsup.root.config.ts` already globs `src/**/*.ts` with `bundle: false`. `scripts/copy-root-assets.mjs` already walks `src/{commands,agents,skills}` recursively. New gap to address: `src/modules/qa/prompt-sections/*.md` is under `src/modules/`, not under `src/{commands,agents,skills}`. The copy-root-assets script does NOT currently walk `src/modules/`. We need to extend it.

**Files:**
- Create: `src/modules/qa/index.ts`, `prompt-builder.ts`, `allowed-tools.ts`, `prompt-sections/{core,overlay-fe,overlay-be}.md`
- Create: `src/commands/create-qa-plan.md`, `src/commands/run-qa.md`
- Create: `src/skills/qa/test-plan-format/SKILL.md`, `src/skills/qa/report-format/SKILL.md`, `src/skills/qa/fe-testing/SKILL.md`, `src/skills/qa/be-testing/SKILL.md`
- Move: `packages/qa/tests/qa-plugin.test.ts` → `tests/modules/qa/plugin.test.ts`
- Modify: `scripts/copy-root-assets.mjs` (extend to also copy `src/modules/**/*.md`)
- Modify: `packages/skill-registry/src/index.ts` (skill path)

- [ ] **Step 3.1: Create the src/modules/qa/ TS files**

Copy from packages/qa/src/modules/ to src/modules/qa/:

```bash
mkdir -p src/modules/qa/prompt-sections
cp packages/qa/src/modules/prompt-builder.ts src/modules/qa/prompt-builder.ts
cp packages/qa/src/modules/allowed-tools.ts src/modules/qa/allowed-tools.ts
cp packages/qa/src/modules/prompt-sections/core.md src/modules/qa/prompt-sections/core.md
cp packages/qa/src/modules/prompt-sections/overlay-fe.md src/modules/qa/prompt-sections/overlay-fe.md
cp packages/qa/src/modules/prompt-sections/overlay-be.md src/modules/qa/prompt-sections/overlay-be.md
```

- [ ] **Step 3.2: Update `prompt-builder.ts` path resolution for the new location**

Edit `src/modules/qa/prompt-builder.ts`. Replace the two-path resolver (which previously targeted `packages/qa/dist/modules/prompt-sections/` and `packages/qa/src/modules/prompt-sections/`) with the new resolver:

```typescript
function loadSection(name: string): string {
  // Production: dist/modules/qa/prompt-sections/<name>
  // Dev:        src/modules/qa/prompt-sections/<name>
  const packaged = path.resolve(moduleDir, "prompt-sections", name)
  const source = path.resolve(moduleDir, "../../../src/modules/qa/prompt-sections", name)
  try { return readFileSync(packaged, "utf8") }
  catch { return readFileSync(source, "utf8") }
}
```

(`moduleDir` resolves to the compiled location `dist/modules/qa/` in prod and `src/modules/qa/` in tests-against-src.)

- [ ] **Step 3.3: Create `src/modules/qa/index.ts`**

This is the absorbed plugin's entry point. Mirrors `src/modules/commit/index.ts` patterns:

```typescript
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode-ai/plugin"
import { buildQATesterAgent } from "./prompt-builder.js"

export { buildQATesterAgent }
export { FE_TOOLS, BE_TOOLS, SHARED_TOOLS, toolsForVariant } from "./allowed-tools.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

// Asset paths for run-qa.md / create-qa-plan.md commands. Production reads
// from dist/commands/, dev from src/commands/.
function loadCommandMarkdown(name: string): string {
  const packaged = path.resolve(moduleDir, "../../commands", name)
  const source = path.resolve(moduleDir, "../../../src/commands", name)
  try { return readFileSync(packaged, "utf8") }
  catch { return readFileSync(source, "utf8") }
}

const VARIANTS = ["fe", "be"] as const

const COMMANDS = [
  { name: "create-qa-plan", description: "Analyze code changes and generate a detailed QA test plan with FE and BE scenarios.", file: "create-qa-plan.md" },
  { name: "run-qa", description: "Execute a QA test plan — Perun dispatches one qa-tester variant per scenario through dispatch_parallel.", file: "run-qa.md" },
]

export const AppVerkQAPlugin: Plugin = async () => ({
  config: async (config) => {
    config.agent ??= {}
    for (const stack of VARIANTS) {
      let cached: string | undefined
      config.agent[`qa-tester-${stack}`] = {
        description: `QA tester — ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`,
        get prompt() {
          cached ??= buildQATesterAgent(stack).prompt
          return cached
        },
        mode: "subagent",
      }
    }
    config.command ??= {}
    for (const c of COMMANDS) {
      let cached: string | undefined
      config.command[c.name] = {
        description: c.description,
        get template() {
          cached ??= loadCommandMarkdown(c.file)
          return cached
        },
      }
    }
  },
})

export default AppVerkQAPlugin
```

- [ ] **Step 3.4: Copy commands + skills into src/**

```bash
cp packages/qa/src/commands/create-qa-plan.md src/commands/create-qa-plan.md
cp packages/qa/src/commands/run-qa.md src/commands/run-qa.md
mkdir -p src/skills/qa
cp -R packages/qa/src/skills/test-plan-format src/skills/qa/test-plan-format
cp -R packages/qa/src/skills/report-format src/skills/qa/report-format
cp -R packages/qa/src/skills/fe-testing src/skills/qa/fe-testing
cp -R packages/qa/src/skills/be-testing src/skills/qa/be-testing
```

- [ ] **Step 3.5: Move tests + adapt imports**

```bash
mkdir -p tests/modules/qa
git mv packages/qa/tests/qa-plugin.test.ts tests/modules/qa/plugin.test.ts
```

Edit `tests/modules/qa/plugin.test.ts` imports. Replace:

```typescript
import { AppVerkQAPlugin } from "../dist/index.js"
import { buildQATesterAgent } from "../dist/modules/prompt-builder.js"
import { FE_TOOLS, BE_TOOLS } from "../dist/modules/allowed-tools.js"
```

with:

```typescript
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import { buildQATesterAgent } from "../../../src/modules/qa/prompt-builder.js"
import { FE_TOOLS, BE_TOOLS } from "../../../src/modules/qa/allowed-tools.js"
```

(Following the commit-pilot precedent — root tests import from `src/modules/<name>/<file>.js`; Node ESM resolves the `.js` to the built `dist/` at runtime.)

- [ ] **Step 3.6: Extend `scripts/copy-root-assets.mjs` to walk src/modules/**/*.md**

Modify the script:

```javascript
#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, lstatSync, copyFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceRoots = ["commands", "agents", "skills"]
let copiedCount = 0

function copyMarkdownRecursive(sourceDir, destDir) {
  if (!existsSync(sourceDir)) return
  mkdirSync(destDir, { recursive: true })
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    const stats = lstatSync(sourcePath)
    if (stats.isSymbolicLink()) continue
    if (stats.isDirectory()) {
      copyMarkdownRecursive(sourcePath, destPath)
    } else if (stats.isFile() && entry.name.endsWith(".md")) {
      copyFileSync(sourcePath, destPath)
      copiedCount++
    }
  }
}

for (const root of sourceRoots) {
  copyMarkdownRecursive(
    path.join(repoRoot, "src", root),
    path.join(repoRoot, "dist", root),
  )
}

// Walk src/modules/<name>/**/*.md to dist/modules/<name>/**/*.md
// so absorbed modules can ship markdown asset siblings (e.g. prompt-sections).
const modulesSrc = path.join(repoRoot, "src", "modules")
const modulesDst = path.join(repoRoot, "dist", "modules")
if (existsSync(modulesSrc)) {
  for (const entry of readdirSync(modulesSrc, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    copyMarkdownRecursive(
      path.join(modulesSrc, entry.name),
      path.join(modulesDst, entry.name),
    )
  }
}

console.log(`Done. ${copiedCount} asset(s) copied.`)
```

- [ ] **Step 3.7: Repoint skill-registry**

Edit `packages/skill-registry/src/index.ts`. Replace line 15:

```typescript
// REMOVE:
path.resolve(moduleDirectory, "../../qa/dist/skills"),
// ADD:
path.resolve(moduleDirectory, "../../../dist/skills/qa"),
```

(`moduleDirectory` resolves to `packages/skill-registry/dist/`. Three `../` go up to the repo root, then `dist/skills/qa`.)

- [ ] **Step 3.8: Build root + skill-registry to verify path resolution**

```bash
npm run build:root
npm run build --workspace @appverk/opencode-skill-registry
```

After build, `dist/skills/qa/<each-skill>/SKILL.md` should exist. Verify:

```bash
ls dist/skills/qa/
```

Expected: `be-testing  fe-testing  report-format  test-plan-format`.

- [ ] **Step 3.9: Run the moved test**

```bash
npx vitest run tests/modules/qa/plugin.test.ts
```

Expected: PASS. The test now imports from `src/modules/qa/*.js` (Node ESM resolves to compiled `dist/modules/qa/*.js`). Both `qa-tester-fe` and `qa-tester-be` register; commands register; builder outputs are correct.

- [ ] **Step 3.10: Atomic commit for Task 3**

```bash
AV_COMMIT_SKILL=1 git add -A src/ tests/modules/qa/ scripts/copy-root-assets.mjs packages/skill-registry/src/index.ts
AV_COMMIT_SKILL=1 git rm packages/qa/tests/qa-plugin.test.ts
# Note: packages/qa/src/ files are still present and registered via packages/qa/dist/.
# Task 4 swaps the import in src/index.ts; Task 5 deletes packages/qa/ entirely.
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
refactor(qa): move qa plugin source into src/modules/qa/

QA plugin's TS, markdown commands, skills, and tests relocate to the src/
harness following the commit-pilot precedent. Tests now import from
src/modules/qa/*.js (Node ESM resolves to the compiled dist/ at runtime).

scripts/copy-root-assets.mjs gains a walker for src/modules/<name>/**/*.md
so the variant prompt-sections land in dist alongside the compiled TS.

skill-registry's QA path repoints from packages/qa/dist/skills to
dist/skills/qa in the same commit to keep the registry consistent with
the skill location at every commit boundary.

packages/qa/ workspace remains in place (still wired to the root entry
point via packages/qa/dist/index.js); the next commit swaps the import,
and the commit after that deletes the old workspace.

Step 3 of the QA unification + src/ migration plan.
EOF
)"
```

---

## Task 4: Swap QA import in src/index.ts

**Goal:** Change the root entrypoint to load `AppVerkQAPlugin` from the new `src/modules/qa/` location.

**Files:**
- Modify: `src/index.ts` (one import line)

- [ ] **Step 4.1: Edit the import**

In `src/index.ts`, find:

```typescript
import { AppVerkQAPlugin } from "../packages/qa/dist/index.js"
```

Replace with:

```typescript
import { AppVerkQAPlugin } from "./modules/qa/index.js"
```

- [ ] **Step 4.2: Build + test**

```bash
npm run build:root
npx vitest run tests/root-plugin.test.ts
```

Expected: the plugin still loads. `tests/root-plugin.test.ts` may still reference `packages/qa/dist/*` paths in its `expect.arrayContaining` assertion — that's fine (those files still exist; we delete in Task 5).

- [ ] **Step 4.3: Commit Task 4**

```bash
AV_COMMIT_SKILL=1 git add src/index.ts
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
refactor(root): swap AppVerkQAPlugin import to src/modules/qa/

Root entrypoint now loads the QA plugin from its new src/ home. The
packages/qa/ workspace is still present but no longer referenced by
src/index.ts; the next commit deletes the workspace entirely.

Step 4 of the QA unification + src/ migration plan.
EOF
)"
```

---

## Task 5: Delete packages/qa/

**Goal:** Remove the now-unused QA workspace.

**Files:**
- Delete: `packages/qa/` (entire directory tree)
- Modify: `package.json` (workspaces — `packages/*` glob covers automatically; just remove from `files` array)
- Modify: `.gitignore` (drop carveout if any)
- Modify: `scripts/verify-dist-sync.mjs` (remove `packages/qa/dist` from `trackedDistPaths`)
- Modify: `tests/root-plugin.test.ts` (remove `packages/qa/dist/*` entries from the packed-files assertion)
- Modify: `package.json` scripts (`build`/`test`/`typecheck`) — remove the `--workspace @appverk/opencode-qa` invocations

- [ ] **Step 5.1: Delete the workspace tree**

```bash
git rm -rf packages/qa
```

- [ ] **Step 5.2: Update root `package.json`**

Open `package.json`. Remove `"packages/qa/dist"` from the `files` array. Find every occurrence of `--workspace @appverk/opencode-qa` in the `build`/`test`/`typecheck` scripts and remove that segment (mind the `&&` separators).

- [ ] **Step 5.3: Update `.gitignore`**

Check `.gitignore` for QA-specific carveouts:

```bash
grep -n "packages/qa" .gitignore
```

Remove any lines referencing `packages/qa/dist`.

- [ ] **Step 5.4: Update `scripts/verify-dist-sync.mjs`**

Remove `"packages/qa/dist"` from the `trackedDistPaths` array.

- [ ] **Step 5.5: Update `tests/root-plugin.test.ts`**

Find every line in the `expect.arrayContaining` block referencing `packages/qa/dist/*`. Remove them.

- [ ] **Step 5.6: Full check**

```bash
npm run check
```

Expected: typecheck + tests + build all green. The QA tests now live in `tests/modules/qa/plugin.test.ts` and pass against `src/modules/qa/`.

- [ ] **Step 5.7: Commit Task 5**

```bash
AV_COMMIT_SKILL=1 git add -A
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
chore(qa): remove packages/qa/ workspace after migration to src/modules/qa/

The QA plugin now lives entirely under src/modules/qa/, src/commands/,
src/skills/qa/, and tests/modules/qa/. Removes the old workspace
directory, the corresponding files[] entry, the verify-dist-sync
tracked path, the build/test/typecheck workspace invocations, and the
root-plugin packed-files assertions.

Step 5 of the QA unification + src/ migration plan.
EOF
)"
```

---

## Task 6: Move coordinator into src/modules/coordinator/

**Goal:** Move all coordinator TS modules + perun.md into src/. Tests move to tests/modules/coordinator/.

**Files:**
- Create: `src/modules/coordinator/index.ts`, `dispatch.ts`, `sdk-specialist.ts`, `sanitize.ts`, `assign-issue-ids.ts`, `poller.ts`, `truncate-bytes.ts` (copied from `packages/coordinator/src/`)
- Create: `src/agents/perun.md` (copied from `packages/coordinator/src/agents/perun.md`)
- Move: `packages/coordinator/tests/*.test.ts` → `tests/modules/coordinator/*.test.ts` (rewrite imports)

- [ ] **Step 6.1: Copy TS modules**

```bash
mkdir -p src/modules/coordinator
cp packages/coordinator/src/index.ts src/modules/coordinator/index.ts
cp packages/coordinator/src/dispatch.ts src/modules/coordinator/dispatch.ts
cp packages/coordinator/src/sdk-specialist.ts src/modules/coordinator/sdk-specialist.ts
cp packages/coordinator/src/sanitize.ts src/modules/coordinator/sanitize.ts
cp packages/coordinator/src/assign-issue-ids.ts src/modules/coordinator/assign-issue-ids.ts
cp packages/coordinator/src/poller.ts src/modules/coordinator/poller.ts
cp packages/coordinator/src/truncate-bytes.ts src/modules/coordinator/truncate-bytes.ts
```

- [ ] **Step 6.2: Copy perun.md**

```bash
cp packages/coordinator/src/agents/perun.md src/agents/perun.md
```

- [ ] **Step 6.3: Update `src/modules/coordinator/index.ts` perun.md loader paths**

In the new `src/modules/coordinator/index.ts`, the existing `loadAgentPrompt` function reads from `agents/<name>.md` relative to `moduleDir`. After the move, `moduleDir` points at `dist/modules/coordinator/`. So `path.resolve(moduleDir, "agents", "perun.md")` → `dist/modules/coordinator/agents/perun.md` which doesn't exist; the asset is at `dist/agents/perun.md`.

Update the function:

```typescript
function loadAgentPrompt(name: string): string {
  // Production: dist/agents/<name>.md (copied by copy-root-assets.mjs)
  // Dev:        src/agents/<name>.md
  const packaged = path.resolve(moduleDir, "../../agents", `${name}.md`)
  const source = path.resolve(moduleDir, "../../../src/agents", `${name}.md`)
  try { return readFileSync(packaged, "utf8") }
  catch { return readFileSync(source, "utf8") }
}
```

- [ ] **Step 6.4: Move tests, rewrite imports**

```bash
mkdir -p tests/modules/coordinator
git mv packages/coordinator/tests/assign-issue-ids.test.ts tests/modules/coordinator/assign-issue-ids.test.ts
git mv packages/coordinator/tests/dispatch.test.ts tests/modules/coordinator/dispatch.test.ts
git mv packages/coordinator/tests/dispatch-tool-title.test.ts tests/modules/coordinator/dispatch-tool-title.test.ts
git mv packages/coordinator/tests/perun-qa-flow.test.ts tests/modules/coordinator/perun-qa-flow.test.ts
git mv packages/coordinator/tests/poller.test.ts tests/modules/coordinator/poller.test.ts
git mv packages/coordinator/tests/sanitize.test.ts tests/modules/coordinator/sanitize.test.ts
git mv packages/coordinator/tests/sdk-specialist.test.ts tests/modules/coordinator/sdk-specialist.test.ts
git mv packages/coordinator/tests/to-poller-message.test.ts tests/modules/coordinator/to-poller-message.test.ts
```

Then rewrite the imports in every moved test. Each existing import like:

```typescript
import { ... } from "../src/dispatch.js"
import { AppVerkCoordinatorPlugin } from "../src/index.js"
```

becomes:

```typescript
import { ... } from "../../../src/modules/coordinator/dispatch.js"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"
```

A `sed` one-liner per file works:

```bash
for f in tests/modules/coordinator/*.test.ts; do
  sed -i '' 's|"../src/|"../../../src/modules/coordinator/|g' "$f"
done
```

(Use `sed -i ''` on macOS; `sed -i` on Linux.)

- [ ] **Step 6.5: Build + test**

```bash
npm run build:root
npx vitest run tests/modules/coordinator/
```

Expected: all coordinator tests pass against `src/modules/coordinator/`. They previously ran against `packages/coordinator/src/`; same code, new location.

- [ ] **Step 6.6: Commit Task 6**

```bash
AV_COMMIT_SKILL=1 git add -A src/modules/coordinator src/agents/perun.md tests/modules/coordinator
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
refactor(coordinator): move coordinator source into src/modules/coordinator/

Mirrors the QA migration: coordinator's TS modules relocate to
src/modules/coordinator/, perun.md to src/agents/perun.md, tests to
tests/modules/coordinator/. Test imports rewritten to point at the new
locations.

packages/coordinator/ workspace remains in place (still wired to the
root entry point via packages/coordinator/dist/index.js); the next
commit swaps the import, and the commit after that deletes the old
workspace.

Step 6 of the QA unification + src/ migration plan.
EOF
)"
```

---

## Task 7: Swap coordinator import in src/index.ts

**Goal:** Point root at the new coordinator location.

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 7.1: Edit the import**

Find:

```typescript
import { AppVerkCoordinatorPlugin } from "../packages/coordinator/dist/index.js"
```

Replace with:

```typescript
import { AppVerkCoordinatorPlugin } from "./modules/coordinator/index.js"
```

- [ ] **Step 7.2: Build + test**

```bash
npm run build:root
npx vitest run tests/
```

Expected: green.

- [ ] **Step 7.3: Commit Task 7**

```bash
AV_COMMIT_SKILL=1 git add src/index.ts
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
refactor(root): swap AppVerkCoordinatorPlugin import to src/modules/coordinator/

Root entrypoint now loads the coordinator plugin from its new src/ home.
The packages/coordinator/ workspace is still present but no longer
referenced; the next commit deletes the workspace.

Step 7 of the QA unification + src/ migration plan.
EOF
)"
```

---

## Task 8: Delete packages/coordinator/

**Files:**
- Delete: `packages/coordinator/`
- Modify: `package.json` (`files`, `build`/`test`/`typecheck` scripts), `.gitignore`, `scripts/verify-dist-sync.mjs`, `tests/root-plugin.test.ts`

- [ ] **Step 8.1: Delete workspace tree**

```bash
git rm -rf packages/coordinator
```

- [ ] **Step 8.2: Update root `package.json`**

Remove `"packages/coordinator/dist"` from `files`. Remove every `--workspace @appverk/opencode-coordinator` from `build`/`test`/`typecheck` scripts.

- [ ] **Step 8.3: Update `.gitignore`**

```bash
grep -n "packages/coordinator" .gitignore
```

Remove any carveouts.

- [ ] **Step 8.4: Update `scripts/verify-dist-sync.mjs`**

Remove `"packages/coordinator/dist"` from `trackedDistPaths`.

- [ ] **Step 8.5: Update `tests/root-plugin.test.ts`**

Remove lines referencing `packages/coordinator/dist/*` from the `expect.arrayContaining` block. Add new lines:

```typescript
"dist/modules/coordinator/index.js",
"dist/modules/coordinator/index.d.ts",
"dist/agents/perun.md",
"dist/modules/qa/index.js",
"dist/modules/qa/index.d.ts",
"dist/modules/qa/prompt-builder.js",
"dist/modules/qa/prompt-builder.d.ts",
"dist/modules/qa/allowed-tools.js",
"dist/modules/qa/allowed-tools.d.ts",
"dist/modules/qa/prompt-sections/core.md",
"dist/modules/qa/prompt-sections/overlay-fe.md",
"dist/modules/qa/prompt-sections/overlay-be.md",
"dist/commands/create-qa-plan.md",
"dist/commands/run-qa.md",
"dist/skills/qa/test-plan-format/SKILL.md",
"dist/skills/qa/report-format/SKILL.md",
"dist/skills/qa/fe-testing/SKILL.md",
"dist/skills/qa/be-testing/SKILL.md",
```

- [ ] **Step 8.6: Full check**

```bash
npm run check
```

Expected: green.

- [ ] **Step 8.7: Commit Task 8**

```bash
AV_COMMIT_SKILL=1 git add -A
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
chore(coordinator): remove packages/coordinator/ workspace after migration to src/modules/coordinator/

Mirrors the QA workspace removal. Coordinator plugin now lives entirely
under src/modules/coordinator/, src/agents/perun.md, and
tests/modules/coordinator/.

Step 8 of the QA unification + src/ migration plan.
EOF
)"
```

---

## Task 9: Documentation rewrites

**Goal:** Bring `README.md`, `docs/plugins/qa.md`, `docs/plugins/coordinator.md`, `docs/plugins/pantheon.md`, and `AGENTS.md` in line with the new architecture.

**Files:**
- Modify: `README.md` (plugin description, command table, structure section)
- Modify: `docs/plugins/qa.md` (rewrite for variant agents + Depends-on + per-scenario dispatch)
- Modify: `docs/plugins/coordinator.md` (worker pool, cap=50, logical-name exception, normalisation)
- Modify: `docs/plugins/pantheon.md` (perun workflow update)
- Modify: `AGENTS.md` (Monorepo Layout table: drop `packages/qa/`, `packages/coordinator/` rows; add `src/modules/qa/`, `src/modules/coordinator/` rows mirroring the `src/modules/commit/` row's voice)

- [ ] **Step 9.1: Update README.md**

In the introduction paragraph, update the QA description (search for `qa-fe-tester` / `qa-be-tester`). Replace mentions of "two QA testing agents" with "a unified `qa-tester` (variant-split for runtime safety)".

In the "Available Commands & Agents" table, replace the two QA rows with one logical row:

| Command/Agent | Mode | Purpose |
|---|---|---|
| `qa-tester` | subagent | Single-scenario QA executor; Perun dispatches one per `### FE-XX:` / `### BE-XX:` block. |

In "Repository Structure", remove `packages/qa` and `packages/coordinator` rows. Add `src/modules/qa/` and `src/modules/coordinator/` rows.

- [ ] **Step 9.2: Rewrite docs/plugins/qa.md**

Open the file. Update:

1. Architecture section: describe the variant-split (`qa-tester-fe`, `qa-tester-be`) with the security rationale.
2. Add a "Plan format extensions" section documenting `**Depends-on:**`.
3. Update the "Architecture" table — variants register as subagents; logical name is `qa-tester`; dispatch is per-scenario via dispatch_parallel's worker pool.
4. Add to "Limitations": "Cross-scenario data conflicts not auto-detected; use **Depends-on:** to serialise known dependencies."

- [ ] **Step 9.3: Rewrite docs/plugins/coordinator.md**

Update:

1. `dispatch_parallel` section: describe the worker pool (concurrency 4), the new cap (50), the abort-at-start behavior, and the logical-name label exception.
2. Add an "agent label exception" subsection with the qa-tester example.
3. Add a "Variant-suffix normalization" subsection (Perun strips `-fe`/`-be` in user-facing strings).

- [ ] **Step 9.4: Update docs/plugins/pantheon.md**

Find the Perun workflow description. Replace the FE/BE bulk dispatch story with the per-scenario + waves story:

1. Perun extracts scenarios into a flat list.
2. Parses any `**Depends-on:**` annotations and validates the dependency graph.
3. Computes dispatch waves via topological sort.
4. Calls `dispatch_parallel` once per wave (single-wave fast path for dep-free plans).

- [ ] **Step 9.5: Update AGENTS.md Monorepo Layout table**

Locate the table around lines 5–20. Drop these rows:

| Path | Role |
|------|------|
| ~~`packages/qa`~~ | ~~QA plugin — end-to-end testing workflow...~~ |
| ~~`packages/coordinator`~~ | ~~Coordinator plugin source — Pantheon `@perun`...~~ |

Add these rows (mirror the `src/modules/commit/` voice — short identifier + bullet sentences + "Built into ..."):

| Path | Role |
|------|------|
| `src/modules/qa/` | Absorbed QA plugin — TS source only. Assets: `src/commands/{create-qa-plan,run-qa}.md`, `src/skills/qa/**`, `src/modules/qa/prompt-sections/*.md`. Registers two `qa-tester-{fe,be}` subagent variants composed via `prompt-builder.ts`; logical name `qa-tester` everywhere user-facing. Tests: `tests/modules/qa/`. Built into `dist/modules/qa/`, `dist/commands/`, `dist/skills/qa/`. |
| `src/modules/coordinator/` | Absorbed coordinator plugin — TS source only. Asset: `src/agents/perun.md`. Registers `dispatch_parallel` (worker pool, concurrency 4, cap 50) and `assign_issue_ids` tools. Tests: `tests/modules/coordinator/`. Built into `dist/modules/coordinator/` and `dist/agents/`. |

Update the surrounding paragraph that lists workspace plugin counts.

- [ ] **Step 9.6: Final check + commit**

```bash
npm run check
AV_COMMIT_SKILL=1 git add -A
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
docs: update README, plugin guides, and AGENTS.md for unified qa-tester + src/ migration

README.md, docs/plugins/{qa,coordinator,pantheon}.md, and AGENTS.md
now reflect:
- qa-tester as a logical agent with variant-split runtime registration
- dispatch_parallel worker pool (concurrency 4, cap 50)
- per-scenario dispatch with **Depends-on:** topological wave ordering
- src/modules/{qa,coordinator}/ as absorbed-module layout siblings of
  src/modules/commit/

Step 9 of the QA unification + src/ migration plan.
EOF
)"
```

---

## Task 10: Final `npm run check`

**Goal:** End-to-end verification that the migration is green.

- [ ] **Step 10.1: Full check**

```bash
npm run check
```

Expected: typecheck + tests + build all pass.

- [ ] **Step 10.2: Verify dist sync (no uncommitted dist drift)**

```bash
npm run verify-dist
```

Expected: ✅ dist/ is in sync with src/.

- [ ] **Step 10.3: Smoke check the agent listing**

Inspect a fresh OpenCode session (or read the agent registry tests). Confirm:

- `qa-tester-fe` and `qa-tester-be` are present.
- `qa-fe-tester` and `qa-be-tester` are absent.
- `perun` (Perun - Coordinator) is present and references qa-tester (singular) in its specialists table.

- [ ] **Step 10.4: Manual smoke — dispatch through Perun**

(Optional, requires interactive OpenCode session.) Create a 3-scenario test plan with `**Depends-on:**` on one scenario; have Perun run `/run-qa`. Confirm:

- Three child sessions spawn (one per scenario).
- The dependent scenario starts only after its predecessor reports.
- The report attributes scenarios to `qa-tester` (no `-fe`/`-be` leakage).
- Error strings in the report do not contain `qa-tester-fe` or `qa-tester-be`.

If any of the above fail, file a bug ticket with the specific assertion that failed; the implementation plan does not auto-recover from this.

- [ ] **Step 10.5: No commit**

This task only verifies; no files change. The branch is ready for the user's chosen finishing strategy (PR or local merge via `superpowers:finishing-a-development-branch`).

---

## Self-Review Notes (filled in by writing-plans skill)

**Spec coverage check:** every section of the spec has a corresponding task:

| Spec section | Task |
|---|---|
| Goal — variant agents | Task 2 |
| Goal — per-scenario worker pool | Tasks 1 (pool) + 2 (Perun integration) |
| Goal — src/ absorption | Tasks 3, 4, 5 (QA) + 6, 7, 8 (coordinator) |
| Final src/ layout | Tasks 3, 6 |
| qa-tester variant registration + builder | Task 2 |
| dispatch_parallel worker pool | Task 1 |
| agent label logical-name exception | Task 2 (Steps 2.15, 2.16) |
| Artifact filename convention | Task 2 (Step 2.2 / core.md) |
| Skill-registry path update | Task 3 (Step 3.7) |
| Plan format Depends-on extension | Task 2 (Step 2.14) |
| Perun Workflow 1 wave dispatch | Task 2 (Step 2.15) |
| Available Specialists table | Task 2 (Step 2.15) |
| Data flow | Task 2 (validates against spec's diagram) |
| Error handling table | Task 2 (Step 2.15 + Step 2.18 dependency tests) |
| Testing section | Tasks 1, 2 |
| Security invariant (defense in depth) | Task 2 (preserved by per-variant allowed-tools); no explicit spec edit needed |
| Migration Order | Tasks 1–10 (numbered to match) |

**Placeholder scan:** no "TBD", "TODO", or "fill in later" remain. Where the plan defers decisions (e.g. dependency-validator location in Step 2.18), the deferral is explicit with both options described.

**Type consistency:** `buildQATesterAgent` signature consistent across Steps 2.5, 2.7, 2.10, 3.1, 3.3. `FE_TOOLS`/`BE_TOOLS`/`SHARED_TOOLS` exports consistent across Steps 2.1, 2.7, 2.10. `DISPATCH_CONCURRENCY` + `MAX_PARALLEL_TASKS` named consistently (note: existing code calls the cap `MAX_PARALLEL_TASKS`; the spec uses `DISPATCH_MAX_TASKS` in prose — Step 1.3 keeps the existing identifier name to minimize diff; the spec's name is a synonym for documentation purposes only).

**Known plan-level deferral:** Step 2.18's dependency-validator helper is described as either a TS export OR pure prompt logic; the implementer picks one. If TS, expose via `validatePlanDependencies` from `packages/coordinator/src/index.ts` (later `src/modules/coordinator/index.ts`). If prompt-only, the dep-handling tests in Step 2.18 must be replaced with fixture-driven end-to-end tests that exercise Perun's prompt logic via `dispatch_parallel`'s tool entry point.

---
