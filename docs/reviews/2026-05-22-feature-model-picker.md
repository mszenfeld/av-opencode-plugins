# Code Review — `feature/model-picker`

**Branch:** `feature/model-picker` (27 commits ahead of `master`; 179 files; +13,899 / −2,281 LOC)
**Scope:** New `src/modules/pantheon-config/` module, per-agent model injection in Perun + Zmora, `qa-tester` → `zmora` BREAKING rename, harness-first README rewrite, new `docs/configuring-agents.md`.
**Tooling:** `npm test` 412/412 PASS · `npx tsc --noEmit` clean · `npm audit` 0 vulns · trufflehog 0 real secrets · semgrep 0 true positives.

---

## Composite Findings (Cross-Domain)

### [HIGH] COMP-001: Pantheon error-surfacing pipeline broken end-to-end
**Status:** ✅ Fixed (2026-05-22)

**ID:** COMP-001
**Location:** Cluster — `src/modules/pantheon-config/loader.ts:54`, `src/modules/pantheon-config/index.ts:19-24`, `src/modules/coordinator/index.ts:248-272`, `src/modules/pantheon-config/schema.ts:38-42`, `docs/configuring-agents.md:100, 117-118`
**Category:** Architecture
**Effort:** medium (single coordinated patch)

**Problem:**
A single malformed or hostile `pantheon.json` (deeply nested JSON, oversized file, unknown top-level section, syntax error) hits five defects simultaneously, none of which is severe alone but together they produce a fully blind failure mode:

1. `jsoncParser.parse` (loader.ts:54) is NOT wrapped in try/catch — a `RangeError` on deeply nested input propagates through `ensureLoaded()` and crashes the plugin's `config` and `event` hooks.
2. `getLoadErrors()` runs **outside** the try block at coordinator/index.ts:251, so any throw from `ensureLoaded()` exits the event handler before the toast is attempted.
3. `toastShown = true` flips **before** `await client.tui.showToast` (line 249), so if the toast call fails transiently the user is never re-notified for the rest of the session.
4. The toast message tells the user to *"check console for details"*, but **no `console.*` writes exist anywhere in `pantheon-config` or `coordinator`** — `grep -rn 'console\.' src/modules/pantheon-config src/modules/coordinator/index.ts src/modules/qa/index.ts` returns zero matches. Documented in `docs/configuring-agents.md:100`.
5. `schema.ts:38-42` routes "unknown top-level section" to `errors[]`, which triggers the same warning toast. The FAQ at `docs/configuring-agents.md:117-118` claims unknown sections are *"ignored with a debug log; forward-compatible"* — contradicted by both code paths.

**Impact:**
For the very input class the diagnostic was built to surface, the user gets either nothing or a wild goose chase. Following the docs to add forward-looking sections produces an unexpected warning. The plugin can silently fall back to defaults with zero in-band indication.

**Remediation (single coordinated patch):**

```typescript
// 1. src/modules/pantheon-config/loader.ts (around line 53) — wrap parse
let parsed: unknown
const parseErrors: jsoncParser.ParseError[] = []
try {
  parsed = jsoncParser.parse(raw, parseErrors, { allowTrailingComma: true })
} catch (err) {
  errors.push(`[pantheon] ${filePath}: failed to parse — ${err instanceof Error ? err.message : String(err)}`)
  continue
}

// 2. src/modules/coordinator/index.ts — log errors AND fix the latch
event: async ({ event }) => {
  if (event.type !== "session.created") return
  if (toastShown) return
  try {
    const errors = getLoadErrors()              // moved INTO the try
    for (const e of errors) console.error(e)    // honour the docs contract
    if (errors.length > 0) {
      await client.tui.showToast({ body: {
        variant: "warning", title: "Pantheon",
        message: errors[0] ?? "pantheon.json parse error",
      }})
    } else if (pantheonConfigEmpty()) {
      await client.tui.showToast({ /* info */ })
    }
    toastShown = true                            // flip only on success
  } catch { toastShown = true }                  // give up after one attempt
}

// 3. src/modules/pantheon-config/schema.ts (line 38-42) — pick a side:
//    Option A (recommended, matches docs): silent-skip unknown sections.
//    Option B: keep as errors and rewrite the FAQ at docs/configuring-agents.md:117-118.

// 4. Behavioural tests around getLoadErrors() / pantheonConfigEmpty() covering:
//    deeply-nested JSON, oversized file (with statSync guard), unknown section.
```

---

### [MEDIUM] COMP-002: Untrusted string into TUI sink — doubled and undocumented
**Status:** ✅ Fixed (2026-05-22)

**ID:** COMP-002
**Location:** `src/modules/pantheon-config/schema.ts:18`, `src/modules/coordinator/index.ts:230-235`, `src/modules/qa/index.ts:57-61`
**Category:** Security
**OWASP:** A09:2025 (Logging & Alerting Failures)
**CWE:** CWE-117 (log injection)
**Effort:** trivial

**Problem:**
`MODEL_REGEX = /^[^/]+\/[^/]+$/` permits ESC (`\x1b`), U+202E (RLO), `\r\n`, and zero-width chars. The validated string then flows untouched into two `config.agent[...]!.model` sinks via non-null assertions. One sink (`coordinator/index.ts:235`) has a documented safety comment; the parallel sink at `qa/index.ts:60` does not — increasing the chance a future refactor patches one and misses the other. This is the same threat class already remediated for session-notification in commit `392b781` (CWE-117).

**Remediation:**
```typescript
// schema.ts:18 — tighten to printable-ASCII allow-list
const MODEL_REGEX = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

// qa/index.ts:60 — mirror coordinator's safety comment
// Inject model AFTER registration so we don't merge into every literal —
// the non-null assertion is safe because the loop above just set each key.
```

---

### [MEDIUM] COMP-003: Silent breaking-change pathway on v0.3.0 upgrade
**Status:** ✅ Fixed (2026-05-22)

**ID:** COMP-003
**Location:** `README.md` (no upgrade section), `docs/configuring-agents.md` (no upgrade section), `AGENTS.md:197,204,210`, `docs/plugins/commit.md:12`
**Category:** Documentation
**Effort:** trivial

**Problem:**
The `qa-tester` → `zmora` rename is a hard rename with no shim. A user with `agent."qa-tester-fe".model` in their `opencode.json` loses that customization silently on upgrade — no toast, no schema warning, no console message (per COMP-001). The README and `docs/configuring-agents.md` have no upgrade notice. Install snippets in `AGENTS.md:197,204,210` still reference `v0.2.16` / `v0.2.8`. `docs/plugins/commit.md:12` references `v0.2.8`. The README does have `v0.3.0` (correct).

**Remediation:** Add "Upgrading from v0.2.x" section listing the registry-key rename (`qa-tester-fe`/`qa-tester-be` → `zmora-fe`/`zmora-be`) and the recommended migration to `pantheon.json`. Bump install snippets to `v0.3.0`.

---

## Individual Findings

### [MEDIUM] SEC-001: DoS via uncaught RangeError in `jsoncParser.parse` `[verified, downgraded from HIGH]`
**Status:** ✅ Fixed (2026-05-22)

**ID:** SEC-001
**Location:** `src/modules/pantheon-config/loader.ts:54`
**Category:** Security
**OWASP:** A06:2025 (Insecure Design), A10:2025 (Exceptional Conditions)
**CWE:** CWE-674 (Uncontrolled Recursion), CWE-755 (Improper Exception Handling)
**Effort:** trivial

**Problem:** `jsoncParser.parse` uses recursive descent. A JSON payload nested ≥5,000 levels (~10 KB) throws `RangeError: Maximum call stack size exceeded` rather than reporting a `ParseError`. The loader only wraps `readFileSync` in try/catch. Verified by inspecting `node_modules/jsonc-parser/lib/esm/impl/parser.js:513-598`.

**Impact:** Plugin `config` hook rejects → Perun and Zmora silently fail to register.

**Remediation:** See COMP-001 step 1.

**Severity rationale:** Challenger downgraded HIGH → MEDIUM. Threat model is narrow (requires hostile `.opencode/pantheon.json` to be present in cwd or an ancestor walked up to `$HOME`); failure mode is plugin degradation, not RCE/data leak.

---

### [MEDIUM] SEC-002: `MODEL_REGEX` accepts ANSI/BiDi/control characters `[verified]`
**Status:** ✅ Fixed (2026-05-22)

**ID:** SEC-002
**Location:** `src/modules/pantheon-config/schema.ts:18`
**Category:** Security
**OWASP:** A09:2025
**CWE:** CWE-117
**Effort:** trivial

See COMP-002 for full remediation.

---

### [MEDIUM] MAINT-001: Toast tells user to "check console for details" — no console writes exist `[verified, downgraded from HIGH]`
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-001
**Location:** `src/modules/coordinator/index.ts:251-260`
**Category:** Maintainability
**Effort:** trivial

See COMP-001 step 2.

---

### [MEDIUM] ARCH-001: Asset-loader pattern duplicated across 3 modules
**Status:** ✅ Fixed (2026-05-22)

**ID:** ARCH-001
**Location:** `src/modules/coordinator/index.ts:30-49`, `src/modules/qa/index.ts:11-22`, `src/modules/qa/prompt-builder.ts:6-19`
**Category:** Architecture (DRY)
**Effort:** easy

**Problem:** The `import.meta.url → moduleDir → readFileSync("../../X")` resolver and its 4-line explanatory comment are duplicated three times. Any change to the asset-emit layout requires three coordinated edits.

**Remediation:** Extract `src/modules/_shared/load-asset.ts` exporting `loadModuleAsset(callerUrl, relativePath)`.

---

### [MEDIUM] MAINT-002: Non-null assertion in `qa/index.ts:60` lacks the safety comment that `coordinator/index.ts:230-235` carries
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-002
**Location:** `src/modules/qa/index.ts:57-61`
**Category:** Maintainability
**Effort:** trivial

**Problem:** Both modules assert `config.agent[X]!.model = ...`. Coordinator has an inline comment explaining the safety invariant; the qa variant doesn't. A future refactor of the registration loop could silently break the invariant.

**Remediation:** Either copy the comment, or thread `model` into the literal via spread to remove the assertion.

---

### [MEDIUM] MAINT-003: `pantheonConfigEmpty()` test only asserts return type, not behavior
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-003
**Location:** `tests/modules/pantheon-config/loader.test.ts:157-162`
**Category:** Maintainability (Test design)
**Effort:** easy

**Problem:** Test reads `expect(typeof pantheonConfigEmpty()).toBe("boolean")` — a regression that always returned `true` or `false` would pass. Behavioral coverage comes incidentally from `tests/modules/coordinator/notify-on-empty-config.test.ts` (which sets `process.env.HOME` to a tmpdir).

**Remediation:** Replicate the HOME-isolation pattern from `notify-on-empty-config.test.ts` and assert `=== true` (empty) / `=== false` (populated).

---

### [MEDIUM] DOC-001: Breaking rename `qa-tester` → `zmora` not called out for upgrading users
**Status:** ✅ Fixed (2026-05-22)

**ID:** DOC-001
**Location:** `README.md`, `docs/configuring-agents.md`
**Category:** Documentation
**Effort:** trivial

See COMP-003.

---

### [MEDIUM] DOC-002: FAQ misrepresents unknown-section behavior
**Status:** ✅ Fixed (2026-05-22)

**ID:** DOC-002
**Location:** `docs/configuring-agents.md:117-118`
**Category:** Documentation
**Effort:** trivial

See COMP-001 step 3.

---

### [LOW] SEC-003: `toastShown = true` set before `await` `[verified]`
**Status:** ✅ Fixed (2026-05-22)

**ID:** SEC-003
**Location:** `src/modules/coordinator/index.ts:248-249`
**Category:** Security
**CWE:** CWE-755
**Effort:** trivial

See COMP-001 step 2.

---

### [LOW] SEC-004: `getLoadErrors()` called outside try/catch `[verified, subsumed by COMP-001]`
**Status:** ✅ Fixed (2026-05-22)

**ID:** SEC-004
**Location:** `src/modules/coordinator/index.ts:251`
**Category:** Security
**CWE:** CWE-755
**Effort:** trivial

See COMP-001 step 2.

---

### [LOW] SEC-005: No size cap on `readFileSync` `[verified]`
**Status:** ✅ Fixed (2026-05-22)

**ID:** SEC-005
**Location:** `src/modules/pantheon-config/loader.ts:41-45`
**Category:** Security
**CWE:** CWE-400
**Effort:** trivial

**Remediation:** Stat first; skip files > 64 KiB (or whatever cap suits the schema growth path):

```typescript
let size: number
try { size = statSync(filePath).size } catch { continue }
if (size > MAX_PANTHEON_BYTES) {
  errors.push(`[pantheon] ${filePath}: exceeds ${MAX_PANTHEON_BYTES} byte cap — ignoring`)
  continue
}
```

---

### [LOW] MAINT-004: Parse-error message shows byte offset instead of `line:col`
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-004
**Location:** `src/modules/pantheon-config/loader.ts:57-58`
**Category:** Maintainability
**Effort:** trivial

**Problem:** `printParseErrorCode(e.error)}@${e.offset}` → `"CommaExpected@142"`. Useless without a goto-byte editor.

**Remediation:** Compute `line:col` from the same `raw` string in scope.

---

### [LOW] MAINT-005: `out` vs `result` naming inconsistency
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-005
**Location:** `src/modules/pantheon-config/schema.ts:29`
**Category:** Maintainability
**Effort:** trivial

**Problem:** `validateConfigFile` uses `out`; sibling `loadFresh` uses `result`. Trivial readability friction.

---

### [LOW] MAINT-006: Stale test-path comment in back-compat re-export
**Status:** ✅ Fixed (2026-05-22)

**ID:** MAINT-006
**Location:** `src/modules/coordinator/index.ts:24-27`
**Category:** Maintainability
**Effort:** trivial

**Problem:** Comment cites `tests/to-poller-message.test.ts`; actual path is now `tests/modules/coordinator/to-poller-message.test.ts`.

---

### [LOW] DOC-003: AGENTS.md install examples reference stale `v0.2.16` / `v0.2.8`
**Status:** ✅ Fixed (2026-05-22)

**ID:** DOC-003
**Location:** `AGENTS.md:197,204,210`
**Category:** Documentation
**Effort:** trivial

See COMP-003.

---

### [LOW] DOC-004: Legacy `docs/plugins/commit.md:12` install snippet pins `v0.2.8`
**Status:** ✅ Fixed (2026-05-22)

**ID:** DOC-004
**Location:** `docs/plugins/commit.md:12`
**Category:** Documentation
**Effort:** trivial

See COMP-003. Legacy tree per AGENTS.md, but still discoverable.

---

## What's Good

- **Architecture of `pantheon-config/`** — clean 4-file SRP layering (schema/paths/loader/index). 100% TS strict, no `any`/`as` except guarded narrowings.
- **Documented design decisions everywhere** — every non-obvious choice (`bundle:false`, why register before inject, first-session-wins, why module-scope cache, `__resetCacheForTests` escape hatch) has an inline justification. Rare and good.
- **Prototype pollution verified safe** — `jsonc-parser@3.3.1` silently strips `__proto__` keys (`Object.keys(parsed.agents)` = `['perun']`, not `['__proto__', 'perun']`). Validated by direct experiment.
- **ReDoS verified safe** — `MODEL_REGEX` has no nested quantifiers; 500k-char input parses in <4 ms.
- **Symlink walk-up bounded** — `path.dirname` is pure string math; terminates at `$HOME` or `/`.
- **Sanitize rename correct** — `\bzmora-(?:fe|be)\b` word-boundary anchoring preserves the no-bypass invariant. Tests cover edge cases.
- **`qa-tester` rename complete** — only literal `qa-tester` reference in src/tests is the `REMOVED_AGENTS` regression-guard list at `tests/modules/qa/plugin.test.ts:19`. Correct usage.
- **`jsonc-parser@3.3.1`** — latest 3.x, Microsoft-maintained (also used by VS Code), no CVEs in npm advisory DB.

---

## Verification Summary

**Method:** Cross-domain correlation + adversarial challenger.

| Metric | Count |
|--------|-------|
| Findings verified | 16 |
| False positives removed | 0 |
| Severity adjustments | 2 (HIGH → MEDIUM by Challenger on SEC-001 and MAINT-001) |
| Cross-analysis composite findings | 3 (COMP-001 HIGH, COMP-002 MEDIUM, COMP-003 MEDIUM) |

### Cross-Analysis (Security ↔ Quality ↔ Documentation)

7 correlations identified — most notable: **CORRELATION-1** (SEC-001 + SEC-004 combine to bypass the only user-facing recovery path), **CORRELATION-2** (SEC-001 + MAINT-001 produce a fully blind failure mode for the same input), and **CORRELATION-4** (DOC-002 + MAINT-001 → user is misled 3× in a row). All three are captured in **COMP-001**.

### Challenged Findings

- **SEC-001** (DoS via RangeError) HIGH → **MEDIUM**: technically verified (V8 stack overflows recursive descent at ~5000 nest levels), but threat model is narrow (requires hostile file placed in walked-up tree); failure is plugin degradation, not RCE/data leak.
- **MAINT-001** (broken "console" contract) HIGH → **MEDIUM**: verified (`grep "console\."` returns zero matches; doc text matches exactly); but this is misleading guidance, not a broken feature — parsing still proceeds and the user has the file in hand.

| Severity | Count | IDs |
|----------|-------|-----|
| HIGH (composite) | 1 | COMP-001 |
| MEDIUM (composite) | 2 | COMP-002, COMP-003 |
| MEDIUM (individual) | 8 | SEC-001, SEC-002, MAINT-001, ARCH-001, MAINT-002, MAINT-003, DOC-001, DOC-002 |
| LOW | 8 | SEC-003, SEC-004, SEC-005, MAINT-004, MAINT-005, MAINT-006, DOC-003, DOC-004 |
| CRITICAL | 0 | — |

**Recommendation:** COMP-001 is a single-patch coordinated fix that simultaneously closes SEC-001, SEC-003, SEC-004, MAINT-001, and DOC-002. Tackle it first. COMP-002 is a 2-line fix (regex + comment). COMP-003 is doc-only.
