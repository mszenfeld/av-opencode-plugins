# Background Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-blocking background dispatch so Perun can fire a specialist (Triglav first), do other work in the same turn, then collect the result — via three coordinator tools `dispatch_background` / `poll_background` / `wait_background`.

**Architecture:** New `background-store.ts` (in-memory factory-scoped `BackgroundTaskStore`) + `background.ts` (`startBackgroundTask` and a shared `collectBackground` backing poll/wait), reusing the coordinator's `pollUntilIdle`/`sanitize`/`truncate-bytes`. A new `startBackground` on `DispatchSpecialist` uses `session.promptAsync` (`204` immediate; the server runs the turn autonomously). The synchronous `dispatch_parallel` path is untouched except for extracting its anti-recursion check into a shared `validateDispatchable`.

**Tech Stack:** TypeScript (ESM/NodeNext), vitest, tsup (`bundle: false`). No new dependencies (uses `node:crypto` `randomUUID`).

**Spec:** `docs/superpowers/specs/2026-05-27-background-dispatch-design.md`

**Commit note:** the pre-commit hook blocks `git commit` unless `AV_COMMIT_SKILL=1` is in the command. Every commit step includes it. Never push. Never add Co-Authored-By.

**Test-loop note:** run one file with `npx vitest run <path> --config vitest.config.ts` (vitest runs against `src/`, `.js` imports resolve to `.ts`). Typecheck: `npx tsc -p tsconfig.json --noEmit`. Final task runs `npm run check`.

**Key grounded facts:**
- `client.session.promptAsync({ path: { id }, body: { agent, parts: [{ type: "text", text }] } })` returns `204` (void) immediately (`@opencode-ai/sdk` `SessionPromptAsyncData`/`...Responses`). Same body shape as `session.prompt`, but async.
- `pollUntilIdle(options): Promise<string>` (`coordinator/poller.ts`) throws `PollerTimeoutError` / `PollerAbortError`; options = `{ fetchMessages, timeoutMs, pollIntervalMs, signal?, maxBytes? }`.
- `DispatchSpecialist` (`dispatch.ts`) = `startTask`/`fetchMessages`/`abortTask`; `createSDKSpecialist(client, parentSessionID)` implements it (`sdk-specialist.ts`).
- Constants in `dispatch.ts`: `DEFAULT_POLL_INTERVAL_MS=1000`, `DEFAULT_TASK_TIMEOUT_MS=5*60*1000`, `DEFAULT_RESULT_MAX_BYTES=100*1024`, `DISPATCH_CONCURRENCY=4`.
- The anti-recursion check is inline in `dispatchParallel` (`dispatch.ts` ~146-158) — must be extracted.
- The coordinator `event` hook (`index.ts` ~258) handles ONLY `session.created` — a `session.deleted` branch must be ADDED (mirror `qa/index.ts`'s both-IDs-safe handler).
- `package.json` `files` = `["dist", …]` and the root-plugin packed-files test uses `arrayContaining` (subset) → no change needed for new coordinator files.

---

## Task 0: Validation spike (GATE — do this before any implementation)

**Not a committed test.** Empirically confirm the linchpin: a `session.promptAsync` child makes autonomous server-side progress while the parent does other work. If it fails, STOP and report — the within-turn overlap value does not exist and the design must be reconsidered.

- [ ] **Step 1: Spike**

Against a live OpenCode server (manual throwaway script or REPL), with a real `client`:
1. `const created = await client.session.create({ body: { parentID: <some session>, title: "spike" } })`
2. `await client.session.promptAsync({ path: { id: created.data.id }, body: { agent: "triglav", parts: [{ type: "text", text: "List the files under src/modules and stop." }] } })` — confirm it returns/`204`s within ~1s (NOT after a full LLM turn).
3. Immediately `await client.session.messages({ path: { id: created.data.id } })` repeatedly over a few seconds — confirm the last assistant message transitions from absent/streaming to having a `finish` set, i.e. the turn progressed **without** us awaiting it.

Expected: promptAsync returns immediately; the child session reaches an idle/finished assistant message on its own. If instead nothing progresses until you poll/await, escalate.

- [ ] **Step 2: Record the outcome** in the PR/commit description. Proceed only on success.

---

## Task 1: Extract `validateDispatchable`

**Files:**
- Modify: `src/modules/coordinator/dispatch.ts`
- Test: `tests/modules/coordinator/validate-dispatchable.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest"
import {
  validateDispatchable,
  type AgentInfo,
} from "../../../src/modules/coordinator/dispatch.js"

const registry: Record<string, AgentInfo> = {
  zmora: { mode: "subagent" },
  perun: { mode: "primary" },
  omni: { mode: "all" },
}

describe("validateDispatchable", () => {
  it("accepts a subagent", () => {
    expect(() => validateDispatchable(registry, "zmora")).not.toThrow()
  })
  it("throws on an unknown agent", () => {
    expect(() => validateDispatchable(registry, "ghost")).toThrow(/Unknown agent: ghost/)
  })
  it("throws on a primary agent", () => {
    expect(() => validateDispatchable(registry, "perun")).toThrow(/Cannot dispatch primary agent: perun/)
  })
  it("throws on an all-mode agent", () => {
    expect(() => validateDispatchable(registry, "omni")).toThrow(/Cannot dispatch all agent: omni/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/coordinator/validate-dispatchable.test.ts --config vitest.config.ts`
Expected: FAIL — `validateDispatchable` not exported.

- [ ] **Step 3: Extract the helper and call it from `dispatchParallel`**

In `src/modules/coordinator/dispatch.ts`, add the exported function (near the top, after the interfaces):

```typescript
/**
 * Anti-recursion guard: only strict `subagent`-mode agents are dispatchable.
 * Both `primary` and `all` are rejected (an `all` agent can run as a primary,
 * so dispatching it from a primary would re-open the anti-recursion hole).
 * Shared by `dispatchParallel` and the background dispatch path.
 */
export function validateDispatchable(
  agentRegistry: Record<string, AgentInfo>,
  name: string,
): void {
  const agentInfo = agentRegistry[name]
  if (agentInfo === undefined) {
    throw new Error(`Unknown agent: ${name}`)
  }
  if (agentInfo.mode !== "subagent") {
    throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${name}`)
  }
}
```

Then replace the inline validation loop in `dispatchParallel` (the `for (const task of tasks) { ... }` block that checks `agentRegistry[task.name]`) with:

```typescript
  // Anti-recursion: validate every task BEFORE any session spawns.
  for (const task of tasks) {
    validateDispatchable(agentRegistry, task.name)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/modules/coordinator/validate-dispatchable.test.ts tests/modules/coordinator/dispatch.test.ts --config vitest.config.ts`
Expected: PASS (new file + existing dispatch tests still green — the behavior is identical). Then `npx tsc -p tsconfig.json --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/dispatch.ts tests/modules/coordinator/validate-dispatchable.test.ts && git commit -m "refactor(coordinator): extract validateDispatchable for reuse"
```

---

## Task 2: BackgroundTaskStore

**Files:**
- Create: `src/modules/coordinator/background-store.ts`
- Test: `tests/modules/coordinator/background-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest"
import {
  BackgroundTaskStore,
  type BackgroundTask,
} from "../../../src/modules/coordinator/background-store.js"

function task(over: Partial<BackgroundTask> & { id: string }): BackgroundTask {
  return {
    id: over.id,
    childSessionId: over.childSessionId ?? `child-${over.id}`,
    parentSessionId: over.parentSessionId ?? "parent-1",
    agent: over.agent ?? "triglav",
    startedAt: over.startedAt ?? 1000,
  }
}

describe("BackgroundTaskStore", () => {
  it("registers and gets a task", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1" }))
    expect(s.get("bg_1")?.agent).toBe("triglav")
    expect(s.get("nope")).toBeUndefined()
  })

  it("counts running tasks per parent", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", parentSessionId: "p1" }))
    s.register(task({ id: "bg_2", parentSessionId: "p1" }))
    s.register(task({ id: "bg_3", parentSessionId: "p2" }))
    expect(s.countRunningByParent("p1")).toBe(2)
    expect(s.countRunningByParent("p2")).toBe(1)
    expect(s.countRunningByParent("p3")).toBe(0)
  })

  it("remove frees the count (post-collect slot reuse)", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", parentSessionId: "p1" }))
    s.remove("bg_1")
    expect(s.countRunningByParent("p1")).toBe(0)
    expect(s.get("bg_1")).toBeUndefined()
  })

  it("removeByChild removes the task owning that child session", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", childSessionId: "c1" }))
    s.removeByChild("c1")
    expect(s.get("bg_1")).toBeUndefined()
  })

  it("clearParent removes all of a parent's tasks", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", parentSessionId: "p1" }))
    s.register(task({ id: "bg_2", parentSessionId: "p1" }))
    s.register(task({ id: "bg_3", parentSessionId: "p2" }))
    s.clearParent("p1")
    expect(s.countRunningByParent("p1")).toBe(0)
    expect(s.countRunningByParent("p2")).toBe(1)
  })

  it("listByParent returns only that parent's tasks", () => {
    const s = new BackgroundTaskStore()
    s.register(task({ id: "bg_1", parentSessionId: "p1" }))
    s.register(task({ id: "bg_2", parentSessionId: "p2" }))
    expect(s.listByParent("p1").map((t) => t.id)).toEqual(["bg_1"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/coordinator/background-store.test.ts --config vitest.config.ts`
Expected: FAIL — cannot resolve `background-store.js`.

- [ ] **Step 3: Write the store**

```typescript
export interface BackgroundTask {
  id: string
  childSessionId: string
  parentSessionId: string
  agent: string
  startedAt: number
}

/**
 * In-memory registry of running background tasks, keyed by task id and scoped
 * by parent session. Holds the parent->child mapping only — no results, no
 * proactive completion detection (status is derived at collect time by polling
 * the child session). Constructed once per coordinator plugin factory and shared
 * by the three background tools.
 */
export class BackgroundTaskStore {
  private readonly tasks = new Map<string, BackgroundTask>()

  register(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
  }

  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  listByParent(parentSessionId: string): BackgroundTask[] {
    return [...this.tasks.values()].filter(
      (t) => t.parentSessionId === parentSessionId,
    )
  }

  countRunningByParent(parentSessionId: string): number {
    return this.listByParent(parentSessionId).length
  }

  remove(id: string): void {
    this.tasks.delete(id)
  }

  removeByChild(childSessionId: string): void {
    for (const [id, t] of this.tasks) {
      if (t.childSessionId === childSessionId) this.tasks.delete(id)
    }
  }

  clearParent(parentSessionId: string): void {
    for (const [id, t] of this.tasks) {
      if (t.parentSessionId === parentSessionId) this.tasks.delete(id)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/coordinator/background-store.test.ts --config vitest.config.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/background-store.ts tests/modules/coordinator/background-store.test.ts && git commit -m "feat(coordinator): add in-memory BackgroundTaskStore"
```

---

## Task 3: `startBackground` on the specialist (promptAsync)

**Files:**
- Modify: `src/modules/coordinator/dispatch.ts` (interface)
- Modify: `src/modules/coordinator/sdk-specialist.ts` (implementation)
- Test: `tests/modules/coordinator/sdk-specialist-background.test.ts`

- [ ] **Step 1: Add `startBackground` to the `DispatchSpecialist` interface**

In `src/modules/coordinator/dispatch.ts`, add to the `DispatchSpecialist` interface (after `abortTask`):

```typescript
  /**
   * Start a task in the background: create the child session, then fire it via
   * `session.promptAsync` (returns a 204 immediately; the server runs the LLM
   * turn autonomously). Resolves the child session id WITHOUT awaiting the turn.
   * Rejects if session creation or the async-prompt acknowledgement fails.
   */
  startBackground(agentName: string, prompt: string): Promise<string>
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest"
import { createSDKSpecialist } from "../../../src/modules/coordinator/sdk-specialist.js"

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      create: vi.fn(async () => ({ data: { id: "child-1" } })),
      promptAsync: vi.fn(async () => ({ data: undefined })),
      prompt: vi.fn(async () => ({ data: undefined })),
      messages: vi.fn(async () => ({ data: [] })),
      abort: vi.fn(async () => ({ data: undefined })),
      ...overrides,
    },
  } as never
}

describe("createSDKSpecialist.startBackground", () => {
  it("creates a session and fires promptAsync (not prompt), returning the id", async () => {
    const client = fakeClient()
    const specialist = createSDKSpecialist(client, "parent-1")
    const id = await specialist.startBackground("triglav", "explore X")
    expect(id).toBe("child-1")
    // It uses the async (fire-and-forget) endpoint, NOT the blocking prompt.
    expect((client as never as { session: { promptAsync: ReturnType<typeof vi.fn> } }).session.promptAsync).toHaveBeenCalledTimes(1)
    expect((client as never as { session: { prompt: ReturnType<typeof vi.fn> } }).session.prompt).not.toHaveBeenCalled()
  })

  it("throws when session creation yields no id", async () => {
    const client = fakeClient({ create: vi.fn(async () => ({ data: { id: "" } })) })
    const specialist = createSDKSpecialist(client, "parent-1")
    await expect(specialist.startBackground("triglav", "x")).rejects.toThrow(/no session id/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/modules/coordinator/sdk-specialist-background.test.ts --config vitest.config.ts`
Expected: FAIL — `startBackground` is not implemented.

- [ ] **Step 4: Implement `startBackground` in `createSDKSpecialist`**

In `src/modules/coordinator/sdk-specialist.ts`, add to the returned object (after `abortTask`):

```typescript
    async startBackground(agentName: string, prompt: string): Promise<string> {
      const created = await client.session.create({
        body: {
          parentID: parentSessionID,
          title: `[perun] background ${agentName}`,
        },
      })
      const sessionId: string = created.data?.id ?? ""
      if (sessionId.length === 0) {
        throw new Error(`startBackground returned no session id for agent ${agentName}`)
      }
      // Fire-and-forget: promptAsync returns 204 immediately; the server runs
      // the LLM turn autonomously. We do NOT await the turn — completion is
      // observed later by polling the child session (poll_background/wait_background).
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          agent: agentName,
          parts: [{ type: "text", text: prompt }],
        },
      })
      return sessionId
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/modules/coordinator/sdk-specialist-background.test.ts --config vitest.config.ts`
Expected: PASS (2 tests). Then `npx tsc -p tsconfig.json --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/dispatch.ts src/modules/coordinator/sdk-specialist.ts tests/modules/coordinator/sdk-specialist-background.test.ts && git commit -m "feat(coordinator): add startBackground (promptAsync fire-and-forget)"
```

---

## Task 4: `startBackgroundTask` + `collectBackground`

**Files:**
- Create: `src/modules/coordinator/background.ts`
- Test: `tests/modules/coordinator/background.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest"
import { BackgroundTaskStore } from "../../../src/modules/coordinator/background-store.js"
import {
  BACKGROUND_MAX_CONCURRENT,
  collectBackground,
  startBackgroundTask,
} from "../../../src/modules/coordinator/background.js"
import type { DispatchSpecialist, AgentInfo } from "../../../src/modules/coordinator/dispatch.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

const registry: Record<string, AgentInfo> = {
  triglav: { mode: "subagent" },
  perun: { mode: "primary" },
}

function fakeSpecialist(over: Partial<DispatchSpecialist> = {}): DispatchSpecialist {
  return {
    startTask: vi.fn(async () => "unused"),
    startBackground: vi.fn(async () => `child-${Math.random().toString(36).slice(2, 8)}`),
    fetchMessages: vi.fn(async (): Promise<PollerMessage[]> => []),
    abortTask: vi.fn(async () => {}),
    ...over,
  }
}

const idleMsg = (text: string): PollerMessage[] => [
  { role: "assistant", content: text, finish_reason: "stop" },
]
const runningMsg = (): PollerMessage[] => [
  { role: "assistant", content: "thinking", finish_reason: null },
]

describe("startBackgroundTask", () => {
  it("validates the agent and rejects a non-subagent", async () => {
    const store = new BackgroundTaskStore()
    await expect(
      startBackgroundTask({ store, specialist: fakeSpecialist(), agentRegistry: registry, parentSessionId: "p1", agent: "perun", prompt: "x" }),
    ).rejects.toThrow(/Cannot dispatch primary/)
    expect(store.countRunningByParent("p1")).toBe(0)
  })

  it("registers a running task and returns an id", async () => {
    const store = new BackgroundTaskStore()
    const r = await startBackgroundTask({ store, specialist: fakeSpecialist(), agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "explore" })
    expect(r.status).toBe("running")
    expect(r.id).toMatch(/^bg_/)
    expect(store.countRunningByParent("p1")).toBe(1)
  })

  it("throws at the per-parent cap and registers nothing extra", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist()
    for (let i = 0; i < BACKGROUND_MAX_CONCURRENT; i++) {
      await startBackgroundTask({ store, specialist: spec, agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "x" })
    }
    await expect(
      startBackgroundTask({ store, specialist: spec, agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "x" }),
    ).rejects.toThrow(/max 4 background tasks/)
    expect(store.countRunningByParent("p1")).toBe(BACKGROUND_MAX_CONCURRENT)
  })

  it("does not register when startBackground rejects", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ startBackground: vi.fn(async () => { throw new Error("create failed") }) })
    await expect(
      startBackgroundTask({ store, specialist: spec, agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "x" }),
    ).rejects.toThrow(/create failed/)
    expect(store.countRunningByParent("p1")).toBe(0)
  })
})

describe("collectBackground", () => {
  async function seed(store: BackgroundTaskStore, spec: DispatchSpecialist) {
    return startBackgroundTask({ store, specialist: spec, agentRegistry: registry, parentSessionId: "p1", agent: "triglav", prompt: "x" })
  }

  it("poll (non-block) returns running when the child isn't idle", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => runningMsg()) })
    const { id } = await seed(store, spec)
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: false })
    expect(r?.status).toBe("running")
    expect(store.get(id)).toBeDefined() // poll does not remove
  })

  it("poll returns success + result when the child is idle", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => idleMsg("done!")) })
    const { id } = await seed(store, spec)
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: false })
    expect(r?.status).toBe("success")
    expect(r?.result).toContain("done!")
  })

  it("poll returns not_found for an unknown id", async () => {
    const store = new BackgroundTaskStore()
    const [r] = await collectBackground({ store, specialist: fakeSpecialist(), ids: ["bg_ghost"], block: false })
    expect(r?.status).toBe("not_found")
  })

  it("wait (block) returns success and removes the task", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => idleMsg("ok")) })
    const { id } = await seed(store, spec)
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: true, pollIntervalMs: 1 })
    expect(r?.status).toBe("success")
    expect(store.get(id)).toBeUndefined() // collected = removed
  })

  it("wait times out and removes the task", async () => {
    const store = new BackgroundTaskStore()
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => runningMsg()) })
    const { id } = await seed(store, spec)
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: true, timeoutMs: 5, pollIntervalMs: 1 })
    expect(r?.status).toBe("timeout")
    expect(store.get(id)).toBeUndefined()
  })

  it("wait abort kills the child and removes the task", async () => {
    const store = new BackgroundTaskStore()
    const abortTask = vi.fn(async () => {})
    const spec = fakeSpecialist({ fetchMessages: vi.fn(async () => runningMsg()), abortTask })
    const { id } = await seed(store, spec)
    const ac = new AbortController()
    ac.abort()
    const [r] = await collectBackground({ store, specialist: spec, ids: [id], block: true, signal: ac.signal, pollIntervalMs: 1 })
    expect(r?.status).toBe("aborted")
    expect(abortTask).toHaveBeenCalledWith(store.get(id)?.childSessionId ?? expect.any(String))
    expect(store.get(id)).toBeUndefined()
  })
})
```

> NOTE on the abort test's `toHaveBeenCalledWith`: after collect the task is removed, so `store.get(id)` is undefined. Simplify the assertion to `expect(abortTask).toHaveBeenCalledTimes(1)` if matching the exact child id is awkward — the point is the child was aborted.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/coordinator/background.test.ts --config vitest.config.ts`
Expected: FAIL — cannot resolve `background.js`.

- [ ] **Step 3: Write `background.ts`**

```typescript
import { randomUUID } from "node:crypto"
import type { AgentInfo, DispatchSpecialist } from "./dispatch.js"
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  validateDispatchable,
} from "./dispatch.js"
import { PollerAbortError, PollerTimeoutError, pollUntilIdle } from "./poller.js"
import { neutralizeUntrustedOutput, normalizeVariantSuffix } from "./sanitize.js"
import { truncateBytes } from "./truncate-bytes.js"
import type { BackgroundTaskStore } from "./background-store.js"

/** Per-parent cap on concurrent background tasks. Mirrors DISPATCH_CONCURRENCY;
 *  bounds spawn count (cost-DoS). Separate from the synchronous worker pool. */
export const BACKGROUND_MAX_CONCURRENT = 4

export interface StartBackgroundInput {
  store: BackgroundTaskStore
  specialist: DispatchSpecialist
  agentRegistry: Record<string, AgentInfo>
  parentSessionId: string
  agent: string
  prompt: string
  context?: string
}

export interface StartBackgroundResult {
  id: string
  agent: string
  status: "running"
}

export async function startBackgroundTask(
  input: StartBackgroundInput,
): Promise<StartBackgroundResult> {
  const { store, specialist, agentRegistry, parentSessionId, agent, prompt, context } = input

  validateDispatchable(agentRegistry, agent)

  if (store.countRunningByParent(parentSessionId) >= BACKGROUND_MAX_CONCURRENT) {
    throw new Error(
      `dispatch_background: max ${BACKGROUND_MAX_CONCURRENT} background tasks running for this session — collect one (wait_background / poll_background) before firing more`,
    )
  }

  const fullPrompt = context ? `${prompt}\n\n${context}` : prompt
  // Rejects on create/ack failure → propagates to the caller, nothing registered.
  const childSessionId = await specialist.startBackground(agent, fullPrompt)

  const id = `bg_${randomUUID().slice(0, 8)}`
  store.register({ id, childSessionId, parentSessionId, agent, startedAt: Date.now() })
  return { id, agent, status: "running" }
}

export interface CollectBackgroundInput {
  store: BackgroundTaskStore
  specialist: DispatchSpecialist
  ids: string[]
  block: boolean
  timeoutMs?: number
  pollIntervalMs?: number
  resultMaxBytes?: number
  signal?: AbortSignal
  scrubber?: (text: string, parentSessionID: string) => string
  parentSessionId?: string
}

export interface BackgroundCollectResult {
  id: string
  agent: string
  status: "running" | "success" | "timeout" | "aborted" | "error" | "not_found"
  result?: string
  duration_ms?: number
  error?: string
}

export async function collectBackground(
  input: CollectBackgroundInput,
): Promise<BackgroundCollectResult[]> {
  return Promise.all(input.ids.map((id) => collectOne(id, input)))
}

async function collectOne(
  id: string,
  input: CollectBackgroundInput,
): Promise<BackgroundCollectResult> {
  const {
    store,
    specialist,
    block,
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES,
    signal,
    scrubber,
    parentSessionId,
  } = input

  const task = store.get(id)
  if (task === undefined) {
    return { id, agent: "", status: "not_found" }
  }
  const agent = normalizeVariantSuffix(task.agent)
  const finalize = (text: string): string => {
    const neutralized = neutralizeUntrustedOutput(text)
    const scrubbed =
      scrubber !== undefined && parentSessionId !== undefined
        ? scrubber(neutralized, parentSessionId)
        : neutralized
    return truncateBytes(scrubbed, resultMaxBytes)
  }

  if (!block) {
    const messages = await specialist.fetchMessages(task.childSessionId)
    const last = messages[messages.length - 1]
    if (last !== undefined && last.role === "assistant" && last.finish_reason) {
      return {
        id,
        agent,
        status: "success",
        result: finalize(last.content),
        duration_ms: Date.now() - task.startedAt,
      }
    }
    return { id, agent, status: "running" }
  }

  try {
    const raw = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(task.childSessionId),
      timeoutMs,
      pollIntervalMs,
      signal,
      maxBytes: resultMaxBytes,
    })
    store.remove(id)
    return { id, agent, status: "success", result: finalize(raw), duration_ms: Date.now() - task.startedAt }
  } catch (err) {
    store.remove(id)
    if (err instanceof PollerAbortError) {
      // Abort discards the result → kill the child (same as dispatch_parallel).
      try {
        await specialist.abortTask(task.childSessionId)
      } catch {
        /* best-effort */
      }
      return { id, agent, status: "aborted", result: "", duration_ms: Date.now() - task.startedAt, error: "aborted" }
    }
    if (err instanceof PollerTimeoutError) {
      return { id, agent, status: "timeout", result: "", duration_ms: Date.now() - task.startedAt, error: "timeout" }
    }
    return {
      id,
      agent,
      status: "error",
      result: "",
      duration_ms: Date.now() - task.startedAt,
      error: neutralizeUntrustedOutput(err instanceof Error ? err.message : String(err)),
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/coordinator/background.test.ts --config vitest.config.ts`
Expected: PASS (all). Then `npx tsc -p tsconfig.json --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/background.ts tests/modules/coordinator/background.test.ts && git commit -m "feat(coordinator): add startBackgroundTask + collectBackground"
```

---

## Task 5: Register tools + wire cleanup + Perun integration

**Files:**
- Modify: `src/modules/coordinator/index.ts`
- Modify: `src/agents/perun.md`
- Test: `tests/modules/coordinator/perun-tools-sync.test.ts`

- [ ] **Step 1: Write the failing frontmatter-sync test**

```typescript
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { PERUN_TOOLS } from "../../../src/modules/coordinator/index.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const PERUN_MD = path.resolve(here, "../../../src/agents/perun.md")

describe("Perun tool sync", () => {
  it("lists every PERUN_TOOLS name in perun.md allowed-tools", () => {
    const md = readFileSync(PERUN_MD, "utf8")
    const allowed = md.match(/^allowed-tools:\s*(.+)$/m)?.[1] ?? ""
    for (const t of PERUN_TOOLS) {
      expect(allowed).toContain(t)
    }
  })

  it("includes the three background tools", () => {
    expect(PERUN_TOOLS).toEqual(
      expect.arrayContaining(["dispatch_background", "poll_background", "wait_background"]),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/coordinator/perun-tools-sync.test.ts --config vitest.config.ts`
Expected: FAIL — `PERUN_TOOLS` not exported.

- [ ] **Step 3: Edit `coordinator/index.ts` — imports, store, PERUN_TOOLS, tools, cleanup**

Add imports (after the existing `getDispatchExtensions` import):

```typescript
import { BackgroundTaskStore } from "./background-store.js"
import {
  collectBackground,
  startBackgroundTask,
} from "./background.js"
```

Add the exported tool-name constant near the top (after `loadAgentPrompt`):

```typescript
/**
 * Coordinator-provided tools that MUST appear in perun.md's `allowed-tools`
 * frontmatter. Kept as an exported constant so a test can enforce the sync that
 * is otherwise manual (there is no programmatic link between tool registration
 * and the agent frontmatter).
 */
export const PERUN_TOOLS = [
  "dispatch_parallel",
  "assign_issue_ids",
  "compute_waves",
  "dispatch_background",
  "poll_background",
  "wait_background",
] as const
```

Inside `AppVerkCoordinatorPlugin`, construct the store in the factory body (near `let toastShown = false`):

```typescript
  // Factory-scoped, shared by the three background tools. In-memory, per process.
  const backgroundStore = new BackgroundTaskStore()
```

Define the three tools (alongside `dispatchParallelTool` etc.):

```typescript
  const dispatchBackgroundTool = tool({
    description:
      [
        "Start a specialist task in the BACKGROUND and return immediately with a task id (bg_...). The task runs while you do other work in THIS turn; collect it later with wait_background / poll_background.",
        "",
        "- Single task per call. Max 4 background tasks running per session — collect one before firing more.",
        "- Use for read-only work you can overlap with your own (especially `triglav` exploration). Use blocking `dispatch_parallel` when you need the result immediately or need ordered QA waves.",
        "- ALWAYS collect (wait_background/poll_background) what you start before ending the turn — uncollected tasks are wasted.",
        "- Returns: { id, agent, status: \"running\" }.",
      ].join("\n"),
    args: {
      agent: tool.schema.string().min(1).max(60).describe("Specialist agent name (e.g. \"triglav\"). Must be a subagent."),
      summary: tool.schema.string().min(1).max(80).describe("One-line label for the TUI (no prompts/PII)."),
      prompt: tool.schema.string().describe("Prompt for the specialist."),
      context: tool.schema.string().optional().describe("Optional extra context appended to the prompt."),
    },
    async execute(args, context) {
      context.metadata({ title: `${args.agent} — ${args.summary}` })
      if (context.sessionID.length === 0) {
        throw new Error("dispatch_background: missing context.sessionID")
      }
      const specialist = createSDKSpecialist(client, context.sessionID)
      const agentRegistry = await loadAgentRegistry(client)
      const result = await startBackgroundTask({
        store: backgroundStore,
        specialist,
        agentRegistry,
        parentSessionId: context.sessionID,
        agent: args.agent,
        prompt: args.prompt,
        context: args.context,
      })
      return JSON.stringify(result, null, 2)
    },
  })

  const pollBackgroundTool = tool({
    description:
      [
        "Check the status of background tasks WITHOUT blocking. Returns a snapshot per id.",
        "- Result per id: { id, agent, status: \"running\" | \"success\" | \"not_found\", result?, duration_ms? }.",
        "- Use to decide whether to keep working or to wait_background.",
      ].join("\n"),
    args: {
      ids: tool.schema.array(tool.schema.string()).describe("Background task ids (bg_...) to check."),
    },
    async execute(args, context) {
      context.metadata({ title: `poll ${args.ids.length} task(s)` })
      const specialist = createSDKSpecialist(client, context.sessionID)
      const ext = getDispatchExtensions()
      const results = await collectBackground({
        store: backgroundStore,
        specialist,
        ids: args.ids,
        block: false,
        scrubber: ext.scrubber,
        parentSessionId: context.sessionID,
      })
      return JSON.stringify(results, null, 2)
    },
  })

  const waitBackgroundTool = tool({
    description:
      [
        "BLOCK until the given background tasks are idle (or time out), then return their results. Collected tasks are removed (one-time retrieval), freeing background slots.",
        "- Result per id: { id, name, status: \"success\" | \"error\" | \"timeout\" | \"aborted\" | \"not_found\", result, duration_ms, error? }.",
        "- Honors abort: aborting cancels the wait AND kills the waited child sessions.",
      ].join("\n"),
    args: {
      ids: tool.schema.array(tool.schema.string()).describe("Background task ids (bg_...) to wait for."),
      timeoutMs: tool.schema.number().optional().describe("Per-task timeout in ms (default 5 min)."),
    },
    async execute(args, context) {
      context.metadata({ title: `wait ${args.ids.length} task(s)` })
      const specialist = createSDKSpecialist(client, context.sessionID)
      const ext = getDispatchExtensions()
      const results = await collectBackground({
        store: backgroundStore,
        specialist,
        ids: args.ids,
        block: true,
        timeoutMs: args.timeoutMs,
        signal: context.abort,
        scrubber: ext.scrubber,
        parentSessionId: context.sessionID,
      })
      return JSON.stringify(results, null, 2)
    },
  })
```

Register them in the returned `tool` map (alongside the existing three):

```typescript
    tool: {
      dispatch_parallel: dispatchParallelTool,
      assign_issue_ids: assignIssueIdsTool,
      compute_waves: computeWavesTool,
      dispatch_background: dispatchBackgroundTool,
      poll_background: pollBackgroundTool,
      wait_background: waitBackgroundTool,
    },
```

Add a `session.deleted` branch to the existing `event` hook. The current hook starts with `if (event.type !== "session.created") return`. Restructure so it handles both — add this BEFORE the `session.created` logic:

```typescript
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        // SDK emits session.deleted for BOTH parent (Perun) and child (background)
        // sessions; child sessions can die independently. Both calls below are
        // no-ops for the "wrong" kind of id, so calling both is safe (mirrors
        // the QA module's session.deleted handler).
        const deletedID = event.properties?.info?.id
        if (typeof deletedID === "string" && deletedID.length > 0) {
          for (const t of backgroundStore.listByParent(deletedID)) {
            try {
              await createSDKSpecialist(client, deletedID).abortTask(t.childSessionId)
            } catch {
              /* best-effort */
            }
          }
          backgroundStore.clearParent(deletedID)
          backgroundStore.removeByChild(deletedID)
        }
        return
      }
      if (event.type !== "session.created") return
      // ... existing session.created toast logic unchanged ...
    },
```

- [ ] **Step 4: Edit `src/agents/perun.md`**

(a) In the frontmatter `allowed-tools:` line, append the three tools: `..., compute_waves, record_input, parse_plan, dispatch_background, poll_background, wait_background`.

(b) In the `## Tool Usage Rules` section, add this bullet (after the Triglav dispatch bullet added in Spec 1B):

```markdown
- **Background dispatch (overlap your own work).** Use `dispatch_background` to start a read-only specialist (especially `triglav`) and keep working in the same turn; it returns a `bg_…` id immediately. Use `poll_background` to check status without blocking, and `wait_background` to block until results are ready. Max 4 background tasks per session — collect one before firing more. **Always `wait_background`/`poll_background` everything you dispatched before ending the turn** — uncollected background work is wasted. Prefer blocking `dispatch_parallel` when you need the result immediately or need ordered QA waves.
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/modules/coordinator/ --config vitest.config.ts`
Expected: PASS (incl. the new perun-tools-sync test and all existing coordinator tests). Then `npx tsc -p tsconfig.json --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/index.ts src/agents/perun.md tests/modules/coordinator/perun-tools-sync.test.ts && git commit -m "feat(coordinator): register background dispatch tools + Perun integration"
```

---

## Task 6: Full verification + dist sync

**Files:** none (verification only; may regenerate `dist/`)

- [ ] **Step 1: Full check suite**

Run: `npm run check`
Expected: PASS — typecheck + all tests (incl. the new coordinator tests) + build.

- [ ] **Step 2: Verify dist sync**

Run: `npm run verify-dist`
Expected: PASS after the build (the new `dist/modules/coordinator/{background,background-store}.js` + updated `index.js`/`dist/agents/perun.md` flow into `dist`; `package.json` `files` already globs `dist`).

- [ ] **Step 3: Commit regenerated dist**

```bash
AV_COMMIT_SKILL=1 git add dist && git commit -m "build(dist): regenerate after background dispatch"
```

(If `git status` shows no `dist` changes, skip this commit.)

---

## Self-Review (completed during planning)

**Spec coverage:**
- Three tools (dispatch/poll/wait) + JSON shapes → Task 5 (tool definitions). ✓
- `BackgroundTaskStore` (lean record, methods) → Task 2. ✓
- `startBackground` via `session.promptAsync` (not detached prompt) → Task 3. ✓
- `startBackgroundTask` (validate + cap + register; reject = no register) + shared `collectBackground` (poll vs wait; disjoint status unions) → Task 4. ✓
- `validateDispatchable` extracted + reused → Task 1. ✓
- Abort kills the child (consistent with dispatch_parallel) → Task 4 (PollerAbortError branch). ✓
- session.deleted cleanup branch (both-IDs-safe, mirror QA) → Task 5. ✓
- Perun frontmatter + Tool Usage note + `PERUN_TOOLS` anti-drift test → Task 5. ✓
- Cap-reset (collect frees a slot) + not_found + timeout → Task 4 tests; store remove → Task 2. ✓
- `crypto.randomUUID` ids → Task 4. ✓
- Validation spike gate → Task 0. ✓
- Reuse neutralize/scrub/truncate/normalizeVariantSuffix → Task 4 (`finalize` + `agent` normalization). ✓
- `BACKGROUND_MAX_CONCURRENT = 4`, separate from sync pool → Task 4. ✓

**Placeholder scan:** no "TBD"/"handle edge cases" — every code step is complete. Task 0 is an explicit manual gate, not a vague placeholder.

**Type consistency:** `BackgroundTask`, `BackgroundTaskStore` methods, `StartBackgroundInput`/`StartBackgroundResult`, `CollectBackgroundInput`/`BackgroundCollectResult`, `startBackgroundTask`/`collectBackground`/`BACKGROUND_MAX_CONCURRENT`, `validateDispatchable`, `startBackground`, `PERUN_TOOLS` — names are consistent across every task and test. `DispatchSpecialist.startBackground` signature (`Promise<string>`) matches its implementation and the fake in Task 4. `pollUntilIdle` options match `poller.ts`. The `session.promptAsync` body matches the SDK `SessionPromptAsyncData` shape.
