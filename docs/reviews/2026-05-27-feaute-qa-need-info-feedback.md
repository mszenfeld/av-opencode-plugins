# Feedback Analysis: PR #5 — "feat(qa): strict orchestrator + native bindings + NEED_INFO contract"

**Repository:** mszenfeld/av-opencode-plugins
**PR Author:** @mszenfeld
**URL:** https://github.com/mszenfeld/av-opencode-plugins/pull/5

---

## Feedback Issues — PR #5 (2026-05-27)

### [LOW] MAINT-001: Per-review issue ID `MAINT-002` embedded in source comment
**Status:** ✅ Fixed (2026-05-27)

**ID:** MAINT-001
**Location:** `src/modules/qa/record-input.ts:30`
**Category:** Maintainability
**Source:** [Copilot review comment](https://github.com/mszenfeld/av-opencode-plugins/pull/5#discussion_r3306376819)

**Problem:** The comment about the mid-run dialog-round cap carries the per-review label `(MAINT-002)`. `AGENTS.md` §"Code Review Artefacts" (lines 238–252) forbids embedding `/review`-generated issue IDs in source/test files — they are report-scoped and become noise once the report is archived.

**Impact:** Stale, context-free identifier in shipped source; violates the project's documented convention.

**Remediation:** Drop the `(MAINT-002)` label, keep the rationale about the dialog-round cap. Stable external refs (e.g. `CWE-…`) may stay.

---

### [LOW] MAINT-002: Per-review issue ID `PERF-001` embedded in test comment
**Status:** ✅ Fixed (2026-05-27)

**ID:** MAINT-002
**Location:** `tests/modules/qa/run-bash.test.ts:5` (and the `describe(...)` heading at line 50)
**Category:** Maintainability
**Source:** [Copilot review comment](https://github.com/mszenfeld/av-opencode-plugins/pull/5#discussion_r3306376922)

**Problem:** The regression test header and `describe` block embed `PERF-001`. Per `AGENTS.md`, per-review IDs must not appear in test files; the regression description and `CWE-404` reference are sufficient.

**Impact:** Report-scoped label leaks into the test suite; violates documented convention.

**Remediation:** Remove `PERF-001` from the leading comment and the `describe("makeRunBash — timeout enforcement (PERF-001)")` title; keep the timeout-regression description and `CWE-404`.

---

### [LOW] MAINT-003: Per-review issue ID `MAINT-002` embedded in test heading
**Status:** ✅ Fixed (2026-05-27)

**ID:** MAINT-003
**Location:** `tests/modules/qa/record-input.test.ts:71`
**Category:** Maintainability
**Source:** [Copilot review comment](https://github.com/mszenfeld/av-opencode-plugins/pull/5#discussion_r3306376956)

**Problem:** The `describe("record_input — dialog round cap (MAINT-002)")` heading embeds a per-review ID, which `AGENTS.md` forbids in test files.

**Impact:** Report-scoped label in the test suite; convention violation.

**Remediation:** Remove `(MAINT-002)` from the heading; keep the "dialog round cap" behavior description.

---

### [LOW] MAINT-004: Per-review issue ID `MAINT-004` embedded in test description
**Status:** ✅ Fixed (2026-05-27)

**ID:** MAINT-004
**Location:** `tests/modules/qa/execute-recipe.test.ts:107`
**Category:** Maintainability
**Source:** [Copilot review comment](https://github.com/mszenfeld/av-opencode-plugins/pull/5#discussion_r3306376997)

**Problem:** The test description "scrubs the full stderr before truncating … (MAINT-004)" embeds a per-review ID. `AGENTS.md` forbids these in test files.

**Impact:** Report-scoped label in the test suite; convention violation.

**Remediation:** Drop `(MAINT-004)`; keep the rationale about scrubbing before truncation so secrets at the tail boundary do not leak.

---

### [LOW] DOC-001: `getDispatchExtensions()` doc claims a stable object reference, but the registrar reassigns
**Status:** ✅ Fixed (2026-05-27)

**ID:** DOC-001
**Location:** `src/modules/_shared/dispatch-extensions.ts:130-133`
**Category:** Documentation
**Source:** [Copilot review comment](https://github.com/mszenfeld/av-opencode-plugins/pull/5#discussion_r3306377024)

**Problem:** The doc comment on `getDispatchExtensions()` states it "Returns the same object reference for the lifetime of the process," but `registerDispatchExtensions()` (line 126) executes `registered = { ...registered, ...extensions }`, replacing `registered` with a **new** object on every call. A caller that cached the earlier return value would observe a stale snapshot after any subsequent registration.

**Impact:** Misleading invariant; a consumer relying on reference stability (e.g. caching the bundle) silently misses later-registered extensions.

**Remediation:** Either (a) make `registered` a frozen stable object and mutate its fields in `registerDispatchExtensions`, or (b) correct the comment to say the reference is replaced on each `registerDispatchExtensions` call and callers must re-read.

---

### [LOW] SEC-001: Untrusted `filePath` and parse-error detail interpolated without neutralization
**Status:** ✅ Fixed (2026-05-27)

**ID:** SEC-001
**Location:** `src/modules/pantheon-config/loader.ts:133` (and `filePath` interpolations at lines 86, 107, 125)
**Category:** Security
**Source:** [Copilot review comment](https://github.com/mszenfeld/av-opencode-plugins/pull/5#discussion_r3306377042)

**Problem:** The read- and parse-exception paths neutralize their `detail` via `neutralizeUntrustedOutput` (lines 107, 125), but the `parseErrors`-derived `detail` pushed at line 133 is interpolated raw, and `filePath` is never neutralized in any of the error strings. Paths and parser text can carry control bytes on some platforms, so this is inconsistent with the established CWE-117 source-side hardening pattern used elsewhere in this file and in `schema.ts`.

**Impact:** Defense-in-depth gap (CWE-117 log/terminal injection) for an output surface — `getLoadErrors()` — that is explicitly exported and may reach sinks lacking their own neutralization.

**Remediation:** Run `neutralizeUntrustedOutput` on `filePath` and on the `parseErrors`-derived `detail` before pushing into `errors[]`, matching the sanitized `err.message` paths.

---

### [MEDIUM] MAINT-005: Core instructions accept `SETUP-*` IDs but Step 3 has no SETUP skill-loading branch
**Status:** ✅ Fixed (2026-05-27)

**ID:** MAINT-005
**Location:** `src/modules/qa/prompt-sections/core.md:7` (Step 3; gap relative to Step 2 at line 6)
**Category:** Maintainability
**Source:** [Copilot review comment](https://github.com/mszenfeld/av-opencode-plugins/pull/5#discussion_r3306377065)

**Problem:** Step 2 recognizes `^#{2,4}\s+(FE|BE|SETUP)-\d+`, so `SETUP-*` scenario IDs are accepted, but Step 3 only describes which `skill(...)` to load for FE/BE. There is no instruction for SETUP scenarios, so a dispatched agent may attempt `skill(...)` for a setup scenario that does not have one enabled.

**Impact:** Ambiguous agent behavior for `zmora-setup` scenarios — the executor may try to load a non-existent FE/BE skill instead of following the setup overlay.

**Remediation:** Add an explicit Step 3 branch: for `SETUP-*` scenarios, load no FE/BE skill and follow the setup overlay.

---

### [MEDIUM] PERF-001: Partial-redaction substring scan recomputes Shannon entropy — CPU/DoS hotspot
**Status:** ✅ Fixed (2026-05-27)

**ID:** PERF-001
**Location:** `src/modules/qa/scrubber.ts:50-54`
**Category:** Performance
**Source:** [Copilot review comment](https://github.com/mszenfeld/av-opencode-plugins/pull/5#discussion_r3306377086)

**Problem:** The partial-redaction path nests a descending-length loop over every substring of each secret value (`for len … for i …`) and calls `shannonEntropy(sub)` (itself O(len)) plus `out.includes(sub)` for each candidate. For secrets up to ~4 KB and multiple bindings, the worst case (no early match) approaches O(v²·len) entropy work, turning scrubbing into a CPU hotspot / DoS vector.

**Impact:** Large or numerous secret bindings can make dispatch-result scrubbing pathologically slow, blocking the wave and consuming CPU disproportionate to input size.

**Remediation:** Use a cheaper heuristic — e.g. precompute one high-entropy token/segment per secret, cache substring entropy, or cap the scan window / iteration count — so the scan cost is bounded independent of secret length.

---

### [LOW] MAINT-006: `nowMs` declared in `ExecuteRecipeDeps` but never used
**Status:** ✅ Fixed (2026-05-27)

**ID:** MAINT-006
**Location:** `src/modules/qa/execute-recipe.ts:19`
**Category:** Maintainability
**Source:** [Copilot review comment](https://github.com/mszenfeld/av-opencode-plugins/pull/5#discussion_r3306377119)

**Problem:** `ExecuteRecipeDeps` requires a `nowMs: () => number` field, but `makeExecuteRecipeHandler` never reads `deps.nowMs`. The dependency contract overstates what the implementation actually needs.

**Impact:** Dead interface surface — every caller must supply a clock that is never invoked, complicating wiring and tests for no benefit.

**Remediation:** Remove `nowMs` from `ExecuteRecipeDeps`, or use it consistently (e.g. for timestamping / deterministic testing) so the interface matches actual needs.
