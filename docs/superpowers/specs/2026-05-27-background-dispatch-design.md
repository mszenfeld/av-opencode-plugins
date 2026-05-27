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

**The autonomous-progress primitive (linchpin — resolved).** The whole value requires that a
backgrounded child session keeps running server-side while Perun issues other tool calls. The
OpenCode SDK exposes a purpose-built endpoint for exactly this: **`session.promptAsync`**
(`POST /session/{id}/prompt_async`) returns `204 "Prompt accepted"` immediately and the server
runs the turn autonomously — unlike `session.prompt`, whose HTTP response only resolves after
the full LLM turn (`dispatch.ts:105-107`). So `startBackground` uses `promptAsync`, NOT a
detached/un-awaited `session.prompt`. This both removes the fragile dangling-HTTP-connection
approach and is direct evidence the overlap benefit is real (the server has a first-class
async-prompt path; omo's `void promptChain` works for the same reason — the turn runs
server-side regardless of any idle handler). A cheap **validation spike is still the first
implementation step** (see Testing) to empirically confirm overlap before building the rest.

**Push feasibility (recorded for the future cross-turn spec):** also technically possible —
`client.session.prompt({ path: { id: <parentSessionID> }, ... })` could inject a turn into
Perun's session and the `event` hook observes `session.idle`. The risk there is behavioral
(unsolicited Perun turns, wake loops, UX), not primitive availability.

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
                        #   listByParent / countRunningByParent / remove / removeByChild /
                        #   clearParent. Testable in isolation.
  background.ts         # startBackgroundTask(...) and the shared
                        #   collectBackground(store, specialist, ids, { block, timeoutMs })
                        #   that backs both poll_background and wait_background (DRY).
  index.ts   (modify)   # register dispatch_background / poll_background / wait_background
                        #   (+ export a PERUN_TOOLS constant for the frontmatter-sync test);
                        #   construct the per-factory store; ADD a session.deleted branch to
                        #   the event hook (none exists today — only session.created).
  sdk-specialist.ts (mod) # add startBackground(agent, prompt): creates the child session,
                        #   then calls session.promptAsync (204 accepted, server runs the turn
                        #   autonomously) and returns the sessionId. No awaited LLM turn.
  dispatch.ts (modify)  # extract the inline subagent-only anti-recursion check (currently
                        #   inside dispatchParallel) into an exported validateDispatchable(
                        #   registry, name) reused by dispatch_background.
```

**Store scope:** `const store = new BackgroundTaskStore()` in the coordinator factory body,
shared by the three tools (all registered in that same factory). NOT a global module
singleton (unlike `dispatch-extensions`, which bridges *across* modules) — factory scope is
sufficient and cleaner here. State is in-memory, per process.

**Key difference vs `dispatch_parallel`:** today's `startTask` does `await create` **and**
`await prompt` (blocks the full LLM turn). Background adds `startBackground`: `await create`,
then `await session.promptAsync` (which returns `204 "accepted"` immediately while the server
runs the turn autonomously), returning the session id. No LLM turn is awaited, and there is
no dangling completion promise. If `create` or the `promptAsync` ack fails, `dispatch_background`
surfaces that synchronously as an error before returning — so there is no detached rejection to
race. Failures *during* the turn surface later via polling the child session (poll →
`running`/`success`; wait → `success`/`timeout`).

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
| `poll_background` | `ids: string[]` | `[{ id, agent, status: "running"\|"success"\|"not_found", result?, duration_ms? }]` (non-blocking; one `fetchMessages` per id) |
| `wait_background` | `ids: string[]`, `timeoutMs?` (default `DEFAULT_TASK_TIMEOUT_MS` = 5 min) | `[{ id, name: agent, status: "success"\|"error"\|"timeout"\|"aborted", result, duration_ms, error? }]` in `ids` order |

`poll_background` and `wait_background` are thin wrappers over a shared
`collectBackground(store, specialist, ids, { block })` helper. `dispatch_background` validates
the agent against the live registry via the extracted `validateDispatchable(registry, name)`
helper (strict `mode: "subagent"` only — the anti-recursion guard, lifted out of
`dispatchParallel`'s inline loop and shared by both tools) and throws if
`countRunningByParent(parent) >= 4`. The two tools' status unions are **deliberately disjoint**:
`poll` is non-blocking so it returns `running`/`not_found` (never `timeout`/`aborted`); `wait`
is terminal so it returns `timeout`/`aborted` (never `running`/`not_found`).

### Task record + store

```typescript
interface BackgroundTask {
  id: string             // "bg_" + crypto.randomUUID() (Node built-in; the repo's
                         //   declared-but-unused `uuid` dep is NOT used)
  childSessionId: string
  parentSessionId: string
  agent: string
  startedAt: number
}
```

The store is lean: it holds the parent→child mapping only. It does NOT store results or
proactively detect completion (that is the deferred push concern). Status is **derived at
collect time** by polling the child session (`running` vs `success`/`timeout`). There is no
stored `error` field — a `promptAsync` ack failure is reported synchronously by
`dispatch_background` (the task is never registered), and in-turn failures surface via polling.

Methods: `register(task)`, `get(id)`, `listByParent(parentId)`, `countRunningByParent(parentId)`,
`remove(id)`, `removeByChild(childId)`, `clearParent(parentId)`.

### `startBackground` (new `DispatchSpecialist` method)

```typescript
startBackground(agentName: string, prompt: string): Promise<string>
```

Awaits `session.create` (so the session exists and we have its id), then awaits
`session.promptAsync(...)` (the `204 "accepted"` ack; the server runs the turn autonomously),
and returns the `sessionId`. No LLM turn is awaited and there is no completion promise — which
removes the register/markError ordering race entirely. A `create`/ack failure rejects, and
`dispatch_background` returns that error to Perun without registering a task. Stays behind the
testable `DispatchSpecialist` interface (a fake specialist returns a sessionId or throws).

### Data flow

1. **dispatch_background:** validate agent (`validateDispatchable`, subagent-only) → check cap
   (`countRunningByParent(parent) < 4`) → `startBackground` (await create + promptAsync ack) →
   `register` → return `{ id, agent, status: "running" }`. If `startBackground` rejects
   (create/ack failure), return the error to Perun and register nothing.
2. **running:** task sits in the store; the child session runs server-side.
3. **poll_background(ids):** per id → `get`; missing → `not_found`;
   `fetchMessages(childSessionId)` → idle? `success` + result (neutralize/scrub/truncate)
   : `running`. Read-only — does not remove.
4. **wait_background(ids, timeoutMs):** per id in parallel (`Promise.all`) →
   `pollUntilIdle(childSessionId, timeout, abort)` → `success`/`timeout`/`aborted`;
   neutralize/scrub/truncate; `normalizeVariantSuffix` on the result name (reuse). On
   **abort**, kill the waited child (`abortTask`) — matching `dispatch_parallel` (the result
   is discarded; within a turn there is no later poll). After returning, **remove** tasks that
   reached a terminal state (one-time retrieval; frees a cap slot).
5. **cleanup — ADD a `session.deleted` branch to the event hook** (none exists today — the
   coordinator hook only handles `session.created`). Mirror the QA module's both-IDs-safe
   pattern (`qa/index.ts`): the SDK emits `session.deleted` for BOTH parent and child IDs.
   id = parent → `listByParent` → `abortTask` each child + `clearParent`; id = child →
   `removeByChild`. Both calls are no-ops when the id is the other kind — safe to call always.

### Perun integration

- `perun.md` frontmatter `allowed-tools`: add `dispatch_background`, `poll_background`,
  `wait_background`. Register the three tools in `coordinator/index.ts` (tool names must
  match the frontmatter — there is already a "keep in sync" comment there). **No anti-drift
  test exists for Perun's tool list today** (unlike Triglav's `TRIGLAV_TOOLS`); 1B's pattern is
  worth replicating — export a `PERUN_TOOLS` constant and add a net-new test asserting every
  `PERUN_TOOLS` name appears in `perun.md`'s `allowed-tools` frontmatter (see Testing #5).
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
| Unknown / non-`subagent` agent in `dispatch_background` | Throws (`validateDispatchable`, the shared anti-recursion guard) | validation before spawn |
| Cap exceeded | `dispatch_background` throws "max 4 background tasks running — collect first" | `countRunningByParent` |
| `create` / `promptAsync` ack failure | `dispatch_background` returns the error to Perun synchronously; nothing is registered (no orphan, no detached rejection to race) | `startBackground` rejects |
| `wait_background` timeout | `status:"timeout"`, task removed | `pollUntilIdle` |
| `context.abort` during `wait_background` | `status:"aborted"`; the waited child is **killed** (`abortTask`) and removed — matching `dispatch_parallel` (result discarded; within a turn there is no later poll) | `pollUntilIdle` honors the signal |
| `poll_background` unknown id | `not_found` (not an error) | store |
| Specialist output (untrusted) | `neutralizeUntrustedOutput` → scrub (if set) → `truncateBytes` | reuse of dispatch internals |

**Abort is consistent with `dispatch_parallel` (revised):** both kill the child on abort —
the result is discarded and, in the within-turn model, there is no later turn from which to
poll. (Keeping the child alive would be a cross-turn behavior, which is out of scope and would
leak a billing session until `session.deleted`.)

**Concurrency:** background tasks are independent server-side sessions, not a worker pool;
`BACKGROUND_MAX_CONCURRENT = 4` per parent bounds spawn count (DoS). This is separate from the
`dispatch_parallel` pool, so the worst case is 4 synchronous + 4 background child sessions per
parent — acceptable and documented.

**Orphan window (accepted risk, prompt-only guard).** "Always collect before ending the turn"
is prompt guidance, not a code-enforced rule. If Perun ends a turn without `wait`/`poll`/abort,
its background children keep running (and billing) server-side until `session.deleted` fires —
which for a long-lived parent session may be a long time. This is **bounded in count** by the
per-parent cap (≤4) but **not in time**; unlike pooled synchronous tasks, a background child has
no pool to drain it. We accept this for the within-turn scope (matching 1B's honesty about
prompt-only guards); a code-level backstop would require the `session.idle` event that the
cross-turn spec will introduce.

**Memory bounding:** the per-parent cap (4) + `session.deleted` cleanup bound the store. A
TTL sweep (as in QA `bindings-store`) is deferred — not needed for the within-turn model.

## Testing

TDD. New tests under `tests/modules/coordinator/`, plus a `perun.md` frontmatter assertion.

0. **Validation spike (FIRST, before building the rest).** Empirically confirm the linchpin
   against a live OpenCode server: a `session.promptAsync` child makes autonomous progress
   while the parent issues unrelated work — i.e. `dispatch_background` → do other work →
   `poll` shows `running` then `success`, with wall-clock < (task A + task B) sequentially.
   If this fails, the within-turn overlap benefit does not exist and the design must be
   reconsidered before further implementation. (Manual/throwaway spike — not a committed test.)
1. **`background-store.test.ts`** — `register`/`get`/`listByParent`/`countRunningByParent`/
   `remove`/`removeByChild`/`clearParent`, including the running-count cap logic and that
   `remove` (post-collect) drops the count so a freed slot is reusable.
2. **`background.test.ts`** — `startBackgroundTask`: validates the agent (unknown / non-subagent
   throws via `validateDispatchable`), throws at the cap, registers on success, and surfaces a
   `startBackground` rejection (create/ack failure) WITHOUT registering. `collectBackground`:
   blocking vs non-blocking returns `running`/`success`/`timeout` correctly — driven by a
   **fake `DispatchSpecialist`** with a controllable `startBackground` + `fetchMessages`.
3. **Integration (fake specialist):** dispatch → `poll` (running) → child idle → `poll`
   (success) / `wait` (success); `wait` timeout → `timeout`; abort during `wait` → `aborted`
   AND the child is aborted + task removed. **Cap-reset loop:** fill to 4 running →
   `dispatch_background` #5 throws → `wait` one → a subsequent dispatch succeeds (collect frees
   a slot).
4. **`sdk-specialist` `startBackground`** — uses `session.promptAsync` (not `session.prompt`):
   assert it resolves the `sessionId` from the `204` ack without awaiting an LLM turn, using a
   fake `OpencodeClient` (the fake's `promptAsync` resolves immediately; `prompt` is NOT called).
5. **Tool registration + frontmatter sync** — the three tools are registered in the
   coordinator; export a `PERUN_TOOLS` constant and assert every name in it appears in
   `perun.md`'s `allowed-tools` frontmatter (net-new anti-drift test — none exists for Perun
   today; mirrors Triglav's `TRIGLAV_TOOLS` test).
6. **Cleanup** — `session.deleted` for a parent aborts + clears its children; for a child,
   removes it; both safe (no-op) when the id is the other kind.
7. **Independence from the sync pool** — a `dispatch_parallel` wave of 4 and 4 background tasks
   coexist; the background cap is independent of the sync 4-worker pool (no shared counter).
8. Full `npm run check` + `npm run verify-dist`; commit regenerated `dist/`.

**Not tested:** the live OpenCode SDK/server (framework integration); whether Perun *chooses*
to dispatch in background (prompt-driven, non-deterministic).

## Future work (context only — separate specs)

- **Cross-turn push (use case #2):** add `session.idle` event-driven completion + push the
  result into Perun's session via `client.session.prompt` (omo's pattern). Would likely
  consolidate `poll`/`wait` into an omo-style `background_output({ ids, block?, since? })` with
  incremental retrieval. Feasibility recorded in Context.
- **`background_cancel`** tool (omo has it) for explicit cancellation before a final answer.
- **Per-task TTL sweep** if orphaned tasks become a memory concern in practice.
