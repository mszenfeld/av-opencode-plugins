# Code Review: `feature/improved-qa` vs `master`

**Date:** 2026-05-22
**Branch:** `feature/improved-qa`
**Scope:** ~148 files, 50 commits since master. Three substantive feature areas: Pantheon session-notification hook, QA unification + src/ migration, Coordinator absorption + worker-pool dispatch.

**Tooling:**
- `npm run typecheck` — clean
- `npm run test` — 335/335 pass
- `npm run lint` — 4 errors (all out-of-scope: `.worktrees/`, `packages/code-review/`, `packages/skill-registry/`)

**Overall:** Healthy. The new code is unusually well-tested, security-conscious (branded `AppleScriptLiteral`, comprehensive `neutralizeUntrustedOutput`, default-deny anti-recursion), and architecturally clean (hexagonal coordinator module). Findings cluster around the boundary between TS code and LLM prompt logic.

---

## Findings

### [HIGH] DOC-001: `/run-qa` command template still describes the deleted two-task architecture
**Status:** ✅ Fixed (2026-05-22)

**ID:** DOC-001
**Location:** `src/commands/run-qa.md:1-249` (and mirrored `dist/commands/run-qa.md`)
**Category:** Documentation
**Effort:** medium

**Problem:**
The `/run-qa` slash-command template (the prompt OpenCode hands to the model on `/run-qa`) still hardcodes the OLD architecture:
- Frontmatter `allowed-tools: task` (Step 5 uses the `task` tool directly)
- Step 5 calls `task(subagent_type: "qa-fe-tester", …)` and `task(subagent_type: "qa-be-tester", …)` — both agent names were deleted on this branch
- Writes to `.tmp-fe-findings.md` / `.tmp-be-findings.md` (architecture replaced by Perun-merged in-memory results)
- No mention of `dispatch_parallel`, per-scenario dispatch, `**Depends-on:**`, or topological waves

**Impact:** Typing `/run-qa` injects stale instructions. The model will attempt to call `task(subagent_type: "qa-fe-tester")`, which fails (agent doesn't exist). Even with self-correction, the entire 7-step workflow (per-stack split, tmp findings files) is wrong for per-scenario dispatch.

**Remediation:**
Rewrite `src/commands/run-qa.md` to delegate to `@perun` and remove all references to `qa-fe-tester` / `qa-be-tester` / `.tmp-*-findings.md`. Drop `task` from `allowed-tools`. Mention `**Depends-on:**` handling (or note that Perun owns it). Regenerate `dist/commands/run-qa.md` via `npm run build:root`.

---

### [MEDIUM] MAINT-001: Variant-suffix normalisation is prompt-only — no code enforcement, no test
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-001
**Location:** `src/agents/perun.md:102, 243`
**Category:** Maintainability
**Effort:** trivial

**Problem:**
TS surface registers `qa-tester-fe` / `qa-tester-be`. These real names flow into `DispatchResult.name`, error messages, and scenario refs. The rule to strip `qa-tester-{fe,be}` → `qa-tester` in user-facing strings lives **only** inside the Perun prompt — no TS helper, no test asserts a sanitised report.

**Impact:** Defense-in-depth gap. Model drift or partial prompt-injection success leaks variant suffix into user-visible reports — contradicting `docs/plugins/qa.md` which promises `qa-tester` is the only public name.

**Remediation:**
```ts
// src/modules/coordinator/sanitize.ts
const VARIANT_SUFFIX_PATTERN = /\bqa-tester-(fe|be)\b/g;
export function normalizeVariantSuffix(s: string): string {
  return s.replace(VARIANT_SUFFIX_PATTERN, "qa-tester");
}
```
Call from `dispatchParallel` over `DispatchResult.name` / `.error`. Convert a prompt invariant into a code invariant.

---

### [MEDIUM] MAINT-002: Dependency-aware wave dispatch has no TS implementation and no test
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-002
**Location:** `src/agents/perun.md:54-95`
**Category:** Maintainability / Architecture
**Effort:** medium

**Problem:**
Steps 5d–5g (parse `**Depends-on:**`, Kahn's algorithm cycle detection, topological wave assignment) run only inside the LLM. `tests/modules/coordinator/perun-qa-flow.test.ts:498-507` explicitly acknowledges this as "Path B" — but every other coordinator concern of comparable complexity (anti-recursion, byte-truncation, ANSI scrubbing, abort propagation) has been pulled into pure TS with unit tests.

**Impact:** Cycle/wave correctness is unreliable on plans with deep dependencies — and not regression-testable when a user reports "Perun dispatched B before A".

**Remediation:**
Extract `computeWaves()` as a pure helper next to `assignIssueIds`, expose as a `compute_waves` tool, and update Perun to call it:
```ts
// src/modules/coordinator/compute-waves.ts
export interface Scenario { id: string; dependsOn: string[]; sourceOrder: number }
export interface ComputeWavesResult {
  waves: string[][]
  error?: { kind: "self-ref" | "dangling" | "cycle"; details: string }
}
export function computeWaves(scenarios: Scenario[]): ComputeWavesResult { ... }
```

---

### [MEDIUM] ARCH-001: `mergeHook` generic path silently assumes void-return for all non-tool hooks
**Status:** ✅ Fixed (2026-05-22)

**ID:** ARCH-001
**Location:** `src/index.ts:78-100`
**Category:** Architecture
**Effort:** trivial

**Problem:**
The generic merger composes hooks as `async (...args) => { for (const h of hooks) await h(...args) }`. Works for current OpenCode hooks (all `(input, output) => Promise<void>`), but `tool.execute.before/after` are special-cased — implying the author knew the shape isn't uniform. A future hook that returns a value will silently lose all returns but the last.

**Remediation:**
Compile-time void-return assertion:
```ts
type AssertVoidReturn<K extends HookKey> =
  ReturnType<NonNullable<PluginHooks[K]>> extends Promise<void> ? true : never;
type _Check = { [K in HookKey]: AssertVoidReturn<K> }; // breaks if any hook returns value
```

---

### [MEDIUM] PERF-001: `pollUntilIdle.maxBytes` does not bound full-transcript memory
**Status:** ✅ Fixed (2026-05-22)

**ID:** PERF-001
**Location:** `src/modules/coordinator/poller.ts:20-29, 75-89`
**Category:** Performance / Maintainability
**Effort:** easy

**Problem:**
`maxBytes` truncates only `messages[last].content`. The full `messages[]` array (allocated by the SDK on every poll) is unbounded. With `pollIntervalMs = 1000` and a 5-minute timeout, that's ~300 full-transcript allocations per task. The option name overstates the guarantee.

**Remediation:**
Project to `[last]` inside `sdk-specialist.ts:48-52` so the poller never holds the full transcript — or rename `maxBytes` → `resultMaxBytes` and update docs.

---

### [MEDIUM] MAINT-003: Worker-pool drain-on-abort mixes two concerns; test name overstates guarantee
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-003
**Location:** `src/modules/coordinator/dispatch.ts:105-133`
**Category:** Maintainability
**Effort:** trivial

**Problem:**
One `worker()` function handles both "drain the queue" and "fill aborted entries for never-started indices". The invariant that only the first worker to detect abort does the drain is implicit. Also, `tests/modules/coordinator/dispatch.test.ts:573` ("fires all startTask calls before any fetchMessages") only holds for `tasks.length ≤ DISPATCH_CONCURRENCY` — overstated guarantee.

**Remediation:** Extract `fillUnstartedAsAborted()` helper. Rename the test to `"each worker calls startTask before fetchMessages (per-worker ordering)"`.

---

### [MEDIUM] DOC-002: `docs/plugins/coordinator.md` Project Structure omits `src/agents/` ownership
**Status:** ✅ Fixed (2026-05-22)

**ID:** DOC-002
**Location:** `docs/plugins/coordinator.md:227-241`
**Category:** Documentation
**Effort:** trivial

**Problem:** The Project Structure block lists `src/modules/coordinator/` and `tests/modules/coordinator/` but doesn't explain that `src/agents/perun.md` (where wave dispatch logic actually lives) is part of the coordinator's surface. A reader auditing dispatch correctness misses where the prompt-implemented control flow is.

**Remediation:** Add `src/agents/perun.md` to the tree with an annotation, e.g. "contains LLM-implemented control flow: wave dispatch, dependency parsing — see Limitations." Pairs with MAINT-002.

---

### [LOW] SEC-001: Terminal log injection via warning paths in env-config
**Status:** ✅ Fixed (2026-05-22)

**ID:** SEC-001
**Location:** `src/hooks/session-notification/env-config.ts:36-39, 47-49`
**Category:** Security
**CWE:** CWE-117 · **OWASP:** A09:2025
**Effort:** trivial

**Problem:** `AV_PANTHEON_NOTIFY_DELAY_MS` / `AV_PANTHEON_NOTIFY_SOUND` warning paths interpolate raw env-var content into `console.warn` without neutralisation. Self-inflicted only (developer-controlled env), but inconsistent with the rest of the plugin's careful sink-specific neutralisation.

**Remediation:** Route both warnings through a small `safeForLog()` helper that strips C0/C1 controls and BiDi overrides.

---

### [LOW] MAINT-004: `SessionTracker.markAsSubagent` / `isSubagent` are dead code
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-004
**Location:** `src/hooks/session-notification/session-tracker.ts:14-33, 46-48`
**Category:** Maintainability
**Effort:** trivial

**Problem:** Both methods are `@experimental` v2 placeholders called only by their own tests. Locking behaviour the v2 design hasn't committed to.

**Remediation:** Delete both + their tests; restore when v2 lands with its actual API shape.

---

### [LOW] MAINT-005: `dispatch_parallel` tool description duplicates conventions also in `perun.md`
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-005
**Location:** `src/modules/coordinator/index.ts:67-86` and `src/agents/perun.md:231-247`
**Category:** Maintainability
**Effort:** trivial

**Problem:** Two sources of truth for the `agent` / `summary` conventions (×N notation, ≤60/≤80 caps, etc.). Drift = silent model-behaviour degradation.

**Remediation:** The Zod schema is reachable at runtime — make it canonical. Replace the perun.md block with a one-liner: "Follow the `agent` / `summary` conventions in `dispatch_parallel`'s tool description."

---

### [LOW] MAINT-006: `dispatch.test.ts` concurrency-cap test lacks positive parallelism assertion
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-006
**Location:** `tests/modules/coordinator/dispatch.test.ts:456-479`
**Category:** Maintainability / Test quality
**Effort:** trivial

**Problem:** Asserts `peak ≤ 4`, would still pass with `DISPATCH_CONCURRENCY = 1`. A refactor that serialises the pool wouldn't trip the test.

**Remediation:** Add `expect(inFlight.peak).toBe(4)` (or `.toBeGreaterThanOrEqual(2)`) so degraded-to-sequential pools fail.

---

### [LOW] DOC-003: Coordinator security-model table has stale `src/` paths
**Status:** ✅ Fixed (2026-05-22)

**ID:** DOC-003
**Location:** `docs/plugins/coordinator.md:193-194`
**Category:** Documentation
**Effort:** trivial

**Problem:** Two rows say `src/dispatch.ts` and `src/dispatch.ts + src/poller.ts` instead of `src/modules/coordinator/...`. Adjacent rows in the same table use the correct path — clearly a missed update.

**Remediation:** Fix the two paths.

---

### [LOW] DOC-004: README doesn't mention variant agent names that surface in `/agents`
**Status:** ✅ Fixed (2026-05-22)

**ID:** DOC-004
**Location:** `README.md:259`
**Category:** Documentation
**Effort:** trivial

**Problem:** README has one row for `@qa-tester` but `/agents` will list `qa-tester-fe` and `qa-tester-be`. `docs/plugins/qa.md` covers it but a README-only reader hits a dead end.

**Remediation:** Add a parenthetical: "registered as variants `qa-tester-fe` and `qa-tester-be` — see qa.md".

---

### [LOW] DOC-005: AGENTS.md "Published files" hardcodes count "six remaining packages"
**Status:** ✅ Fixed (2026-05-22)

**ID:** DOC-005
**Location:** `AGENTS.md:53`
**Category:** Documentation
**Effort:** trivial

**Problem:** Correct today (6 workspaces), but the bare number drifts on the next absorption.

**Remediation:** Drop the count: "the remaining `packages/*/dist/` directories — see root `package.json` `files` for the canonical list".

---

### [LOW] MAINT-007: `bash-policy.ts` doctrine should be visible at the call site
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-007
**Location:** `src/modules/commit/bash-policy.ts` (no file-level comment) and `docs/plugins/coordinator.md` security-model table
**Category:** Maintainability (from cross-verifier COMPOSITE-1)
**Effort:** trivial

**Problem:** `docs/plugins/commit.md:61-79` and `AGENTS.md:225` explicitly state that `classifyBashCommand` is a workflow rail, not a security boundary, and enumerate the by-design bypasses. But the file itself has no such comment, and the coordinator.md security-model table doesn't list bash-policy with a "rail, not boundary" annotation. A future maintainer (or auditor) is one regex away from "fixing" this as if it were a security control — and reintroducing a bypass through what they think is a hardening change.

**Remediation:** Top-of-file comment in `bash-policy.ts` mirroring `commit.md:61-79`, plus add a row (or explicit non-row note) to the coordinator security-model table marking the rail as LLM-requested defense-in-depth.

---

## Cross-Analysis (Security ↔ Quality ↔ Documentation)

**[COMPOSITE-A] qa-tester variant split is incoherently propagated.** Same architectural change (variant pair) has gaps in three independent surfaces: stale `/run-qa` template (`DOC-001` HIGH), prompt-only suffix normaliser (`MAINT-001` MEDIUM), README discovery gap (`DOC-004` LOW). Fix as one PR with a cross-reference checklist — rewrite `run-qa.md`, add `normalizeVariantSuffix()`, update README §259.

**[COMPOSITE-B] LLM-only control flow in coordinator is under-documented as a risk.** `MAINT-002` (no TS implementation for wave dispatch) + `DOC-002` (Project Structure doesn't surface `src/agents/perun.md` as an implementation file). Until the algorithm is moved to TS, the Limitations section should call out which controls are prompt-implemented.

**[COMPOSITE-C] Doctrine visibility for bash-policy.** Security auditor surfaced a "HIGH bash bypass" finding that was **removed** as by-design (challenger verdict, supported by explicit doctrine in `commit.md:61-79`). However, the absence of doctrine at the *call site* (no comment in `bash-policy.ts`, no row in the coordinator security-model table) is what made the bypass look like a defect. `MAINT-007` addresses this.

---

## Verification Summary

**Method:** Cross-domain correlation + adversarial review (Cross-Verifier + Challenger)

| Metric | Count |
|--------|-------|
| Findings verified | 15 |
| False positives removed | 3 |
| Severity adjustments | 4 |
| Cross-analysis composites | 3 |

### Challenged Findings

| Original | Verdict | Reasoning |
|---|---|---|
| `[HIGH]` bash-policy bypass (security) | **REMOVED** | `docs/plugins/commit.md:61-79` explicitly documents this as defense-in-depth, not a security boundary, and enumerates every bypass listed. Not a defect; surfaced as `MAINT-007` (LOW doctrine visibility) instead. |
| `[MEDIUM]` `classifyBashCommand` wrong abstraction (quality) | **DEDUPED** | Same root cause as the removed HIGH; doctrine already explicit. Folded into `MAINT-007`. |
| `[LOW]` `truncateBytes` mints TextDecoder per call | **REMOVED** | Sub-microsecond cost on cold path bounded by 50-task cap; below noise floor. |
| `[CRITICAL]` `/run-qa` stale template | **HIGH** | Workflow regression, not security. |
| `[HIGH]` Coordinator stale `src/` paths | **LOW** | Pure doc typo, grep-discoverable. |
| `[HIGH]` Variant-suffix normalisation prompt-only | **MEDIUM** | DiD gap accepted by project doctrine; user-visible impact is leaked suffix, not security boundary failure. |
| `[HIGH]` Wave dispatch prompt-only | **MEDIUM** | Documented as "Path B" in `perun-qa-flow.test.ts:498-507` with paper trail. |

---

## Strengths Worth Preserving

Notable code-quality strengths examined and intentionally not flagged:

1. **Anti-recursion default-deny in `dispatchParallel`** (`dispatch.ts:85-98`) — pre-flight rejects any non-`subagent` agent before any session spawns.
2. **End-to-end abort signal threading** — `ToolContext.abort` → `dispatchParallel.signal` → `pollUntilIdle` → `sleepOrAbort` (uses `addEventListener`, not polling).
3. **WeakMap-keyed registry cache with promise-deduping and failure-invalidation** (`sdk-specialist.ts:118-144`).
4. **Branded `AppleScriptLiteral` type** (`notification-sender.ts:27-58`) — forgetting to escape is a compile-time error.
5. **`neutralizeUntrustedOutput`** (`sanitize.ts:35-73`) — OSC stripped before CSI; 8-bit C1 introducers handled; BiDi + zero-width chars stripped; 27 tests covering attack shapes.
6. **`deriveReportPath`** (`sanitize.ts:94-114`) — basename → allowlist → date validation. Comprehensive negative tests.
7. **Test conventions adhered to throughout** — fakes-over-mocks, `vi.useFakeTimers()`, no sleeps, mirrored structure (`tests/modules/<x>/<file>.test.ts`).
8. **Duplicate-tool-name detection** in `mergeTools` (`src/index.ts:35-37`).

---

## Severity Tally

| CRITICAL | HIGH | MEDIUM | LOW |
|----------|------|--------|-----|
| — | 1 | 6 | 8 |

15 findings total. No CRITICAL. One HIGH (DOC-001: `/run-qa` runtime drift).
