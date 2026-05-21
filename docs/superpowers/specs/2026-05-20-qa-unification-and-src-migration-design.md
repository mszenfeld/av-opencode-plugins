# QA Plugin Redesign: Unified Tester + Per-Scenario Dispatch + src/ Harness Absorption

**Date:** 2026-05-20 (revised 2026-05-21 after user review)
**Status:** Draft — awaiting user re-review
**Related:** `docs/plugins/qa.md`, `docs/plugins/coordinator.md`, `packages/coordinator/src/agents/perun.md`, `packages/coordinator/src/dispatch.ts`, `packages/skill-registry/src/index.ts`, `AGENTS.md` (absorbed-modules section)

---

## Goal

Three coupled changes shipped together:

1. **Replace `qa-fe-tester` + `qa-be-tester` with a single logical `qa-tester` agent**, implemented as two registered variants (`qa-tester-fe`, `qa-tester-be`) composed from a shared prompt builder. The variants split `allowed-tools` per stack so the security boundary stays at the OpenCode runtime, not at prompt level. Every user-facing surface (TUI label, report, docs) shows just `qa-tester`.
2. **Switch Perun's QA dispatch from FE/BE pole to per-scenario granularity** — one `qa-tester` task per `### FE-XX:` / `### BE-XX:` block. Realised by extending `dispatch_parallel` with a **worker-pool semantics** (hardcoded concurrency = 4): all scenarios go into one call, the tool runs at most 4 in flight, picks the next from the queue when a slot frees up.
3. **Absorb both `packages/qa/` and `packages/coordinator/` into `src/`** following the commit-pilot precedent. Two plugins move in one PR because Perun's prompt + QA agents + the dispatcher are co-modified by changes 1 and 2 — keeping them in separate workspace packages mid-edit just adds churn.

---

## Why Now

- `packages/qa/` and `packages/coordinator/` are the two largest workspace plugins still outside `src/`. The harness consolidation (oh-my-openagent-style single-tree layout) only pays off once the heavy plugins absorb.
- The FE/BE split was useful when Perun's dispatcher had no granularity primitive. With the new worker pool, parallelism becomes a *property of the dispatcher*, not a property of the plan or agent topology. The plan stays human-readable; Perun maximises hardware/model utilisation underneath.
- Today a 30-scenario plan funnels through 2 agents and serialises within each. With per-scenario dispatch + 4-wide pool, the same plan runs ~4× faster (ignoring tail latency of the slowest scenario).

---

## Non-Goals

- **Cross-scenario data isolation** (transactional sandboxes, per-scenario data prefixes). Concurrent scenarios touching shared state can still race even with explicit `**Depends-on:**` ordering — the dependency mechanism gives plan authors a knob to serialise *known* dependencies, but doesn't auto-detect accidental shared state. True isolation (per-scenario test fixtures, transactional rollback) is deferred to a future revision.
- **Auto-grouping by feature area in `/create-qa-plan`.** The generator stays "dumb" — it emits scenarios under `## FE Test Scenarios` / `## BE Test Scenarios` as today. All granularity decisions live in the dispatcher, not in the plan shape.
- **Configurable pool size.** Concurrency is hardcoded to 4 in `dispatch_parallel`. A future revision can promote it to a tool argument or env var; not in this scope.
- **Changing the report shape.** `report-format` skill stays as-is; QA-NNN IDs are assigned by `assign_issue_ids` regardless of how many tasks produced findings.
- **Changing the Pantheon coordinator's responsibilities.** Only its code location (`packages/` → `src/modules/`) and the dispatcher implementation change. The `@perun` agent's surface is unchanged for users.

---

## Architecture

### Final src/ layout

```
src/
├── index.ts                       # imports from ./modules/qa/, ./modules/coordinator/
├── commands/
│   ├── commit.md                  # existing
│   ├── create-qa-plan.md          # moved from packages/qa/src/commands/
│   └── run-qa.md                  # moved
├── agents/
│   └── perun.md                   # moved from packages/coordinator/src/agents/
├── skills/
│   └── qa/
│       ├── test-plan-format/SKILL.md   # moved
│       ├── report-format/SKILL.md      # moved
│       ├── fe-testing/SKILL.md         # moved (content unchanged)
│       └── be-testing/SKILL.md         # moved (content unchanged)
├── modules/
│   ├── commit/                    # existing
│   ├── qa/
│   │   ├── index.ts               # AppVerkQAPlugin factory — registers fe + be variants
│   │   ├── prompt-builder.ts      # buildQATesterAgent(stack) → full markdown
│   │   ├── allowed-tools.ts       # FE_TOOLS, BE_TOOLS, SHARED_TOOLS constants
│   │   └── prompt-sections/
│   │       ├── core.md            # shared body — execution loop, result format
│   │       ├── overlay-fe.md      # Playwright-specific instructions
│   │       └── overlay-be.md      # HTTP/DB-specific instructions
│   └── coordinator/
│       ├── index.ts               # AppVerkCoordinatorPlugin factory + tool registration
│       ├── dispatch.ts            # dispatchParallel + worker-pool semaphore
│       ├── sdk-specialist.ts      # moved
│       ├── sanitize.ts            # moved
│       ├── assign-issue-ids.ts    # moved
│       ├── poller.ts              # moved
│       └── truncate-bytes.ts      # moved
└── hooks/
    └── session-notification/      # existing
```

Tests move:
- `packages/qa/tests/` → `tests/modules/qa/`
- `packages/coordinator/tests/` → `tests/modules/coordinator/`

Both follow the commit-pilot precedent.

### `qa-tester` — logical agent with two registered variants

The QA plugin registers two subagents (`qa-tester-fe`, `qa-tester-be`) composed programmatically from a shared source. From outside the plugin they are presented as a single logical `qa-tester` — Perun's label, every report, every doc reference uses the bare name. The variant suffix exists only because OpenCode's plugin API requires each registered agent to have a unique `name` and an `allowed-tools` list fixed at registration time; splitting at this layer is what keeps the runtime tool-allowlist as the security boundary (one stack's variant cannot exec the other stack's tools regardless of prompt content). This is a precedented abstraction (e.g. Kubernetes Service → Pods, connection pool → connections).

**Plugin init (`src/modules/qa/index.ts`):**
```ts
const VARIANTS = ["fe", "be"] as const
for (const stack of VARIANTS) {
  config.agent[`qa-tester-${stack}`] = {
    description: `QA tester — ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`,
    get prompt() { return buildQATesterAgent(stack) },
    mode: "subagent",
  }
}
```

**Prompt builder (`src/modules/qa/prompt-builder.ts`):**
- Reads `prompt-sections/core.md` once (lazy-cached).
- Reads the matching `prompt-sections/overlay-{stack}.md`.
- Builds frontmatter from `allowed-tools.ts` constants (`SHARED_TOOLS ∪ FE_TOOLS` for the fe variant; `SHARED_TOOLS ∪ BE_TOOLS` for the be variant).
- Returns `---\n<frontmatter>\n---\n\n<core>\n\n<overlay>`.

**Per-variant `allowed-tools` split:**
- FE variant: Playwright `playwright_browser_*` + `Bash(playwright:*)` + shared base.
- BE variant: `Bash(curl:*)`, `Bash(httpie:*)`, `Bash(http:*)`, `Bash(psql:*)`, `Bash(sqlite3:*)`, `Bash(mysql:*)`, `Bash(mongosh:*)`, `Bash(redis-cli:*)`, `Bash(jq:*)`, `Bash(grep:*)`, `Bash(cat:./*)`, `Bash(head:./*)`, `Bash(tail:./*)` + shared base.
- Shared base (both variants): `Bash(mkdir:*)`, `Bash(command:*)`, `Bash(echo:*)`, `Read`, `Write`, `skill`.

**Invariant for `core.md` content:** everything in core must be stack-neutral. Anything Playwright- or HTTP/DB-specific lives in the overlay. A test asserts each variant's built prompt contains exactly one overlay's tool references. Documented in `prompt-builder.ts` as the maintenance contract.

**Routing (Perun → variant):** Perun reads the scenario's prefix during sanitisation (Workflow 1 Step 3). Regex `^#{2,4}\s+(FE|BE)-\d+`, case-insensitive.
- `FE` match → task with `name: "qa-tester-fe"`.
- `BE` match → task with `name: "qa-tester-be"`.
- No match → scenario rejected at sanitisation; never reaches dispatch.

The variant agent's prompt body (core + overlay) is a single-scenario execution loop: load the matching skill, run main flow + edge cases, return result. No multi-scenario iteration — that's the dispatcher's job.

### `dispatch_parallel` worker pool

`src/modules/coordinator/dispatch.ts` gains a semaphore-style pool:

- Hardcoded constants: `const DISPATCH_CONCURRENCY = 4`, `const DISPATCH_MAX_TASKS = 50`.
- The `tasks[]` cap rises from 10 → 50. Beyond 50, `dispatch_parallel` rejects the call before spawning any child session with an explicit error (`"dispatch_parallel: tasks.length (N) exceeds DISPATCH_MAX_TASKS (50)"`). The cap exists to bound total token spend against cost-DoS — the worker pool throttles wall-clock concurrency but not the cumulative cost of draining the queue. 50 was chosen as the ceiling because a realistic large PR generates ≲ 30–40 scenarios; 50 leaves headroom while still failing closed on plans an order of magnitude bigger than legitimate use.
- Implementation sketch: maintain an index `next = 0` over the input `tasks[]`. Spawn 4 worker promises; each worker, in a loop, takes the next task by post-increment of `next` (single-threaded JS — no true atomicity needed; `next++` between `await` points is race-free), runs it, writes the result into `results[index]`. Worker exits when `next >= tasks.length`. The outer `dispatch` resolves when all workers exit.
- **Abort behavior:** each worker checks `signal.aborted` at the top of its loop, *before* claiming the next task. Aborted workers exit immediately. Never-started tasks get `results[i] = { name, status: "aborted", duration_ms: 0, result: "", error: "aborted before start" }`. In-flight tasks honor the existing abort threading (poller checks signal each iteration, returns `status: "aborted"`).
- External contract preserved: `dispatch_parallel({ agent, summary, tasks })` returns `results[]` in the same order as `tasks[]`. **Caveat for callers:** observable timing behavior changes when `tasks.length > 4` — what used to start all in parallel now drains through a 4-wide pool. Existing 1–2 task callers (FE+BE dispatch today, `fix-auto` single-task) see no difference.
- Anti-recursion validation, ANSI sanitisation, 100KB truncation, 5-minute per-task timeout — all unchanged.

### `agent` label rendering — logical-name exception

**Standard convention** (in `dispatch_parallel`'s schema description and in `perun.md` Tool Usage Rules): the `agent` label should reflect `tasks[].name(s)` — bare for one task, `name ×N` for N copies, comma-joined for mixed names.

**Exception for logical agents with variants:** when a logical agent is implemented as multiple registered variants (here, `qa-tester` → `qa-tester-fe` + `qa-tester-be`), use the **logical name** in `agent`, not the variant names. The variant mapping must be documented in the dispatching agent's prompt (here, Perun's "Available Specialists" table). This exception is mandatory; without it the next person editing dispatcher code will follow the standard convention and leak the variant suffix to the TUI.

Concrete rendering rules for QA dispatch:
- `N ≤ 10` (any mix of variants) → `qa-tester ×N`. Example: 4 FE + 3 BE → `qa-tester ×7`.
- `N == 1` → bare `qa-tester`.
- `N > 10` → bare `qa-tester` (drop the multiplier to avoid label clutter; `summary` carries the human-meaningful description like `"run 2026-05-19-login plan"`).

Schema + perun.md must both be updated to add this exception in the same commit that introduces the variants.

### Artifact filename convention

Today's FE agent writes screenshots to `docs/testing/reports/screenshots/fe-XX-fail.png` keyed by scenario ID. Under per-scenario concurrent dispatch this convention must be enforced (not optional) to prevent filename collisions between workers. The `qa-tester` prompt mandates: every artifact filename embeds the scenario ID prefix, never a wall-clock timestamp. Specifically: `<scenario-id>-<purpose>.<ext>` (e.g. `FE-04-fail.png`, `BE-02-response.json`). A test in `tests/modules/qa/` asserts two concurrently-dispatched scenarios with the same purpose do not collide.

### Skill-registry path update

`packages/skill-registry/src/index.ts` currently hardcodes skill directories under `packages/<name>/dist/skills/`. After absorption, the `qa` entry must point at `src/skills/qa/` (or, after the root build, `dist/skills/qa/`). This is part of the migration, not a separate task:

```typescript
const skillDirectories = [
  path.resolve(moduleDirectory, "../../python-developer/dist/skills"),
  path.resolve(moduleDirectory, "../../frontend-developer/dist/skills"),
  path.resolve(moduleDirectory, "../../code-review/dist/skills"),
  // REMOVE: path.resolve(moduleDirectory, "../../qa/dist/skills"),
  // ADD:    path.resolve(moduleDirectory, "../../../dist/skills/qa"),
  path.resolve(moduleDirectory, "../../swift-developer/dist/skills"),
]
```

(`skill-registry` itself is not absorbed into `src/` in this PR — it stays a workspace package; only its skill-discovery list updates.)

### Plan format — minimal extension: optional `Depends-on:` field

Plans keep using `## FE Test Scenarios` / `## BE Test Scenarios` with `### FE-XX:` / `### BE-XX:` blocks. No `Test Group:`, no `Stack:` annotation. **One optional addition:** scenarios may declare dependencies on other scenarios via a `**Depends-on:**` field directly beneath the heading, listing zero or more scenario IDs.

Example:
```markdown
### BE-01: POST /api/users creates user
- **Area:** users endpoint
- **Method:** POST /api/users
- ...

### BE-02: PUT /api/users updates the user created in BE-01
**Depends-on:** BE-01
- **Area:** users endpoint
- ...

### BE-03: DELETE /api/users removes the user
**Depends-on:** BE-01, BE-02
- ...
```

Semantics:
- A scenario without `**Depends-on:**` is independent — runs as soon as a pool worker is free.
- A scenario with `**Depends-on:** X` runs only after every listed predecessor has completed (any status — pass, fail, or skip). Failure of a predecessor does not block dependents; the dependent runs against whatever state was left. (Rationale: tests should surface errors, not skip silently. If `BE-01 create user` fails and `BE-02 update user` then sees 404, that's diagnostic data, not noise.)
- Dependencies can cross stacks: `BE-02 [depends-on: FE-01]` is valid (e.g. FE creates the user via UI, BE asserts on the resulting DB state).
- Self-reference, circular cycles, and references to non-existent scenarios are hard errors at plan-parse time (see Error handling below).

This field is **opt-in**. Old plans without any `**Depends-on:**` keep parsing as before and dispatch fully in parallel. `/create-qa-plan` does not emit the field by default in v1 — generator stays "dumb"; authors add `**Depends-on:**` when they know two scenarios share state.

### Perun Workflow 1 changes

Step 5 ("Dispatch specialists") becomes:

1. Parse the plan: extract every `### FE-XX:` and `### BE-XX:` block (with its edge cases and any `**Depends-on:**` field) into a flat list of scenario blocks. Preserve source order.
2. Sanitise per-scenario (existing rules apply to each block individually).
3. Drop scenarios where sanitisation rejected every step.
4. **Build dependency graph and validate.** Parse each scenario's `**Depends-on:**` field (default: empty list). Verify: no self-references, no references to non-existent or sanitisation-dropped scenarios, no cycles (Kahn's algorithm — if any nodes remain unprocessed after the algorithm completes, there's a cycle). On any violation, abort the run with a clear error pointing at the offending scenario(s); do not call `dispatch_parallel`.
5. **Compute dispatch waves via topological sort.** Wave 0 = scenarios with no dependencies. Wave N+1 = scenarios whose every dependency was in some earlier wave. Continue until all scenarios are assigned to a wave. The same dependency graph is consulted at runtime to ensure no scenario starts before its predecessors have all reported back (any status — pass, fail, skip; failure does not block dependents).
6. **Dispatch waves sequentially.** For each wave in order:
   a. Build `tasks[]` for the wave — one task per scenario in this wave. The task's `name` is the variant the scenario routes to:
      ```
      FE-NN scenario → { name: "qa-tester-fe",
                         prompt: "<sanitised single scenario block>\n\nBase URL: <url>",
                         context: "Plan: <filename> | Branch: <branch> | Source: <source> | Wave: <i>/<total>" }

      BE-NN scenario → { name: "qa-tester-be", prompt: ..., context: ... }
      ```
   b. Call `dispatch_parallel({ agent, summary: "<plan filename> (wave <i>/<total>)", tasks })` where the `agent` label follows the **logical-name exception** (see "agent label rendering" above): always `"qa-tester ×N"` (or bare `"qa-tester"` for `N == 1` or `N > 10`), where `N` is the wave's task count. Never `"qa-tester-fe ×3, qa-tester-be ×2"`.
   c. Wait for the wave's results before starting the next wave. Accumulate findings into a single list across waves.
   d. The `DISPATCH_MAX_TASKS = 50` cap applies per wave (not cumulative across waves). Practically: legitimate plans have wave sizes well under 50; if any single wave would exceed 50, the cap fires for that wave only and Perun surfaces the wave-specific error.
7. Merge accumulated findings in scenario-source order (the original markdown order, not the wave-dispatch order). **Variant suffix normalisation:** before writing the report or surfacing any error string to the terminal, replace `qa-tester-(fe|be)` → `qa-tester` in every user-facing string (findings text, error messages, all-scenarios table). Internal log/debug strings may keep variant names. Findings concatenation, `assign_issue_ids`, severity sort, report write — otherwise unchanged.

**Single-wave fast path:** when no scenario declares `**Depends-on:**` (the common case, including all existing plans), there's exactly one wave containing every scenario. Step 6 collapses to one `dispatch_parallel` call — identical to the design pre-C2. The wave machinery has zero overhead on dependency-free plans.

Perun's "Available Specialists" table collapses to:

| Name | Mode | Purpose | When to use |
|---|---|---|---|
| `qa-tester` | subagent | Execute a single QA scenario (FE or BE). Internally split into variants `qa-tester-fe` / `qa-tester-be`; Perun routes by scenario prefix. | Dispatched once per scenario by Perun |
| `fix-auto` | subagent | Auto-fix code issues from reports | When user accepts a fix proposal |

The "internally split into variants" note is the canonical reference for any future dispatcher code — never invent new variant naming without updating this table.

### Data flow

```
User → /run-qa <plan>
  → Perun reads plan + extracts scenarios (flat list, with **Depends-on:** fields)
  → Perun sanitises each scenario + routes by prefix (FE→qa-tester-fe, BE→qa-tester-be)
  → Perun builds dependency graph + validates (no cycles, no missing refs, no self-refs)
  → Perun computes waves via topological sort
  → For each wave in order:
       dispatch_parallel({ agent: "qa-tester ×N", summary: "<plan> (wave i/total)", tasks })
         │ Pool of 4 workers internally:
         │   Worker 1 takes task 0 → dispatches to qa-tester-{fe|be} → finishes → takes task 4 → ...
         │   Worker 2 takes task 1 → ...
         │   Worker 3 takes task 2 → ...
         │   Worker 4 takes task 3 → ...
         └ results[] returned in tasks[] order
       Accumulate findings
  → Perun merges all-wave findings in scenario-source order
  → Normalise variant suffixes in user-facing strings (qa-tester-{fe,be} → qa-tester)
  → assign_issue_ids({ findings, prefix: "QA" })
  → Write docs/testing/reports/<date>-<topic>-report.md
  → Display summary, propose fix
```

For dependency-free plans (no `**Depends-on:**` anywhere), there's exactly one wave containing every scenario — the per-wave loop runs once and the result is identical to a flat per-scenario dispatch.

### Error handling

| Failure | Behavior |
|---|---|
| Scenario without FE-/BE- prefix | Rejected by Perun during sanitisation; never dispatched. Listed in report's All Scenarios table as SKIP with reason "no recognised prefix". |
| Skill load fails inside qa-tester variant | Variant returns error result; Perun marks scenario SKIP, reason: "skill `<name>` unavailable" |
| Required tool missing (Playwright in FE variant, curl/psql in BE variant) | Variant returns error result; Perun marks scenario SKIP with tool-specific reason (today's pattern) |
| Wrong-variant dispatch (Perun routing bug) | Runtime allowlist rejects the cross-stack tool call → variant returns "tool not available" → Perun marks SKIP. **No cross-stack tool execution possible.** This is the defense-in-depth property — see Security section below. |
| `dispatch_parallel` returns `status: error` / `timeout` for one task | Perun records that scenario as SKIP with the reason; **error string normalised** (`qa-tester-fe`/`qa-tester-be` → `qa-tester`) before display. Other scenarios still complete. |
| Pool worker crashes mid-run | Worker promise rejects → that one task gets `status: error`; remaining workers continue draining the queue (other tasks unaffected) |
| `tasks.length > 50` | `dispatch_parallel` rejects the call before any session spawns with `"tasks.length (N) exceeds DISPATCH_MAX_TASKS (50)"`. Perun surfaces this to the user as a hard error on the QA run, with a suggestion to split the plan or reduce scenarios. |
| Sanitisation rejects every step of every scenario | Perun reports "no executable scenarios after sanitisation", does not call dispatch_parallel |
| Dependency cycle in plan (`A` depends on `B`, `B` depends on `A`) | Hard error at plan-parse time; abort the run with a message naming the cycle members (e.g. `"dependency cycle detected: BE-02 → BE-03 → BE-02"`). Do not call dispatch_parallel. |
| Dependency on non-existent or sanitisation-dropped scenario | Hard error at plan-parse time; abort with message naming the dangling reference (e.g. `"BE-05 depends on BE-99 which does not exist"`). |
| Self-reference (`**Depends-on:** BE-02` inside `BE-02`) | Hard error at plan-parse time; abort with message. |
| Predecessor scenario fails (e.g. `BE-01` returns 500) | Dependents (e.g. `BE-02 [depends-on: BE-01]`) still run — failure does not block dependents. They may surface diagnostic failures that point back to the predecessor's root cause. Intentional; documented in the plan-format guidance. |

Existing `dispatch_parallel` guarantees (untrusted-output neutralisation, 100KB truncation, abort threading) are unchanged.

### Testing

- `tests/modules/coordinator/dispatch.test.ts` (moved + extended):
  - Existing batch behaviour tests still pass (2-task dispatch, error propagation, abort).
  - **New:** worker-pool tests — pass 8 fast tasks, assert max 4 in-flight at any moment (via timestamp + counter); pass 6 tasks where #3 hangs, assert #4–#6 still complete; pass 50 tasks, assert completion; pass 51 tasks, assert rejection with `"exceeds DISPATCH_MAX_TASKS (50)"` error before any session spawns.
- `tests/modules/coordinator/perun-qa-flow.test.ts` (moved + updated):
  - Replace existing 2-task FE/BE expectations with N-task per-scenario expectations using `name: "qa-tester-fe"` / `name: "qa-tester-be"`.
  - Add a multi-scenario plan fixture (e.g. 6 FE + 4 BE → 10 qa-tester variant tasks, label rendered as `qa-tester ×10`).
  - Add an error-normalisation case: a task fails with error `"Task qa-tester-fe timed out"`; assert the rendered report contains `"qa-tester timed out"` (suffix stripped).
  - **Dependency-aware dispatch cases:**
    - Plan with no `**Depends-on:**` → one wave; behaviour identical to dependency-free baseline.
    - Plan `BE-01 → BE-02 [depends-on: BE-01] → BE-03 [depends-on: BE-02]` (chain) → three waves of one task each; assert wave 2 starts only after wave 1's task completes.
    - Plan `BE-01, BE-02 [depends-on: BE-01], BE-03 [depends-on: BE-01]` (fan-out) → wave 0 = BE-01, wave 1 = BE-02 and BE-03 in parallel.
    - Plan with cycle `BE-01 [depends-on: BE-02], BE-02 [depends-on: BE-01]` → no dispatch; assert clear cycle-error message.
    - Plan with dangling ref `BE-05 [depends-on: BE-99]` (BE-99 does not exist) → no dispatch; assert dangling-ref error.
    - Plan with self-ref `BE-02 [depends-on: BE-02]` → no dispatch; assert self-ref error.
    - Plan where predecessor fails: assert dependent still runs and is reported normally (not skipped).
- `tests/modules/qa/plugin.test.ts`:
  - Registration smoke: `qa-tester-fe` and `qa-tester-be` are present; `qa-fe-tester` / `qa-be-tester` / `qa-tester` (without suffix) are absent.
  - Builder output: `buildQATesterAgent("fe")` produces a markdown whose frontmatter contains every entry in `FE_TOOLS ∪ SHARED_TOOLS` and none of `BE_TOOLS`. Symmetric assertion for `"be"`.
  - Core/overlay invariant: `buildQATesterAgent("fe")` contains the `overlay-fe.md` content and not `overlay-be.md` content. Symmetric.
  - Artifact filename collision test: simulate two concurrent variant runs writing screenshots/dumps for scenarios `FE-04` and `FE-05`; assert no filename collision.
- `tests/root-plugin.test.ts`:
  - Assert `dist/modules/qa/index.js`, `dist/modules/qa/prompt-builder.js`, `dist/modules/qa/prompt-sections/*.md`, `dist/modules/coordinator/index.js`, `dist/agents/perun.md`, `dist/commands/create-qa-plan.md`, `dist/commands/run-qa.md`, four `dist/skills/qa/*/SKILL.md` paths.
  - Note: no `dist/agents/qa-tester*.md` — the variant prompts are built in memory from `prompt-sections/`, never written to `dist/agents/`.
- No live-server end-to-end tests in CI — variant behaviour is exercised through fake `SDKClient` injection in coordinator tests.

### Security

The variant split is not just an implementation detail — it is a security invariant. Three properties to preserve in future evolution:

1. **Runtime allowlist is the boundary.** Each variant's `allowed-tools` lists only the tools its stack legitimately needs. OpenCode enforces this at the runtime layer regardless of prompt content. A scenario whose body tries to exec a cross-stack tool (e.g. an FE-prefixed scenario attempting `curl https://attacker.tld`) fails at the allowlist check, not at a prompt-level guard. This restores the same security model as today's split FE/BE agents.

2. **Defense in depth against Perun routing bugs.** If Perun's prefix → variant routing has a bug (e.g. an `FE-` scenario routed to the BE variant), the wrong variant simply lacks the requested tool and returns "tool not in allowlist". The scenario fails safely as SKIP. No silent compromise. Compare to a single-registration design (Ścieżka X): a routing bug there would silently execute the cross-stack tool. The variant split is therefore not redundant with Perun sanitisation — it's an independent layer.

3. **Sanitisation still applies first.** Perun's per-step sanitisation (Workflow 1 Step 3, today's rules) runs before variant routing. Attempts to inject cross-stack commands into a scenario step are caught at the coordinator level; the runtime allowlist is the second line. Removing either layer would weaken the model.

When adding a new variant (e.g. `qa-tester-mobile`), the implementer must (a) define its `allowed-tools` to include only that stack's legitimate tools, (b) add the corresponding prefix → variant rule in Perun's sanitisation, (c) update this Security section to enumerate the new stack. Skipping (a) re-opens the boundary; skipping (b) routes new-stack scenarios to a wrong variant and they SKIP (correct fail-safe).

### Known leak (accepted in v1)

The `/agents` slash command listing **may** show both `qa-tester-fe` and `qa-tester-be` to users who explicitly browse the registry. `mode: subagent` filters tab-completion (per AGENTS.md) but I have not verified whether it also filters the `/agents` listing. If it doesn't, the variant suffix is visible to that one introspection path. Mitigation: the variant `description` fields explicitly say "internal variant of qa-tester" so a curious user can map back to the logical agent. Documenting in `docs/plugins/qa.md` is sufficient. Promoting a "hidden" flag to OpenCode is deferred.

---

## Migration Order

The PR is large enough that a single squash-merge would be hard to review. Each numbered step is one commit; the branch is mergeable only after step 11 lands. Step boundaries chosen to keep `npm run check` green at every commit.

1. **dispatch_parallel worker pool** — implement semaphore in `packages/coordinator/src/dispatch.ts` (still in `packages/`), raise the `tasks[]` cap from 10 to 50 (`DISPATCH_MAX_TASKS = 50`), hardcode `DISPATCH_CONCURRENCY = 4`, add abort-on-pool-iteration check, surface explicit error on cap overflow. Add new pool tests including the cap-enforcement case. **Backwards-compatible:** existing 2-task calls behave identically. Coordinator tests stay green.
2. **QA agent swap + Perun update + plan-format extension (atomic)** — single commit:
   - Add `packages/qa/src/modules/prompt-builder.ts`, `prompt-sections/{core,overlay-fe,overlay-be}.md`, `allowed-tools.ts` (these live in `packages/qa/src/` for this step; they move to `src/modules/qa/` in step 3).
   - Update `packages/qa/src/index.ts` to register `qa-tester-fe` + `qa-tester-be` via the builder; remove `qa-fe-tester` / `qa-be-tester` registrations.
   - Update the `test-plan-format` skill: add the optional `**Depends-on:**` field with example and semantics (no cycles, no self-refs, no dangling refs; predecessor failure does not block dependents).
   - Switch `packages/coordinator/src/agents/perun.md` to per-scenario dispatch with prefix → variant routing, dependency parsing + topological sort + wave dispatch, the logical-name label exception, and the variant-suffix normalisation in result handling.
   - Update `dispatch_parallel`'s schema description (in `packages/coordinator/src/index.ts`) to document the logical-name label exception.
   - Update `packages/qa/tests/qa-plugin.test.ts` and `packages/coordinator/tests/perun-qa-flow.test.ts` fixtures, including the new dependency-aware cases.
   This collapses what was previously several sub-steps because each in isolation leaves a broken state: registering new agents without Perun update = dead registrations; updating Perun without new registrations = unknown-agent errors; removing old agents while Perun still references them in fixtures = failing tests; plan-format change without Perun parser change = silent feature-flag-only stub. Only the union is `npm run check` green.
3. **Move QA + skill-registry repoint (atomic)** — single commit:
   - Create `src/modules/qa/{index.ts, prompt-builder.ts, allowed-tools.ts, prompt-sections/}`, `src/commands/{create-qa-plan,run-qa}.md`, `src/skills/qa/**`. Tests move to `tests/modules/qa/`.
   - No new `src/agents/qa-tester*.md` files — the variant prompts are built in memory by `prompt-builder.ts` at plugin init; only `src/agents/perun.md` lands in `src/agents/` (step 6).
   - Update `packages/skill-registry/src/index.ts` to point at `dist/skills/qa` (in the same commit so the registry is never out of sync with the skill location).
   - `scripts/copy-root-assets.mjs` already covers `agents/` and `skills/` directories (verified — no script change needed). It also needs to handle `src/modules/qa/prompt-sections/*.md` — verify whether `modules/<name>/**/*.md` is in the copier's globs; if not, add it in this commit.
   - `tsup.root.config.ts` globs all `.ts` under `src/` so the module also builds without config changes.
4. **Swap QA import in `src/index.ts`** — replace `import { AppVerkQAPlugin } from "../packages/qa/dist/index.js"` with `import { AppVerkQAPlugin } from "./modules/qa/index.js"`.
5. **Delete `packages/qa/`** — workspace dir, dist, `.gitignore` carveouts, `verify-dist-sync.mjs` entry, root `package.json` workspaces entry.
6. **Move coordinator into src/** — `src/modules/coordinator/` with `index.ts` + all `.ts` modules, `src/agents/perun.md`. Tests move to `tests/modules/coordinator/`.
7. **Swap coordinator import in `src/index.ts`** — `import { AppVerkCoordinatorPlugin } from "./modules/coordinator/index.js"`.
8. **Delete `packages/coordinator/`** — same scrub as step 5.
9. **Doc rewrites** — `README.md`, `docs/plugins/qa.md`, `docs/plugins/coordinator.md`, `docs/plugins/pantheon.md`, `AGENTS.md` layout table (drop two workspace rows, add two `src/modules/` rows).
10. **Final `npm run check`** — typecheck + test + build + dist sync.

Steps 1–2 are dispatcher + prompt changes inside the existing workspace layout (per-scenario behaviour fully tested before any files move). Steps 3–5 absorb QA. Steps 6–8 absorb coordinator. Step 2's three-thing atomic commit is the only one with non-trivial coupling; everything else is one-thing-per-commit.

---

## Recorded Default Decisions (Awaiting Spec Review)

| Decision | Default | Source |
|---|---|---|
| Logical agent name | `qa-tester` | User-confirmed direction |
| Variant split | `qa-tester-fe` + `qa-tester-be` registered; logical name `qa-tester` everywhere user-facing | User-confirmed (Path Y, after dynamic-builder discussion + critical review) |
| Prompt composition | shared `prompt-builder.ts` + `core.md` + `overlay-{fe,be}.md` + `allowed-tools.ts` | User-confirmed (dynamic-agent pattern from oh-my-openagent within OpenCode's static-registration constraint) |
| Logical-name label exception | mandatory in `dispatch_parallel` schema + perun.md | Derived from critique — required to prevent suffix leak |
| Variant-suffix normalisation in user-facing strings | mandatory in Perun's result-handling | Derived from critique — required to prevent suffix leak via error strings |
| Pool concurrency | hardcoded `4` | User-chosen |
| `tasks[]` cap | `DISPATCH_MAX_TASKS = 50` (raised from 10) | User-chosen — explicit ceiling against cost-DoS via crafted PR; worker pool throttles wall-clock concurrency, cap throttles cumulative cost |
| Skill loading trigger | scenario ID prefix (`FE-` / `BE-`) routes Perun → variant | User-confirmed (no `Stack:` header) |
| Plan format | unchanged | User-confirmed |
| `/create-qa-plan` generator | unchanged ("dumb") | User-confirmed |
| Coordinator migration | included in this PR | User-confirmed |
| Skill-registry update | included in this PR | User-confirmed |
| Cross-scenario isolation (transactional sandboxing) | out of scope | User-confirmed |
| Data-dependent scenarios | opt-in `**Depends-on:**` field; Perun computes waves via topological sort | User-confirmed — escape hatch for existing plans (`BE-01 create → BE-02 update → BE-03 delete`) that would otherwise race under per-scenario dispatch |
| Predecessor failure semantics | dependents still run (do not skip on predecessor fail) | I picked — failure-as-diagnostic-signal beats silent skip; documented in plan-format and error-handling table |
| `/create-qa-plan` emits `**Depends-on:**` by default | no — generator stays "dumb"; authors annotate manually when needed | User-confirmed (generator simplicity > inferred dependency hints) |
| Aliases for old agent names | none — hard rename | I picked — clean consolidation moment |

---

## Risks (Not Resolved By This Design)

- **Token cost from per-scenario sessions.** Each scenario = one child session = one full system prompt + the matching skill (`fe-testing` ≈ 290 lines, `be-testing` ≈ 314 lines). For a 20-scenario plan that's ~20× the per-session skill load vs today's 2 sessions sharing a single skill each. Conservatively a 10× input-token increase on the QA path. The pool throttles concurrency to 4 (wall-clock = `(N/4) × per-scenario time`); the `DISPATCH_MAX_TASKS = 50` cap throttles total spend (max ~50× the per-session cost on a single dispatch). Beyond 50 scenarios `dispatch_parallel` rejects the call entirely. Legitimate plans rarely cross 30–40 scenarios; the 50 ceiling provides headroom while failing closed on plans an order of magnitude larger than legitimate use.
- **Concurrent backend conflicts (residual).** Even with `**Depends-on:**`, scenarios that don't *know* they share state (e.g. two scenarios both deleting from the same table without declaring an ordering) will race under 4-wide pool execution. The opt-in dependency mechanism catches deliberate sequences (create → update → delete on the same entity); it doesn't catch accidental shared state. Plan authors must still design with concurrency in mind; the `**Depends-on:**` field gives them an explicit knob when they recognise the issue.
- **Pool starvation by a slow scenario.** If one scenario hits the 5-minute per-task timeout, that pool slot is blocked for 5 minutes. The other 3 workers keep draining, so total throughput drops 25% but doesn't halt.
- **Migration depends on root build tooling.** `tsup.root.config.ts`, `scripts/copy-root-assets.mjs`, `verify-dist-sync.mjs`, `tests/root-plugin.test.ts` must all handle `src/agents/`, `src/skills/qa/**`, and `src/modules/coordinator/`. The commit pilot established the pattern; QA and coordinator are larger but structurally identical.

---

## Open Questions (For Implementation Plan)

- Should the dispatcher's `next` index use `Atomics` (for safety against future concurrent JS engines) or plain mutation (single-threaded Node)? Plain mutation is fine today; mention in implementation as a deliberate choice.
- Whether to bump the published version + cut a git tag after step 11 (deletion of `packages/coordinator/`) or at the very end after doc rewrites. Likely the latter — consumers want the docs that match.
- Whether `report-format` skill needs any nudge when reports come from many small tasks instead of two big ones. Best guess: no — the QA-NNN structure is task-agnostic. Verify during implementation.
