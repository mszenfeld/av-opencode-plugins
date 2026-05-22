---
allowed-tools: Bash(find:*), Bash(ls:*), Bash(head:*), Bash(cat:*), Bash(mkdir:*), Bash(date:*), Bash(command:*), Bash(echo:*), Bash(git:*), Read, Glob, Grep, todowrite, question
argument-hint: [path to test plan file]
description: Execute a QA test plan by handing it to @perun for per-scenario dispatch via dispatch_parallel.
---

# QA Test Runner

You execute QA test plans by handing the plan to **@perun**, the Pantheon coordinator. Perun owns the entire QA-run pipeline: scenario parsing, sanitization, prefix-based routing to `zmora` variants, dependency-aware topological waves, per-scenario dispatch through `dispatch_parallel`, result merging, and report writing.

**You do not dispatch subagents yourself.** Your only responsibilities are: resolve which test plan to run, then delegate to `@perun`.

---

## Arguments

**Input:** `$ARGUMENTS`

| Argument | Interpretation |
|----------|---------------|
| (empty) | Find the most recent test plan in `docs/testing/plans/` |
| `<path>` | Use the specified test plan file |

**Finding the most recent plan:**

```bash
ls -t docs/testing/plans/*.md 2>/dev/null | head -1
```

If no plans found, inform the user and stop:

> No test plans found in `docs/testing/plans/`. Run `/create-qa-plan` first.

If the user-supplied path does not exist, surface the error and stop:

> Test plan not found: `<path>`. Use `/create-qa-plan` to generate one or pass a valid path.

---

## Workflow

### Step 1: Create Progress Tasks

Use `todowrite` to create:

| # | subject | activeForm |
|---|---------|-----------|
| 1 | Resolve test plan | Resolving test plan... |
| 2 | Hand off to Perun | Handing off to @perun... |

### Step 2: Resolve the Test Plan

**Task Update:** Mark task 1 as `in_progress` using `todowrite`.

1. If `$ARGUMENTS` is empty, run the `ls -t` command above to find the newest plan.
2. If `$ARGUMENTS` is a path, verify it exists using the Read tool (or `ls`).
3. Capture the absolute or repository-relative path of the resolved plan file.

**Do NOT read, parse, sanitize, or modify the plan content here.** Perun owns sanitization and parsing — see `src/agents/perun.md` Workflow 1, Step 3 and Step 5.

**Task Update:** Mark task 1 as `completed` using `todowrite`.

### Step 3: Delegate to @perun

**Task Update:** Mark task 2 as `in_progress` using `todowrite`.

Compose a single message that hands the plan path to `@perun`. Use this exact format (substitute the resolved plan path):

```
@perun uruchom QA dla <resolved-plan-path>
```

Or, in English:

```
@perun run QA for <resolved-plan-path>
```

Perun will then:

1. **Read** the plan and parse `## FE Test Scenarios` / `## BE Test Scenarios` sections.
2. **Sanitize** every scenario block (block sensitive file access, unauthorized network exfil, raw bash outside `playwright` / `curl` / `psql` / `sqlite3`).
3. **Route by prefix:** every `### FE-XX:` scenario routes to the `zmora-fe` variant; every `### BE-XX:` scenario routes to the `zmora-be` variant. The user-facing label is always the logical `zmora` — variant suffixes are internal.
4. **Build the dependency graph** by parsing optional `**Depends-on:**` annotations on each scenario. Self-references, cycles, and dangling references abort the run with a clear error before any specialist is dispatched.
5. **Compute topological waves:** Wave 0 = scenarios with no dependencies; Wave N+1 = scenarios whose predecessors all live in some earlier wave. Plans with no `**Depends-on:**` annotations (the common case) collapse to a single wave via the fast path — no overhead.
6. **Dispatch each wave** through `dispatch_parallel({ agent, summary, tasks })` — one task per scenario, with a 4-wide worker pool. Each wave waits for completion before the next begins. The 50-task cap is per-wave.
7. **Merge findings** across waves in scenario-source order (the original markdown order, NOT wave order).
8. **Assign QA-XXX IDs** via `assign_issue_ids` and sort by severity (CRITICAL → HIGH → MEDIUM → LOW).
9. **Write the report** to `docs/testing/reports/YYYY-MM-DD-<topic>-report.md` where `<topic>` is the plan filename minus the leading date prefix and the trailing `-test-plan` suffix.
10. **Display a summary** with totals, top issues, and an offer to fix them via `fix-auto`.

**Task Update:** Mark task 2 as `completed` using `todowrite` once you have handed off to `@perun`. Do not wait for Perun's response — the handoff completes your part of the workflow.

---

## What You MUST NOT Do

- **Do NOT** call `dispatch_parallel`, `task`, or any agent yourself. Dispatching is Perun's responsibility — your `allowed-tools` deliberately omit `task` and `dispatch_parallel` to enforce this boundary.
- **Do NOT** read or parse `### FE-XX:` / `### BE-XX:` scenario blocks. Perun's sanitization rules (see `src/agents/perun.md` Workflow 1, Step 3) must run before any scenario content reaches a specialist.
- **Do NOT** write to `.tmp-fe-findings.md` / `.tmp-be-findings.md` or any intermediate findings file. Perun accumulates results in-memory across waves and writes a single report at the end.
- **Do NOT** invoke `zmora-fe` / `zmora-be` directly. Direct variant invocation is an escape hatch for ad-hoc checks (see `docs/plugins/qa.md`), not the `/run-qa` path.
- **Do NOT** synthesize, format, or post-process Perun's output. Perun displays the summary directly to the user.

---

## Why This Handoff Shape

- **Per-scenario dispatch** — Perun dispatches one task per `### FE-XX:` / `### BE-XX:` scenario block (not one task per stack). This gives the 4-wide worker pool maximum parallelism and lets a single failing scenario fail in isolation instead of blocking a whole stack's run.
- **Variant routing belongs to Perun** — the QA plugin registers two physical agents (`zmora-fe`, `zmora-be`) so the OpenCode runtime's `allowed-tools` allowlist enforces stack boundaries. Perun routes by scenario prefix; the user only ever sees the logical `zmora` name. Centralizing routing in Perun also means defense in depth: if routing has a bug, the wrong variant lacks the requested tool and the scenario fails safely as SKIP rather than silently crossing stacks.
- **Dependency graph belongs to Perun** — `**Depends-on:**` semantics, cycle detection, and topological-wave computation live in one place. The slash command stays a thin handoff and cannot drift out of sync with the coordinator's contract.
- **Single source of truth** — every detail of the QA-run pipeline lives in `src/agents/perun.md` (Workflow 1) and `docs/plugins/qa.md`. Keeping this template a thin handoff avoids template/coordinator drift.

---

## See Also

- `src/agents/perun.md` — Perun coordinator spec, including Workflow 1 (QA Run) and the dispatch contract.
- `docs/plugins/qa.md` — QA plugin architecture, variant-split rationale, `**Depends-on:**` semantics, plan/report formats.
- `docs/plugins/coordinator.md` — `dispatch_parallel` runtime characteristics (4-wide pool, 50-task cap, 5-minute per-task timeout).
- `src/modules/qa/index.ts` — `AppVerkQAPlugin` registers the `zmora-fe` / `zmora-be` variants exposed to Perun.
- `src/modules/coordinator/dispatch.ts` — `dispatch_parallel` implementation used by Perun.
