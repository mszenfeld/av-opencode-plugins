# Pantheon — Coordinator MVP Design

**Status:** Draft — pending implementation plan
**Date:** 2026-05-18
**Branch:** `feature/harness`
**Spec author:** Marian Szenfeld + Claude (brainstorming session)

---

## 1. Context

### 1.1 What we are doing

Pilot a paradigm shift in how AppVerk's OpenCode-plugin workflows are orchestrated. Today every workflow (`/review`, `/run-qa`, `/fix-report`, `/python`, `/frontend`, etc.) lives as a long markdown command template that the LLM reads and follows step-by-step. The orchestration logic — what to call, when to dispatch, how to merge results, how to assign IDs — is **prose interpreted by the model**, not deterministic code.

Inspired by `code-yeongyu/oh-my-openagent` (OMO) — which keeps orchestration in TypeScript and uses agents (not commands) as the primary user-facing entry point — we are introducing a coordinator-style agent and a deterministic dispatch tool.

This document specifies the **MVP** of that approach: one new coordinator agent, one new tool, and a single piloted workflow (`/run-qa` replacement). The existing `/run-qa` stays untouched as A/B comparable control.

### 1.2 The harness brand

The whole repository is being rebranded as **Pantheon** — a harness for AI agents named after Slavic deities, with **Perun** (the king of gods) as the coordinator. Future agents may be added under the same theme.

This spec covers only the coordinator + QA pilot. Repo-level rename is out of scope.

### 1.3 Why now

Earlier analysis (this conversation) identified that prose-driven orchestration in `av-opencode-plugins` has concrete fragility points:

- "Parallel" dispatch depends on LLM emitting multiple `Task()` calls in one response — no enforcement.
- Issue ID counters (`sec_count`, `perf_count`, `QA-NNN`) are maintained mentally by the LLM.
- Race-safety in `/run-qa` is fixed by writing to separate `.tmp-*-findings.md` files — pragmatic patch, not a primitive.
- Completion detection is "Task tool returns directly" — no idle/stability signaling.
- Workflows cannot compose across sessions (`/review` ends with documentation pointing user to `/fix-report`; nothing chains them).

The user's primary motivation (from brainstorming) is **workflow composability** — a single agent that can carry work across review → fix → commit boundaries within one conversation.

### 1.4 What we are NOT doing in this MVP

- Not building model-category routing (OMO `task` tool's category system). Agents use whatever model the session is on.
- Not implementing background/async dispatch. All dispatch is synchronous with poll-loop.
- Not building intent detection / keyword routing. `@perun` must be invoked explicitly.
- Not deprecating any existing commands. `/run-qa`, `/review`, `/python`, etc. continue working.
- Not renaming the repository or restructuring published package boundaries.
- Not adding skill auto-loading to `@perun`. Specialist skills work as today.

---

## 2. Decisions Made (with reasoning)

| Decision | Choice | Reason |
|---|---|---|
| Approach (A/B/C/D) | **C — Coordinator + pilot in parallel** | Pure pilot creates throwaway code; pure primitives over-engineer in a vacuum; coordinator-with-real-pilot validates both the user-facing pattern and the dispatch API shape. |
| Pilot workflow | **`/run-qa` replacement** | Simpler shape than `/review` (2 specialists vs. 5+verification); clean A/B against existing prose-driven version. |
| Coordinator agent name | **`@perun`** | Slavic mythology (less worn out than Greek); Perun is the king of gods commanding lesser deities — exact metaphor for coordinator+specialists. |
| Harness brand | **Pantheon** | International, brandable, fits the "house of gods" frame containing `@perun` and future specialists. |
| Entry point | **`@perun` only** — no `/qa` shortcut | Clean A/B test: `/run-qa` (old prose), `@perun ...` (new). A shortcut would let users avoid the new paradigm and dilute the signal. Adding shortcuts later is cheap; removing them is hard. |
| Dispatch tool shape | **`dispatch_parallel(tasks: [...])`** — array-based | Tool guarantees parallelism, not the LLM. Single-task case is `tasks: [one]`. Eliminates a known fragility class. |
| Issue ID assignment | **Dedicated tool `assign_issue_ids`** (not prose) | Pure function — the simplest place to demonstrate "move deterministic logic out of prose into code". If we keep prose, MVP fails to prove the pattern. |
| Composability UX | **Active proposals** — coordinator suggests next workflow | Aligns with user's primary motivation (composability). |
| Poll/timeout defaults | **Hardcoded 2s poll, 5min per-task timeout** | Tunable later. Don't bikeshed config keys before we know real behavior. |
| Intent detection / keywords | **Not in MVP** | Explicit `@perun` invocation only. Add later if friction is real. |

---

## 3. Architecture

### 3.1 High-level

```
User: "@perun uruchom QA dla docs/testing/plans/X.md"
                            │
                            ▼
              ┌─────────────────────────┐
              │  @perun  (mode: primary)│
              │  packages/coordinator/  │
              │  src/agents/perun.md    │
              └────────────┬────────────┘
                           │
                  emits one tool call:
                  dispatch_parallel({ tasks: [...] })
                           │
                           ▼
              ┌─────────────────────────┐
              │  dispatch_parallel      │  ← TypeScript, deterministic
              │  packages/coordinator/  │  ← validates, dispatches,
              │  src/dispatch.ts        │     polls, collects
              └─────┬───────────┬───────┘
                    │           │
                    ▼           ▼
              qa-fe-tester  qa-be-tester      ← existing subagents
              (mode: subagent, unchanged)
                    │           │
                    └─────┬─────┘
                          ▼
              @perun receives Array<{ name, status, result, ... }>
                          │
                          ▼
              assign_issue_ids({ findings, prefix: "QA" })
                          │
                          ▼
              Write report → respond to user with summary
              + proactive next-step suggestion
```

### 3.2 What lives where

| Concern | Location | Form |
|---|---|---|
| Conversation with user, workflow steering, parsing test plan, sanitization, report formatting | `@perun` system prompt (markdown) | LLM-interpreted prose |
| Dispatching specialists, parallel execution, polling for completion, timeout enforcement, result collection | `dispatch_parallel` tool | TypeScript |
| Issue ID assignment | `assign_issue_ids` tool | TypeScript pure function |
| Test execution (Playwright / curl+psql) | `qa-fe-tester`, `qa-be-tester` agents | Markdown system prompts (unchanged) |

The boundary is deliberate: **deterministic operations move to code; intent/judgment stays in prose**. We are not eliminating prose orchestration — we are draining it of the parts that LLMs unreliably execute.

---

## 4. Components

### 4.1 Agent `@perun`

**File:** `packages/coordinator/src/agents/perun.md`

**Frontmatter:**

```yaml
---
name: perun
description: Pantheon coordinator — delegates work to specialists, synthesizes results, proposes next steps
mode: primary
allowed-tools: Read, Write, Edit, Bash(mkdir:*), Bash(ls:*), Bash(git:*), Glob, Grep, todowrite, question, dispatch_parallel, assign_issue_ids
---
```

**Notes on allowed-tools:**

- `Edit` is permitted **specifically** for updating report `**Status:**` lines after a fix continuation (same convention as today's `/fix-report`). Coordinator must not edit source code itself — that's specialist work. Tighter scoping (markdown-only Edit) is follow-up; in MVP this is enforced by the system prompt, not by tool config.
- `Bash(*)` is limited to a small subcommand allowlist; the coordinator does not run arbitrary shell.

**Explicitly excluded from allowed-tools:**

- `Task` — prevents fallback to prose dispatch; forces `dispatch_parallel`.

**System prompt structure (sections):**

1. **Identity** — "You are Perun, coordinator. You do not do work directly."
2. **Available specialists** — table with name, what each does, when to call.
3. **Workflows you know** — for MVP, two:
   - **QA run** — read plan → sanitize → dispatch testers → collect → assign IDs → report → propose fix if issues found.
   - **Issue fix (continuation)** — when invoked directly *or* as a continuation of a QA run, dispatch `fix-auto` per issue sequentially, update report Status line, summarize.
4. **Tool usage rules** — always use `dispatch_parallel` for specialist work, never inline-replicate, pass minimal but sufficient context.
5. **Composability rules** — after each workflow result, evaluate whether to actively propose a next step (e.g., "fix HIGH issues?", "commit changes?").
6. **Safety rules** — sanitization checks (carried over from existing `/run-qa` Step 4), result truncation policy.

This is one stable system prompt. New workflows are added by extending section 3.

### 4.2 Tool `dispatch_parallel`

**File:** `packages/coordinator/src/dispatch.ts`

**Contract:**

```typescript
dispatch_parallel({
  tasks: Array<{
    name: string,        // specialist agent name; must exist in config.agent
    prompt: string,      // task prompt
    context?: string,    // optional structured context appended to prompt
  }>
}) => Array<{
  name: string,
  status: "success" | "error" | "timeout",
  result: string,        // specialist's full output (markdown), possibly truncated
  duration_ms: number,
  error?: string,        // only when status === "error"
}>
```

**Internal flow:**

1. Pre-flight validation:
   - Every `name` exists in `config.agent`. Unknown name → fail entire call with structured error before any session is created.
   - No `name` resolves to an agent with `mode: "primary"`. Prevents `@perun → @perun` recursion.
2. For each task, create a subagent session (`session.create({ parent_id, agent: name })`) and send the prompt.
3. All sessions launched **before** any waiting — guarantees true parallelism.
4. `Promise.all` over per-session poll loops:
   - Poll every 2s for `idle` state (preferred: SDK event listener; fallback: poll `session.list_messages` for assistant message with finish_reason).
   - Per-task hard timeout: 5 min. Past timeout → status `"timeout"`, return last captured message as `result` (may be empty).
   - Per-task `try/catch` around SDK errors → status `"error"` with reason.
5. Result size cap: per task, 100KB. Larger → truncate with marker `[…truncated…]`.
6. Return array in the **same order** as input tasks.

**Defaults (hardcoded, tunable later):**

- `pollIntervalMs = 2000`
- `taskTimeoutMs = 5 * 60 * 1000`
- `resultMaxBytes = 100 * 1024`

### 4.3 Tool `assign_issue_ids`

**File:** `packages/coordinator/src/assign-issue-ids.ts`

**Contract:**

```typescript
assign_issue_ids({
  findings: Array<{ severity: string, title: string, [k: string]: unknown }>,
  prefix: string,   // "QA", "SEC", "PERF", ...
  startAt?: number, // default 1
}) => Array<{
  id: string,       // e.g., "QA-001"
  severity: string,
  title: string,
  [k: string]: unknown,
}>
```

**Behavior:**

- Pure function. No side effects.
- IDs are zero-padded to 3 digits (`QA-001`, ..., `QA-999`). Beyond 999 → `QA-1000` (no padding overflow protection — assume nobody hits 4-digit issue counts per run).
- Order of input findings preserved. ID numbering follows input order.
- Empty findings → empty array.
- Idempotent: running twice on the same findings yields the same IDs (id field overwritten, not appended).

### 4.4 Package layout

```
packages/coordinator/
├── package.json              # @appverk/opencode-coordinator
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts              # Plugin factory: AppVerkCoordinatorPlugin
│   ├── dispatch.ts           # dispatch_parallel tool
│   ├── assign-issue-ids.ts   # assign_issue_ids tool
│   ├── poller.ts             # session poll loop (separate for testability)
│   └── agents/
│       └── perun.md          # system prompt (lazy-loaded into config.agent)
├── tests/
│   ├── dispatch.test.ts
│   ├── poller.test.ts
│   ├── assign-issue-ids.test.ts
│   └── perun-qa-flow.integration.test.ts
└── dist/                     # built output, committed (mirror of existing packages)
```

### 4.5 Root registration

Per existing `AGENTS.md` conventions:

- `src/index.ts` — import `AppVerkCoordinatorPlugin` from `../packages/coordinator/dist/index.js`; add to `defaultPluginFactories`.
- `src/index.js` — mirror the change (runtime entrypoint).
- Root `package.json` — add `packages/coordinator/dist/` to `files`.
- `.gitignore` — add exception for `packages/coordinator/dist/`.

---

## 5. Data Flow — concrete example

**User:** `@perun uruchom QA dla docs/testing/plans/2026-05-18-feature-auth.md`

1. **Session start** — OpenCode spawns `@perun` session with stable system prompt.
2. **Pre-dispatch (in `@perun`, no specialist calls):**
   - `Read` the test plan file.
   - Parse `## FE Test Scenarios` and `## BE Test Scenarios` sections.
   - Sanitize each scenario (block `.env`, `~/.ssh`, `~/.aws`, `/etc/passwd`, network exfil, etc.). Logic is the same as today's `/run-qa.md` Step 4, now in the agent's permanent prompt.
   - `Bash("mkdir -p docs/testing/reports")`.
3. **Dispatch (single `dispatch_parallel` call):**

   ```
   dispatch_parallel({
     tasks: [
       { name: "qa-fe-tester", prompt: "<FE scenarios + base URL>", context: "<plan metadata>" },
       { name: "qa-be-tester", prompt: "<BE scenarios + base URL>", context: "<plan metadata>" }
     ]
   })
   ```

4. **Inside the tool (TypeScript):**
   - Validate both names exist; both are `mode: subagent`. OK.
   - Create both sessions; send both prompts; both running.
   - `Promise.all` over per-session pollers.
   - After both complete (or hit timeout), return array of 2 results.

5. **Post-dispatch (in `@perun`):**
   - Parse each result into structured findings (specialists already use known format from `fe-testing` / `be-testing` skills).
   - Concatenate FE + BE findings.
   - Call `assign_issue_ids({ findings, prefix: "QA" })` → findings with `QA-001`, `QA-002`, ...
   - Sort by severity (CRITICAL → HIGH → MEDIUM → LOW).

6. **Report generation:**
   - `Write("docs/testing/reports/2026-05-18-feature-auth-report.md", ...)` using format from `report-format` skill.

7. **User response with composability hint:**

   ```
   Test Report: feature-auth
   - Total: 14 | Pass: 11 | Fail: 2 | Skip: 1
   - Issues found: 2 (1 HIGH, 1 MEDIUM)

   Top issues:
   - [HIGH] QA-001: Login endpoint returns 500 on empty body
   - [MEDIUM] QA-002: Password reset email not sent

   Full report: docs/testing/reports/2026-05-18-feature-auth-report.md

   Chcesz, żebym naprawił te problemy? Mogę zlecić to fix-auto specjaliście
   w tej samej rozmowie.
   ```

   Active suggestion is part of the composability behavior. If the user accepts, `@perun` continues into a minimal fix workflow in the same conversation:

   - Identify the issue(s) to fix from the report (the user may name them, or `@perun` defaults to all HIGH+ severity).
   - For each issue, call `dispatch_parallel({ tasks: [{ name: "fix-auto", prompt: <full issue block> }] })`. One issue per dispatch (sequential fixes — same as today's `/fix-report` semantics).
   - After each fix, update the report file with `**Status:** ✅ Fixed (YYYY-MM-DD)` line (same convention as `/fix-report` uses today).
   - Summarize fixes in the final response.

   This is the **minimum** composability demonstration the MVP must support. Full equivalent of `/fix-report` (batched interactive selection across many issues, multi-file merge, paginated `question` UI) is **out of MVP scope** — covered by Section 9.

---

## 6. Error Handling

`dispatch_parallel` **always returns an array of the same length as input**. Partial failures do not abort the workflow — `@perun` synthesizes whatever is available.

| Event | Where handled | Result |
|---|---|---|
| Unknown specialist name | `dispatch_parallel` pre-flight | Fail-fast structured error, **no sessions created**. `@perun` reports the typo. |
| Primary-mode specialist requested | `dispatch_parallel` pre-flight | Fail-fast (anti-recursion). |
| Session creation SDK error | `dispatch_parallel` per task | `{ status: "error", result: "", error: "<reason>" }`. Other tasks continue. |
| Per-task timeout (5 min) | `dispatch_parallel` poller | `{ status: "timeout", result: <last captured>, duration_ms: 300000 }`. |
| Empty specialist response | `dispatch_parallel` passes through | `{ status: "success", result: "" }`. `@perun` decides whether to retry. |
| Malformed specialist output | `dispatch_parallel` passes through | Raw text returned. `@perun` parses best-effort. |
| Test plan file missing | `@perun` pre-dispatch | Short user-facing error. No dispatch. |
| Plan has no FE/BE scenarios | `@perun` pre-dispatch | User-facing message. No dispatch. |
| All scenarios rejected by sanitization | `@perun` post-sanitize | User-facing explanation. No dispatch. |
| Only FE / only BE | `dispatch_parallel` with `tasks.length === 1` | Normal path. No special handling. |
| One specialist succeeds, one fails | `@perun` post-dispatch | **Partial report**: full findings from the successful specialist + section noting the failure. Report saved. |
| `assign_issue_ids` failure (shouldn't happen — pure fn) | `@perun` fallback | Internal-error response; report saved without IDs. |

**Safety bounds (hardcoded, tunable):**

- Sanitization checks before dispatch (carried over from existing `/run-qa`).
- No primary-mode agents callable through `dispatch_parallel` (anti-recursion).
- 5-minute hard timeout per task.
- 100KB result size cap per task; larger → `[…truncated…]` marker.

---

## 7. Testing Strategy

### 7.1 Unit tests

**`dispatch.test.ts`:**

- Unknown specialist → error before `session.create`.
- Primary-mode specialist → rejected (anti-recursion).
- Parallel execution: 2 tasks both start before either completes (timing assertion on mocked SDK).
- Timeout: task exceeding `taskTimeoutMs` → status `"timeout"`; other tasks unblocked.
- Per-task error isolation: one SDK exception does not affect others.
- Result size cap: response > 100KB → truncated with marker.
- Mocking: fake OpenCode session API (`session.create`, `session.prompt`, idle event or polled messages).

**`assign-issue-ids.test.ts`:**

- Empty input → empty output.
- Input order preserved.
- IDs start at `001`, increment by 1, zero-padded to 3 digits.
- Custom prefix (`QA`, `SEC`, `PERF`).
- Custom `startAt`.
- Idempotent.

**`poller.test.ts`:**

- Detects idle state via mocked event.
- Falls back to message polling when no events.
- Honors timeout.

### 7.2 Integration test

**`perun-qa-flow.integration.test.ts`:**

End-to-end with stubbed specialists returning canned responses:

1. Mock `qa-fe-tester` → canned FE findings.
2. Mock `qa-be-tester` → canned BE findings.
3. Spawn `@perun` session with prompt referencing `tests/fixtures/sample-plan.md`.
4. Assert:
   - `dispatch_parallel` called once with 2 tasks.
   - `docs/testing/reports/...-report.md` exists.
   - Report contains both findings sets with correctly assigned `QA-001`, `QA-002`.
   - Final response contains summary + composability hint.

### 7.3 Packaging tests

Extend `tests/root-plugin.test.ts`:

- `AppVerkCoordinatorPlugin` registered in `defaultPluginFactories`.
- `dispatch_parallel` and `assign_issue_ids` present in merged tools (no duplicates).
- `perun` present in `config.agent` with `mode: "primary"`.
- `npm pack --dry-run` output includes `packages/coordinator/dist/`.

### 7.4 Not tested in MVP

- Behavioral assertions on `@perun` system prompt output (string-matching on LLM text is fragile). Manual validation + integration test asserting *shape* (report exists, IDs present, summary block present).
- High-cardinality parallel stress (10+ specialists). Out of scope; revisit when more specialists exist.
- Automated A/B benchmark vs. existing `/run-qa`. Manual comparison during pilot.

---

## 8. Open Risks

| Risk | Mitigation |
|---|---|
| **(Critical)** OpenCode plugin SDK may not expose `session.create` / `session.prompt` / idle events programmatically to plugin tools | Validate **first** during implementation planning — this is the single biggest unknown that could invalidate the design. If SDK is insufficient, fallback options: (a) call existing `Task` tool from inside `dispatch_parallel`, losing some determinism but keeping the agent-first UX; (b) postpone MVP until SDK supports it; (c) propose upstream change to OpenCode. |
| LLM in `@perun` ignores allowed-tools restriction and tries to call `Task` anyway | OpenCode enforces allowed-tools at runtime — non-permitted calls fail. Verify during MVP. |
| Composability proposals from `@perun` feel intrusive to users used to terse output | Tunable in system prompt after first usage; can gate proposals on severity threshold. |
| Existing specialists (`qa-fe-tester`, `qa-be-tester`, `fix-auto`) may reference behavior specific to being called from their old command context (`/run-qa`, `/fix-report`) | Audit their prompts before MVP starts; adjust calling prompt or specialist prompt if needed. |
| Sequential fix loop in `@perun` (one `dispatch_parallel` call per issue) could be slow for many issues | MVP accepts this — matches today's `/fix-report` sequential semantics. Parallel fixes are explicit Section 9 follow-up. |

---

## 9. Out of Scope (Future Work)

These are explicitly deferred to follow-up specs:

- **Full `/fix-report` equivalent** — batched interactive issue selection across many issues, paginated `question` UI, multi-report auto-merge (newest review + newest QA), per-issue status icons summary table. MVP supports only minimum sequential fix-after-QA continuation (Section 5).
- **Parallel fix execution** — multiple `fix-auto` dispatches in a single `dispatch_parallel` call. MVP fixes sequentially (one task per call) to mirror today's safety.
- **Background dispatch** (`run_in_background: true`). Today everything is synchronous.
- **Model-category routing**. Agents declare capability requirements; plugin maps to model per provider.
- **Intent detection / keyword triggers**. User types natural language; system routes to `@perun` automatically.
- **Migration of other workflows** (`/review`, `/python`, `/frontend`, `/commit`) to coordinator pattern. Decide after MVP pilot.
- **Repo rename** to Pantheon-themed identity.
- **Skill auto-loading in `@perun`** (load relevant Python/Frontend skills based on detected stack).
- **Persistent state / boulder equivalent** (cross-session continuity for long-running workflows).
- **Plan/Execute separation** (Prometheus + Atlas pattern from OMO).
- **5-tier hook layering** equivalent.
- **Tightened tool-permission scoping** (e.g., markdown-only Edit, more granular Bash allowlist).

Each of these gets its own spec once we have evidence from MVP about what's needed.

---

## 10. Success Criteria

The MVP is considered successful if all of the following hold after manual A/B comparison:

1. `@perun uruchom QA dla <plan>` produces a report with the same structural quality as `/run-qa <plan>` on the same input.
2. `dispatch_parallel` reliably executes both QA specialists in parallel (verified by integration test timing).
3. Issue IDs are correctly assigned in every run (deterministic — never skipped, never duplicated).
4. `@perun` proactively proposes a follow-up (e.g., "fix HIGH issues?") when applicable, and the user can accept inside the same conversation.
5. Existing `/run-qa` continues to work without regression.
6. All unit + integration tests pass; `npm run check` is green.

If any of these fail, the MVP either needs iteration or — if a fundamental issue is discovered (e.g., SDK limitations) — we reassess the approach.
