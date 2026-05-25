# Code Review — branch `feaute/qa-need-info` vs `master`

**Date:** 2026-05-25
**Branch:** `feaute/qa-need-info` (vs `master`)
**Scope:** 188 files, +14029/−2295 LoC (TypeScript migration + Pantheon hardening + QA preflight/NEED_INFO feature)
**Auditors:** security-auditor + code-quality-auditor + documentation-auditor (parallel) → Cross-Verifier + Challenger (verification)
**Tests / typecheck:** `vitest` 446/446 PASS, `tsc --noEmit` clean, `shellcheck` clean, `npm audit` 0 vulnerabilities
**Verdict:** **1 CRITICAL blocker**, 0 HIGH, 7 MEDIUM, 9 LOW

---

## Verification Summary

**Method:** Cross-domain correlation (Cross-Verifier) + adversarial review (Challenger). PoC-verified where noted.

| Metric | Count |
|---|---|
| Findings (raw) | 21 |
| False positives removed | 1 (HIGH-2 sqlite — script correctly implements SQLAlchemy convention) |
| Severity downgrades | 3 (HIGH-001→MEDIUM, HIGH-1→LOW, DOC-001→MEDIUM) |
| Cross-analysis composites | 5 |
| Final findings | 17 |

### Cross-Analysis (Security ↔ Quality ↔ Documentation)

Most important correlations:
- **CRIT-001 + SEC-001 + DOC-002**: dist/ stale → security fix for curl doesn't ship. Patch lands in `src/`, OpenCode loads `dist/`. Bug surface and mitigation are in different realities.
- **SEC-001 + DOC-003**: curl injection threat model is undocumented — user doesn't know a third-party plan is hostile-source.
- **SEC-002 + DOC-004**: `Bash(echo:*)` in `allowed-tools.ts` enables secret value leak, while "never echo secrets" rule lives only in prompt failure-path.
- **MAINT-002 + MAINT-007**: `qa-preflight.sh` is both security-boundary and parser god-object — parser bug fixes and security bug fixes can interact.

### Challenged Findings

- ~~HIGH-2 sqlite three-slash~~ → **FALSE POSITIVE.** Script correctly implements SQLAlchemy convention (`sqlite:///foo.db` = relative, `sqlite:////foo.db` = absolute). Reviewer confused convention.
- **HIGH-001 → MEDIUM (SEC-001).** Curl arg injection PoC confirmed, but threat model is user-authored test plans in the same trust zone as source code. Sanitisation rule in `perun.md:43` already blocks raw bash in step blocks. Remaining fix `--` is defensive.
- **HIGH-1 → LOW (MAINT-005).** DSN `@` greedy bug real, but RFC 3986 requires percent-encoding `%40` in userinfo; libpq would reject raw `@` for user too.
- **DOC-001 → MEDIUM (DOC-001).** Doc indeed outdated ("lists only"), but `docs/plugins/` is legacy tree (AGENTS.md:152) scheduled for removal.

---

## Issues Found

### [CRITICAL] CRIT-001: dist/ desynchronised from src/ — feature does not ship

**Status:** ✅ Fixed (2026-05-25)

**ID:** CRIT-001
**Location:** `dist/agents/perun.md`, `dist/commands/create-qa-plan.md`, `dist/modules/qa/prompt-sections/{core,overlay-be,overlay-fe}.md`, `dist/modules/coordinator/index.js`, `dist/modules/pantheon-config/schema.js`
**Category:** Architecture / Build discipline
**OWASP:** A08:2025 — Software & Data Integrity Failures
**Effort:** trivial

**Problem:**
`package.json` line 6: `"main": "./dist/index.js"`. AGENTS.md:248 confirms *"OpenCode loads from `dist/`, not `src/`"*. `loadAgentPrompt()` in `src/modules/coordinator/index.ts:28-30` uses `loadModuleAsset(import.meta.url, "../../agents/${name}.md")` — at runtime resolves to `dist/agents/perun.md`. **Committed `dist/agents/perun.md` does not contain Step 3.5 preflight or NEED_INFO handling** (diff: +133 lines vs HEAD after rebuild).

PoC verification:
```
$ npm run build && git status --short | grep dist
 M dist/agents/perun.md
 M dist/commands/create-qa-plan.md
 M dist/modules/coordinator/index.js
 M dist/modules/pantheon-config/schema.js
 M dist/modules/qa/prompt-sections/core.md
 M dist/modules/qa/prompt-sections/overlay-be.md
 M dist/modules/qa/prompt-sections/overlay-fe.md
```

**Impact:**
Entire QA-preflight/NEED_INFO feature **is invisible at runtime** — Perun does not have `Bash(./scripts/qa-preflight.sh:*)` in allowed-tools, does not execute Step 3.5, does not recognize NEED_INFO payload. Also pantheon-config hardening (`MAX_SHOWN_LEN`, neutralizer in schema) does not ship. Every doc finding below (DOC-001…DOC-006) describes functionality that production lacks.

Pre-existing problem: commits 298277a, 4607901, a238053, ff51ae4, 89ac823, 3f46ae5, 168c99e, 204db31, 31a7267, a5897c0, d928ae8 modify only `src/` — none update `dist/`.

**Remediation:**
```bash
npm run build
git add dist/
git commit -m "build(dist): regenerate after preflight + NEED_INFO feature"
```

Structural mitigation: add `npm run verify-dist` to pre-commit hook (skill `commit:commit` already exists) or CI step blocking merge when `git status dist/` is not clean after `npm run build`.

---

### [MEDIUM] SEC-001: curl argument injection in `qa-preflight.sh:34` (downgraded from HIGH)

**Status:** ✅ Fixed (2026-05-25)

**ID:** SEC-001
**Location:** `scripts/qa-preflight.sh:34`
**Category:** Security
**OWASP:** A05:2025 — Injection
**CWE:** CWE-88 (Argument Injection)
**Effort:** trivial

**Problem:**
```bash
code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
```
Missing `--` before `"$url"`. If `$url` starts with `-`, curl parses it as a flag. PoC:
```
$ printf 'service\t-K/tmp/cfg\n' | ./scripts/qa-preflight.sh
MISSING service:-K/tmp/cfg (connection failure)
# curl: option -K/tmp/cfg: error encountered when reading a file
```
Curl interprets `-K` as "read config file" — attacker with test plan + file on path can exfiltrate or change curl behavior.

**Impact (post-challenger): MEDIUM.** Threat model is user-authored plan, the same trust zone as source code (plans live in `docs/testing/plans/` in user's repo). Attack requires: (a) hostile plan, (b) attacker-controlled file on local path. Sanitisation in `perun.md:43` already blocks raw bash in step blocks, but `## Setup` parsing flies past that filter.

**Remediation:**
```bash
-    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
+    case "$url" in
+        http://*|https://*) ;;
+        *) echo "MISSING service:$url (unsupported scheme — must be http:// or https://)"; return ;;
+    esac
+    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 -- "$url" 2>/dev/null || echo "000")
```
Regression test:
```ts
it("rejects service URLs that start with a dash (argument-injection guard)", async () => {
  const { stdout } = await runPreflight(`service\t-K/tmp/cfg\n`)
  expect(stdout).toMatch(/MISSING service:-K\/tmp\/cfg \(unsupported scheme/)
})
```

---

### [MEDIUM] SEC-002: `Bash(echo:*)` in Zmora allowed-tools can leak env value

**Status:** ✅ Fixed (2026-05-25)

**ID:** SEC-002
**Location:** `src/modules/qa/allowed-tools.ts:11`
**Category:** Security
**OWASP:** A09:2025 — Logging & Alerting Failures (sensitive-data leak to transcript)
**CWE:** CWE-532
**Effort:** easy

**Problem:**
`SHARED_TOOLS` grants Zmora `Bash(echo:*)`. Prompt overlay (`overlay-be.md:29`, `overlay-fe.md:29`) instructs "NEVER echo VALUE of env var" — but it's a *prompt-level* constraint. Hostile scenario with step `echo "credentials: $TEST_USER_PASSWORD"` passes the bash allowlist, the shell expands the value, the result enters the dispatch result → QA report in `docs/testing/reports/`.

**Impact:**
Secret pasted by user into shell `.env` and exported for the test leaks to the persisted report via a hostile-authored step.

**Remediation:**
```diff
-export const SHARED_TOOLS = [
-  "Read", "Write", "skill",
-  "Bash(mkdir:*)", "Bash(command:*)", "Bash(echo:*)",
-]
+export const SHARED_TOOLS = [
+  "Read", "Write", "skill",
+  "Bash(mkdir:*)", "Bash(command:*)",
+  // Bash(echo:*) intentionally removed — shell var-expansion can leak
+  // secret values. Use `Bash(printf:'OK\n')` for status reporting.
+  "Bash(printf:*)",
+]
```

---

### [MEDIUM] MAINT-001: `## Setup` SKILL.md missing normative rules (soft-cap, ordering)

**Status:** ✅ Fixed (2026-05-25)

**ID:** MAINT-001
**Location:** `src/skills/qa/test-plan-format/SKILL.md:38-51`
**Category:** Maintainability
**Effort:** trivial

**Problem:**
SKILL is the single source of truth for `/create-qa-plan`. It omits two rules enforced by Perun (`perun.md:57` and implicit by parser):
1. **Placement:** `## Setup` MUST come before `## FE Test Scenarios` (single-pass parser).
2. **Soft cap:** ≤50 prerequisites total (per `perun.md:57`).

**Remediation:** add after line 51:
```markdown
**Rules:**

- **Placement.** `## Setup` MUST appear after frontmatter and before `## FE Test Scenarios` / `## BE Test Scenarios`. The parser is single-pass.
- **Soft cap.** ≤50 total prerequisites (env vars + services + databases). Excess is rejected.
- **DSN scheme is required.** `postgresql://`, `mysql://`, `redis://`, `sqlite:///`. Schemeless forms are rejected.
- **Env var names.** Must match `^[A-Z_][A-Z0-9_]*$`.
- **Omit when unused.** Plan with no prerequisites can omit the entire `## Setup` section.
```

---

### [MEDIUM] MAINT-002: DSN test assertions `(OK|MISSING)` don't verify the parser

**Status:** ✅ Fixed (2026-05-25)

**ID:** MAINT-002
**Location:** `tests/scripts/qa-preflight.test.ts:87-105`
**Category:** Maintainability (test quality)
**Effort:** easy

**Problem:**
```ts
expect(stdout).toMatch(/(OK|MISSING) db:postgresql:\/\/user:pass@127\.0\.0\.1:5432\/mydb/)
```
The alternation allows the test to pass regardless of parser correctness. If `pg_isready` is available in CI/dev and Postgres is running, the test passes with `OK` — even when the parser garbles the host. The test does not verify its goal ("no false MISSING from parsing").

**Remediation:**
```ts
const lines = stdout.split("\n").filter(Boolean)
for (const line of lines) {
  const stripped = line.replace(/postgresql:\/\/user:pass@127\.0\.0\.1:5432\/mydb/g, "")
  expect(stripped).not.toMatch(/pass@/)
}
```

---

### [MEDIUM] MAINT-003: IPv6 DSN mis-parsed

**Status:** ✅ Fixed (2026-05-25)

**ID:** MAINT-003
**Location:** `scripts/qa-preflight.sh:59-65, 81-87, 103-109`
**Category:** Maintainability (correctness)
**Effort:** medium

**Problem:**
`host="${hostport%:*}"` + `port="${hostport#*:}"` doesn't handle IPv6 with format `[::1]:5432`:
```
hostport=[::1]:5432
${hostport%:*}=[::1]     # OK
${hostport#*:}=:1]:5432  # BUG (port should be 5432)
```

**Remediation:** minimum-risk option — reject IPv6 with helpful message:
```bash
local rest="${dsn#postgresql://}"; rest="${rest#postgres://}"
rest="${rest##*@}"
if [[ "$rest" == \[* ]]; then
    echo "MISSING db:$dsn (IPv6 DSNs not yet supported — use IPv4 or hostname)"
    return
fi
```
Document the limitation in SKILL.md.

---

### [MEDIUM] MAINT-004: Spec uses lowercase `need_info`, code uses uppercase `NEED_INFO`

**Status:** ✅ Fixed (2026-05-25)

**ID:** MAINT-004
**Location:** `docs/superpowers/specs/2026-05-25-qa-preflight-and-need-info-design.md` (~14 occurrences)
**Category:** Maintainability (documentation drift)
**Effort:** trivial

**Problem:**
Implementation uses `"NEED_INFO"` (uppercase) — `core.md:39`, `perun.md:155`. Spec drafted with `"need_info"`. Reviewer/contributor reads spec, writes code with lowercase, breaks the contract.

Per `AGENTS.md:216-225` specs under `docs/superpowers/specs/` are temporary — but as long as they exist, they're misleading.

**Remediation:**
```bash
sed -i '' 's/need_info/NEED_INFO/g' docs/superpowers/specs/2026-05-25-qa-preflight-and-need-info-design.md docs/superpowers/plans/2026-05-25-qa-preflight-and-need-info.md
```

---

### [MEDIUM] DOC-001: `docs/plugins/coordinator.md` allowed-tools list outdated (downgraded from HIGH)

**Status:** ✅ Fixed (2026-05-25)

**ID:** DOC-001
**Location:** `docs/plugins/coordinator.md:118-123`
**Category:** Documentation
**Effort:** trivial

**Problem:**
Doc claims `@perun`'s `allowed-tools` "lists only" `Bash(mkdir:*)` + `Bash(ls:*)`. Actually `src/agents/perun.md:5` also contains `Bash(./scripts/qa-preflight.sh:*)` and `compute_waves`. Registered Elements table (lines 110-114) also omits `compute_waves`.

Challenger downgraded from HIGH because `docs/plugins/` is a legacy tree (AGENTS.md:152) scheduled for removal.

**Remediation:**
- add `Bash(./scripts/qa-preflight.sh:*)` and `compute_waves` to the list
- OR add note "canonical reference: source frontmatter" and stop syncing the doc

---

### [MEDIUM] DOC-002: Missing user-facing documentation for QA preflight + NEED_INFO

**Status:** ✅ Fixed (2026-05-25)

**ID:** DOC-002
**Location:** `docs/plugins/qa.md` (no section), `README.md` (no mention)
**Category:** Documentation
**Effort:** medium

**Problem:**
Feature introduces substantial user-facing changes:
- new plan section `## Setup`
- preflight abort prompt
- mid-run NEED_INFO pause + resume flow
- rule "set env vars in launch shell, restart OpenCode"

None of this is in `docs/plugins/qa.md` or README.md. Only mentions — in agent prompt + temporary spec.

**Impact:**
User seeing preflight abort interprets it as a bug. The "restart OpenCode after env change" rule is non-obvious and undocumented.

**Remediation:** add "Setup and preflight" section to `docs/plugins/qa.md` covering all 4 points + link to `docs/testing/plans/example-with-setup.md`.

---

### [MEDIUM] DOC-003: "MUST NOT paste secrets" rule only in failure prompt

**Status:** ✅ Fixed (2026-05-25)

**ID:** DOC-003
**Location:** `docs/plugins/qa.md` (missing)
**Category:** Documentation (security guidance)
**Effort:** trivial

**Problem:**
Spec (Part G) requires: "No automatic credential-pasting flow." Implementation in `perun.md:300` ("Secret-handling rule") instructs the agent not to echo pasted secrets — but it only surfaces after a failure. A user reading docs before the first `/run-qa` has no chance to learn the rule.

**Remediation:** add "Credentials and secrets" section to `docs/plugins/qa.md` covering (a) env vars set in shell, (b) never in chat, (c) restart OpenCode after change, (d) transcript is persistent.

---

### [MEDIUM] DOC-004: `example-with-setup.md` diverges from `test-plan-format/SKILL.md`

**Status:** ✅ Fixed (2026-05-25)

**ID:** DOC-004
**Location:** `docs/testing/plans/example-with-setup.md:1-66`
**Category:** Documentation
**Effort:** easy

**Problem:**
SKILL specifies structure with sections `## Source`, `## Detected Tools`, scenarios with `- **Area:**`, `- **Method:**` etc. Example uses frontmatter (instead of `## Source`), omits `## Detected Tools`, scenarios have different field format.

Frontmatter form actually matches what Perun's `Step 2` parses — so **SKILL is wrong**, not the example. But both sides must be consistent.

**Remediation:** update SKILL.md so frontmatter is canonical (option A) — matching actual Perun parser.

---

### [LOW] MAINT-005: DSN parser `${rest#*@}` non-greedy (downgraded from HIGH)

**Status:** ✅ Fixed (2026-05-25)

**ID:** MAINT-005
**Location:** `scripts/qa-preflight.sh:55, 78, 100`
**Category:** Maintainability (correctness)
**Effort:** trivial

**Problem:** Verified PoC: `user:pa@ss@127.0.0.1:5432/db` after `${rest#*@}` → `ss@127.0.0.1:5432/mydb` (host garbled).
**Challenger downgrade:** Per RFC 3986 raw `@` in userinfo must be percent-encoded. Libpq and sqlalchemy reject raw `@` for the user too. Failure mode: false-MISSING (no security impact).

**Remediation:**
```diff
-rest="${rest#*@}"
+rest="${rest##*@}"  # greedy: strips up to and including LAST '@'
```
Add regression test (see MAINT-002).

---

### [LOW] SEC-003: sqlite:// file-existence oracle

**Status:** ✅ Fixed (2026-05-25)

**ID:** SEC-003
**Location:** `scripts/qa-preflight.sh:116-123`
**Category:** Security
**CWE:** CWE-200 (Information Disclosure)
**Effort:** easy

**Problem:**
```
$ printf 'db\tsqlite:////etc/passwd\n' | ./scripts/qa-preflight.sh
OK db:sqlite:////etc/passwd
```
DSN path has no allowlist — can enumerate existence of arbitrary world-readable files.

**Remediation:** restrict paths to project-relative, reject `..`:
```bash
sqlite:///*)
    local rel="${dsn#sqlite://}"
    case "$rel" in
        /*|*..*)
            echo "MISSING db:$dsn (sqlite path must be project-relative)"
            return ;;
    esac
    [ -r "$rel" ] && echo "OK db:$dsn" || echo "MISSING db:$dsn (file not readable)"
    ;;
```

---

### [LOW] SEC-004: `dispatch.ts` propagates `err.message` without sanitization

**Status:** ✅ Fixed (2026-05-25)

**ID:** SEC-004
**Location:** `src/modules/coordinator/dispatch.ts:264`
**Category:** Security (defense-in-depth)
**CWE:** CWE-117
**Effort:** trivial

**Problem:** Missing `neutralizeUntrustedOutput()` on `err.message` in catch handler. Current error sources are deterministic — not exploitable, but a defensive gap for future SDK errors changes.

**Remediation:**
```diff
-    error: err instanceof Error ? err.message : String(err),
+    error: neutralizeUntrustedOutput(err instanceof Error ? err.message : String(err)),
```

---

### [LOW] SEC-005: `loader.ts` interpolates raw `err.message` in error entries

**Status:** ✅ Fixed (2026-05-25)

**ID:** SEC-005
**Location:** `src/modules/pantheon-config/loader.ts:99, 114`
**Category:** Security (defense-in-depth)
**CWE:** CWE-117
**Effort:** trivial

**Problem:** Sink-side neutralizer already exists (`coordinator/index.ts:259`), but `getLoadErrors()` is exported — a future consumer can bypass the sink. Source-side sanitize would be consistent with schema.ts.

**Remediation:** wrap `${err.message}` in `neutralizeUntrustedOutput()` in both places.

---

### [LOW] SEC-006: `qa-preflight.sh` missing env var name validation

**Status:** ✅ Fixed (2026-05-25)

**ID:** SEC-006
**Location:** `scripts/qa-preflight.sh:19-28`
**Category:** Security (hardening)
**Effort:** trivial

**Problem:** Script accepts any string as a name. Perun pre-validates against `^[A-Z_][A-Z0-9_]*$` — script should defensively too.

**Remediation:**
```bash
probe_env() {
    local name="$1"
    case "$name" in
        ""|*[!A-Z0-9_]*|[!A-Z_]*)
            echo "MISSING env:$name (invalid env var name)"
            return ;;
    esac
    ...
}
```

---

### [LOW] MAINT-006: `Bash(./scripts/qa-preflight.sh:*)` is CWD-relative

**Status:** ✅ Fixed (2026-05-25)

**ID:** MAINT-006
**Location:** `src/agents/perun.md:5,72`; `tests/scripts/qa-preflight.test.ts:4`
**Category:** Maintainability (portability)
**Effort:** medium

**Problem:** Path `./scripts/...` resolves against shell CWD. Works only when OpenCode starts from project root. Test `SCRIPT = "scripts/qa-preflight.sh"` has the same problem.

**Remediation:** document "OpenCode must start from project root" OR use project-root-anchored path with resolver.

---

### [LOW] MAINT-007: Test uses `!` non-null assertion and `as` cast

**Status:** ✅ Fixed (2026-05-25)

**ID:** MAINT-007
**Location:** `tests/modules/coordinator/dispatch-payload-passthrough.test.ts:76`
**Category:** Maintainability (style)
**Effort:** trivial

**Problem:**
```ts
const parsed = JSON.parse(results[0]!.result) as { status: string; missing: string[] }
```
Two violations (project convention: no `!`, no `as`). Rest of the file uses `?.` correctly.

**Remediation:**
```ts
const firstResult = results[0]
if (firstResult === undefined) throw new Error("expected at least one result")
const parsed: { status: string; missing: string[] } = JSON.parse(firstResult.result)
```

---

### [LOW] MAINT-008: No test for `compute_waves` resume-prefilter contract

**Status:** ✅ Fixed (2026-05-25)

**ID:** MAINT-008
**Location:** missing; contract in `src/agents/perun.md:319`
**Category:** Maintainability (test coverage)
**Effort:** medium

**Problem:** Resume semantics requires pre-filtering `depends_on` (drop PASS-ed predecessors). No test in `tests/modules/coordinator/compute-waves.test.ts`.

**Remediation:** add test verifying (a) when `R` contains a scenario with depends_on outside `R`, `computeWaves` returns `dangling`; (b) after pre-filter returns correct waves.

---

### [LOW] DOC-005: AGENTS.md doesn't mention `scripts/qa-preflight.sh`

**Status:** ✅ Fixed (2026-05-25)

**ID:** DOC-005
**Location:** `AGENTS.md:5-23`
**Category:** Documentation
**Effort:** trivial

**Problem:** AGENTS.md lists `scripts/verify-dist-sync.mjs` and `scripts/copy-root-assets.mjs` — the new runtime shell script should be mentioned in the same convention.

**Remediation:** add brief description next to existing mentions.

---

### [LOW] DOC-006: README.md `/run-qa` description doesn't mention preflight/NEED_INFO

**Status:** ✅ Fixed (2026-05-25)

**ID:** DOC-006
**Location:** `README.md:44-48`
**Category:** Documentation
**Effort:** trivial

**Problem:** Command description doesn't signal that it can abort (preflight) or pause (mid-run NEED_INFO).

**Remediation:** add suffix: "Verifies env vars / services / databases declared in `## Setup` before dispatching; pauses with a resume prompt if a scenario reports `NEED_INFO`."

---

## What's working well (non-findings)

- **CWE-117 hardening** (sanitize.ts, schema.ts, session-notification) — comprehensive, well-tested (19 cases). ANSI/CSI/OSC (7-bit + 8-bit), C0/C1, BiDi overrides, zero-width chars, HTML-escape.
- **Anti-recursion guarantee** in `dispatch.ts:86-98`: pre-flight validation, default-deny for `mode: primary/all`.
- **Abort signal propagation**: `pollUntilIdle` + `sleepOrAbort` + `cleanupOnAbort` — clean end-to-end.
- **WeakMap registry cache** (`sdk-specialist.ts:125`) with 60s TTL, dedupe via Promise — exemplary.
- **`pantheon-config/loader.ts:14`** `MAX_PANTHEON_FILE_BYTES = 1 MiB` with stat-before-read guard.
- **Single-writer invariant in `fillUnstartedAsAborted`** — comment explains race-free.
- **NEED_INFO design**: spec correctly avoids `.env` auto-loading, names-not-values in payloads, generic acknowledgement of pasted secrets.
- **Test quality**: fakes-over-mocks, real-process spawn for bash, `noUncheckedIndexedAccess` honored via `?.`.
- **`compute_waves`** tool: explicit error kinds (self-ref/dangling/cycle), deterministic source-order tiebreak — clean contract.
- **`src/skills/qa/test-plan-format/SKILL.md`** ↔ `dist/skills/qa/test-plan-format/SKILL.md` — byte-identical.

---

## Priority Action List

**Block merge:**
1. **CRIT-001** — run `npm run build`, commit 7 `dist/` files. Without this the feature does not ship.

**Fix before release:**
2. **SEC-001** — add `--` + scheme allowlist to `curl` in preflight script.
3. **SEC-002** — remove `Bash(echo:*)` from `SHARED_TOOLS`, replace with `Bash(printf:*)`.
4. **MAINT-001** — add placement + soft-cap rules to SKILL.md.
5. **DOC-002, DOC-003** — add "Setup and preflight" + "Credentials and secrets" sections to `docs/plugins/qa.md`.

**Batch in follow-up PR:**
6-17. MAINT-002…MAINT-008 + SEC-003…SEC-006 + DOC-001/-004/-005/-006 — all trivial-to-medium effort.

**Structural fix:**
- Pre-commit hook or CI step enforcing `npm run verify-dist` before merge — so CRIT-001 doesn't happen again.
