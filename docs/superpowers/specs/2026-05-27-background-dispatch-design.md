# Spec 2 — Background (Non-Blocking) Dispatch

**Date:** 2026-05-27
**Status:** Approved — ready for implementation planning
**Author:** Marian Szenfeld (+ Claude)

## Context

Pantheon (the Perun harness in `av-opencode-plugins`) is modeled on
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (omo). This is the
**third and final** spec in the explorer sequence:

- **Spec 1A (done):** the agent-metadata renderer.
- **Spec 1B (done):** Triglav, a read-only exploration agent dispatched **blocking** via
  `dispatch_parallel`.
- **Spec 2 (this document):** background (non-blocking) dispatch so Perun can fire a
  specialist (Triglav first) and overlap it with its own work within a turn.

Today `dispatchParallel` (`src/modules/coordinator/dispatch.ts`) is fully synchronous: it
creates child sessions (`DispatchSpecialist.startTask`), polls each with `pollUntilIdle`
until idle/timeout, and returns ordered results. It runs a 4-worker pool, caps each call at
4 tasks, and applies abort/timeout/`neutralizeUntrustedOutput`/scrub/`truncateBytes`. While
a `dispatch_parallel` call is in flight, Perun is **blocked** — it cannot interleave its own
tool calls.

omo's background dispatch (researched against `dev`): spawns a real child session + a
**detached** `void prompt` (fire-and-forget), tracks tasks in a purely **in-memory**
`TaskStateManager` (the committed `.opencode/background-tasks.json` is a legacy fixture, not
runtime state), detects completion via a `session.idle` event hook (poller backstop), and
**pushes** results back into the parent via an internal prompt + a `chat.message` hook.

### Scope decision: within-turn overlap only (use case #1)

Perun is **turn-based** (it runs when the user prompts it). Three background use cases were
considered:

1. **Within-turn overlap** — Perun fires a background task, does other work in the same
   turn, then collects the result before synthesizing. **Chosen.**
2. **Cross-turn fire-and-forget** — Perun fires, ends its turn, and is later *woken* (push)
   to consume the result. Deferred (see Non-goals).
3. **Exceed the cap-of-4** — subsumed by #1 (fire several, collect when ready).

Within-turn overlap is the YAGNI-right first scope: it delivers real value (Perun-side
concurrency — the omo "explore in background, keep working" pattern), reuses the existing
`dispatch.ts` machinery, and needs **no push and no event-driven completion detection**
(which carry real SDK/behavioral risk). Completion is observed lazily by polling at collect
time, exactly like the synchronous path. Cross-turn push is a strict superset and can be a
later spec once we see that turn-boundary blocking actually hurts.

**Push feasibility (recorded for the future spec):** it IS technically possible —
`client.session.prompt({ path: { id: <parentSessionID> }, ... })` (the same SDK call
`createSDKSpecialist` already uses for children) could inject a turn into Perun's session,
and the plugin `event` hook observes `session.idle`. The risk is behavioral (unsolicited
Perun turns, wake loops, UX), not primitive availability.

## Goal

Add three coordinator tools so Perun can dispatch a specialist without blocking, then
collect the result later in the same turn:

1. `dispatch_background({ agent, summary, prompt, context? })` — start a single task, return
   a `bg_…` id immediately.
2. `poll_background({ ids })` — non-blocking status snapshot per id.
3. `wait_background({ ids, timeoutMs? })` — block until the given tasks are idle/timeout,
   return results.

Triglav (the read-only explorer) is the first intended client: Perun fires it in the
background, continues its own work, and `wait_background`s before synthesizing.

## Non-goals

- **No cross-turn / push / wake** (use case #2). No `session.idle` event-driven completion,
  no injecting turns into Perun's session. Deferred to a future spec; feasibility recorded
  above.
- **No `background_cancel` tool** (omo has one). Cleanup happens via the session lifecycle
  (`session.deleted`) and the per-parent cap. A cancel tool is a future extension.
- **No persistence across process restarts.** State is in-memory (per process), like omo's
  `TaskStateManager`. Within-turn tasks never need to survive a restart.
- **No change to `dispatch_parallel`, its pool, the QA flow, or the 1A renderer.** Background
  is an additive, separate dispatch path. It is a Perun *capability*, not an agent — no new
  metadata/placeholders.
- **No combined `background_output` tool** (omo's `block?` style). We use three explicit
  tools (clearer for Perun + the TUI gear-log); poll/wait share an internal helper for DRY.
  If a future cross-turn spec adds incremental/streamed retrieval, consolidating to an
  omo-style `background_output` will be reconsidered then.

## Architecture

Everything lives in the existing coordinator module (home of `dispatch_parallel` and its
machinery), reusing `createSDKSpecialist`, `pollUntilIdle`, `sanitize`, `truncate-bytes`.

```
src/modules/coordinator/
  background-store.ts   # BackgroundTaskStore (plain class): register / get /
                        #   listByParent / countRunningByParent / markError /
                        #   remove / removeByChild / clearParent. Testable in isolation.
  background.ts         # startBackgroundTask(...) and the shared
                        #   collectBackground(store, specialist, ids, { block, timeoutMs })
                        #   that backs both poll_background and wait_background (DRY).
  index.ts   (modify)   # register dispatch_background / poll_background / wait_background;
                        #   construct the per-factory store; cleanup in the session.deleted
                        #   branch of the event hook.
  sdk-specialist.ts (mod) # add startBackground(agent, prompt): creates the child session,
                        #   fires the prompt DETACHED (not awaited), returns sessionId +
                        #   the completion promise.
```

**Store scope:** `const store = new BackgroundTaskStore()` in the coordinator factory body,
shared by the three tools (all registered in that same factory). NOT a global module
singleton (unlike `dispatch-extensions`, which bridges *across* modules) — factory scope is
sufficient and cleaner here. State is in-memory, per process.

**Key difference vs `dispatch_parallel`:** today's `startTask` does `await create` **and**
`await prompt` (blocks the full LLM turn). Background adds `startBackground`: `await create`,
then fire `prompt` **detached** (`void`, like omo's `void promptChain`), returning the
session id immediately along with the prompt's `completion` promise. A rejected `completion`
is captured and recorded as the task's error so poll/wait report `status:"error"` instead of
hanging until timeout.

**Session hierarchy preserved:** background tasks are child sessions with
`parentID = parentSessionID` (same as the synchronous path), so anti-recursion and session
hierarchy are unchanged. The `dispatch_parallel` 4-worker pool is untouched.

**Dependency direction:** entirely within `coordinator/`, reusing its own helpers. No new
cross-module dependencies.

## Components

### Tool API

All return JSON-stringified payloads (like the existing coordinator tools). `dispatch_background`
is **single-task** (mirrors omo `background_task`); Perun calls it up to the cap, then
`poll`/`wait` operate on a list of ids.

| Tool | Args | Returns |
|---|---|---|
| `dispatch_background` | `agent` (≤60), `summary` (≤80) — TUI label; `prompt` (string); `context?` (string, appended to prompt) | `{ id: "bg_…", agent, status: "running" }` |
| `poll_background` | `ids: string[]` | `[{ id, agent, status: "running"\|"success"\|"error"\|"not_found", result?, error?, duration_ms? }]` (non-blocking; one `fetchMessages` per id) |
| `wait_background` | `ids: string[]`, `timeoutMs?` (default `DEFAULT_TASK_TIMEOUT_MS` = 5 min) | `[{ id, name: agent, status: "success"\|"error"\|"timeout"\|"aborted", result, duration_ms, error? }]` in `ids` order |

`poll_background` and `wait_background` are thin wrappers over a shared
`collectBackground(store, specialist, ids, { block })` helper. `dispatch_background` validates
the agent against the live registry (`loadAgentRegistry`, strict `mode: "subagent"` only —
reusing the anti-recursion guard) and throws if `countRunningByParent(parent) >= 4`.

### Task record + store

```typescript
interface BackgroundTask {
  id: string             // "bg_" + short uuid
  childSessionId: string
  parentSessionId: string
  agent: string
  startedAt: number
  error?: string         // captured detached-prompt rejection
}
```

The store is lean: it holds the parent→child mapping and a possible early error. It does NOT
store results or proactively detect completion (that is the deferred push concern). Status is
**derived at collect time**: `error` set → `error`; otherwise the child session is polled
(`running` vs `success`/`timeout`).

Methods: `register(task)`, `get(id)`, `listByParent(parentId)`, `countRunningByParent(parentId)`,
`markError(id, msg)`, `remove(id)`, `removeByChild(childId)`, `clearParent(parentId)`.

### `startBackground` (new `DispatchSpecialist` method)

```typescript
startBackground(agentName: string, prompt: string): Promise<{ sessionId: string; completion: Promise<void> }>
```

Awaits `session.create` (so the session exists and we have its id), fires
`session.prompt(...)` **without awaiting it**, and returns `{ sessionId, completion }` where
`completion` is the (unawaited) prompt promise. `background.ts` registers the task, then
attaches `completion.catch(err => store.markError(id, err))`. Keeps everything behind the
testable `DispatchSpecialist` interface (a fake specialist supplies a controllable
`completion`).

### Data flow

1. **dispatch_background:** validate agent (registry, subagent-only) → check cap
   (`countRunningByParent(parent) < 4`) → `startBackground` → `register` → attach
   `completion.catch → markError` → return `{ id, agent, status: "running" }`.
2. **running:** task sits in the store; the child session runs server-side.
3. **poll_background(ids):** per id → `get`; missing → `not_found`; `error` → `error`;
   else `fetchMessages(childSessionId)` → idle? `success` + result (neutralize/scrub/truncate)
   : `running`. Read-only — does not remove.
4. **wait_background(ids, timeoutMs):** per id in parallel (`Promise.all`) → `error` slot, or
   `pollUntilIdle(childSessionId, timeout, abort)` → `success`/`timeout`/`aborted`;
   neutralize/scrub/truncate; `normalizeVariantSuffix` on the result name (reuse). After
   returning, **remove** tasks that reached a terminal state (one-time retrieval).
5. **cleanup (event hook `session.deleted`):** id = parent → `listByParent` → `abortTask`
   each child + `clearParent`; id = child → `removeByChild`.

### Perun integration

- `perun.md` frontmatter `allowed-tools`: add `dispatch_background`, `poll_background`,
  `wait_background`. Register the three tools in `coordinator/index.ts` (tool names must
  match the frontmatter — there is already a "keep in sync" comment there; a test enforces it).
- `perun.md` "Tool Usage Rules" note (only the non-derivable guidance):
  - Use `dispatch_background` for read-only work you can overlap with your own work —
    especially `triglav` (FREE explorer): fire it, keep reading/planning, then
    `wait_background` before synthesizing.
  - Use blocking `dispatch_parallel` when you need the result immediately, it is the only
    work, or you need ordered QA waves.
  - Cap is 4 background tasks per parent — collect one before firing more.
  - **Always collect (`wait`/`poll`) what you dispatched before ending the turn** — in this
    within-turn model, ending the turn without collecting wastes the work (tasks are cleaned
    on `session.deleted`).
- Triglav (1B) metadata is unchanged; add one sentence that it suits background dispatch.

## Error handling

| Situation | Behavior | Caught by |
|---|---|---|
| Unknown / non-`subagent` agent in `dispatch_background` | Throws (reuses the anti-recursion validation, like `dispatch_parallel`) | validation before spawn |
| Cap exceeded | `dispatch_background` throws "max 4 background tasks running — collect first" | `countRunningByParent` |
| Detached prompt rejection | `store.markError` → `poll`/`wait` report `status:"error"` (no hang-to-timeout) | `completion.catch` |
| `wait_background` timeout | `status:"timeout"`, task removed | `pollUntilIdle` |
| `context.abort` during `wait_background` | `status:"aborted"`; the child is **NOT** killed (the task must survive a single `wait` so Perun can poll again); cleaned on `session.deleted` | `pollUntilIdle` honors the signal |
| `poll_background` unknown id | `not_found` (not an error) | store |
| Specialist output (untrusted) | `neutralizeUntrustedOutput` → scrub (if set) → `truncateBytes` | reuse of dispatch internals |

**Abort difference vs `dispatch_parallel` (deliberate):** the synchronous path *kills* the
child on abort (`cleanupOnAbort`) because its result is discarded. Here, `wait_background`
abort only *stops waiting* — the child lives on for later retrieval. Children are killed only
when the parent session is deleted.

**Concurrency:** background tasks are independent detached sessions, not a worker pool;
`BACKGROUND_MAX_CONCURRENT = 4` per parent bounds spawn count (DoS). This is separate from the
`dispatch_parallel` pool, so the worst case is 4 synchronous + 4 background child sessions per
parent — acceptable and documented.

**Memory bounding:** the per-parent cap (4) + `session.deleted` cleanup bound the store. A
TTL sweep (as in QA `bindings-store`) is deferred — not needed for the within-turn model.

## Testing

TDD. New tests under `tests/modules/coordinator/`, plus a `perun.md` frontmatter assertion.

1. **`background-store.test.ts`** — `register`/`get`/`listByParent`/`countRunningByParent`/
   `markError`/`remove`/`removeByChild`/`clearParent`, including the running-count cap logic.
2. **`background.test.ts`** — `startBackgroundTask`: validates the agent (unknown / non-subagent
   throws), throws at the cap, registers the task, and routes a rejected `completion` to
   `markError`. `collectBackground`: blocking vs non-blocking returns `running`/`success`/
   `error`/`timeout` correctly — driven by a **fake `DispatchSpecialist`** with a controllable
   `completion` and `fetchMessages`.
3. **Integration (fake specialist):** dispatch → `poll` (running) → completion → `poll`
   (success) / `wait` (success); `wait` timeout → `timeout`; abort during `wait` → `aborted`
   AND the task survives (not removed, child not aborted).
4. **`sdk-specialist` `startBackground`** — creates the session and fires the prompt WITHOUT
   awaiting it: assert it resolves `sessionId` before `completion` settles (fire-and-forget
   confirmed) using a fake `OpencodeClient`.
5. **Tool registration + frontmatter sync** — the three tools are registered in the
   coordinator; an anti-drift test asserts `perun.md` frontmatter `allowed-tools` lists all
   three names (guards the manual tool-name sync).
6. **Cleanup** — `session.deleted` for a parent aborts + clears its children; for a child,
   removes it.
7. Full `npm run check` + `npm run verify-dist`; commit regenerated `dist/`.

**Not tested:** the live OpenCode SDK/server (framework integration); whether Perun *chooses*
to dispatch in background (prompt-driven, non-deterministic).

## Future work (context only — separate specs)

- **Cross-turn push (use case #2):** add `session.idle` event-driven completion + push the
  result into Perun's session via `client.session.prompt` (omo's pattern). Would likely
  consolidate `poll`/`wait` into an omo-style `background_output({ ids, block?, since? })` with
  incremental retrieval. Feasibility recorded in Context.
- **`background_cancel`** tool (omo has it) for explicit cancellation before a final answer.
- **Per-task TTL sweep** if orphaned tasks become a memory concern in practice.
