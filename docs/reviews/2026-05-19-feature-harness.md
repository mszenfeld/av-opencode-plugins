# Code Review — Last 13 Commits on `feature/harness`

**Range:** `897718d..3d8ab34` · **Branch:** `feature/harness` · **Date:** 2026-05-19

**Scope:** Introduction of the Pantheon session-notification hook (macOS desktop banners on `session.idle`, `AskUserQuestion`, and permission events). +3196 / −5 lines across 32 files: 6 new source modules, 5 new test files, root wiring, build pipeline switch, design spec + plan, README + plugin guide.

**Tooling status:** `npm run lint` clean for changed files (4 pre-existing errors in unrelated paths); `tsc --noEmit` clean; root vitest 69/69 passing.

---

## Summary

| Severity | Count | Domains |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 4 | Test quality (2), Documentation (2) |
| MEDIUM | 5 | Architecture (1), Maintainability (2), Documentation (2) |
| LOW | 14 | Security (2), Architecture (3), Maintainability (3), Documentation (6) |
| Composite | 5 | Cross-domain patterns |

**Verdict:** **APPROVED FOR MERGE.** No critical or high-severity *security* defects. The four HIGH-severity findings are test-coverage gaps and spec drift — all non-blocking, all fixable in a single follow-up PR. The composite findings reveal one systemic pattern worth addressing post-merge: "silent rejection of bad/unsupported input."

---

## [HIGH] MAINT-001: `AV_PANTHEON_NOTIFY=0` test is a tautology — cannot fail

**Status:** ✅ Fixed (2026-05-19)

**ID:** MAINT-001
**Location:** `tests/root-plugin.test.ts:171-188`
**Category:** Maintainability (Test Quality)
**Effort:** trivial

**Problem:** The test sets `AV_PANTHEON_NOTIFY=0`, then guards both the call and the assertion with `if (typeof plugin.event === "function")`. Pantheon is the sole contributor of `event` in the merged plugin (confirmed by the preceding smoke test at lines 159-169), so:
- If the flag is honored → `plugin.event === undefined` → conditional skipped → vacuous pass.
- If the flag is *ignored* (regression) → handler runs synthetic event → wrapped try/catch returns `undefined` → `resolves.toBeUndefined()` passes anyway.

The test cannot distinguish "flag honored" from "flag ignored." The kill-switch is documented as the escape hatch for environments where shell-out is undesirable — a silent regression here ships shell-out behavior to opt-out users.

**Remediation:**
```ts
// tests/hooks/session-notification/plugin.test.ts
import { AppVerkPantheonPlugin } from "../../../src/hooks/session-notification/plugin.js"
it("returns {} when AV_PANTHEON_NOTIFY=0", async () => {
  const prev = process.env.AV_PANTHEON_NOTIFY
  process.env.AV_PANTHEON_NOTIFY = "0"
  try {
    expect(await AppVerkPantheonPlugin({} as never)).toEqual({})
  } finally {
    if (prev === undefined) delete process.env.AV_PANTHEON_NOTIFY
    else process.env.AV_PANTHEON_NOTIFY = prev
  }
})
```

---

## [HIGH] MAINT-002: Packaging test under-covers the hook tree

**Status:** ✅ Fixed (2026-05-19)

**ID:** MAINT-002
**Location:** `tests/root-plugin.test.ts:153-154`
**Category:** Maintainability (Test Quality)
**Effort:** trivial

**Problem:** The `arrayContaining` assertion lists only `src/hooks/session-notification/plugin.js` + `plugin.d.ts`. Five transitive modules (`env-config`, `idle-scheduler`, `notification-sender`, `session-notification`, `session-tracker`) — both `.js` and `.d.ts` — are unverified. With the new `cp -R .tmp-build/src/. src/` build step, a future regression that drops any one of them would publish a broken plugin that crashes on import — and this test would still pass.

**Remediation:** Extend the array with all 10 paths:
```ts
"src/hooks/session-notification/env-config.js",
"src/hooks/session-notification/env-config.d.ts",
"src/hooks/session-notification/idle-scheduler.js",
"src/hooks/session-notification/idle-scheduler.d.ts",
"src/hooks/session-notification/notification-sender.js",
"src/hooks/session-notification/notification-sender.d.ts",
"src/hooks/session-notification/session-notification.js",
"src/hooks/session-notification/session-notification.d.ts",
"src/hooks/session-notification/session-tracker.js",
"src/hooks/session-notification/session-tracker.d.ts",
```

---

## [HIGH] DOC-001: Spec §4.3 documents wrong `NotificationSender` public surface

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-001
**Location:** `docs/superpowers/specs/2026-05-19-session-notification-hook-design.md:196-207`
**Category:** Documentation
**Effort:** easy

**Problem:** Spec §4.3 declares the module as two free functions:
```ts
export async function sendMacOSNotification(ctx, args): Promise<void>
export async function playMacOSSound(ctx, soundPath): Promise<void>
```
Shipped code exports a `NotificationSender` class with `send()`/`playSound()` methods, plus `escapeAppleScriptText` and 4 type exports. A contributor using the spec to write tests or extensions would import names that do not exist.

**Remediation:** Rewrite §4.3 to match the shipped class shape. Add note that `NotificationSenderContext` is a structural subset of `PluginInput`, which explains the `as unknown as` cast in `plugin.ts:14`.

---

## [HIGH] DOC-002: Spec §4.4 `SessionNotificationConfig` fields marked optional, but required in code

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-002
**Location:** `docs/superpowers/specs/2026-05-19-session-notification-hook-design.md:225-238`
**Category:** Documentation
**Effort:** trivial

**Problem:** Spec marks all fields and the `config` parameter as `?:` (optional). Shipped `session-notification.ts:5-13,63-67` declares every field required and `config` non-optional. Defaults live in `env-config.ts` (`DEFAULT_SESSION_NOTIFICATION_CONFIG`), so callers always pass a fully-populated config. A reader following the spec verbatim gets a `tsc` error.

**Remediation:** Update §4.4 to remove `?:` everywhere and add: "Defaults live in `env-config.ts`; callers must pass a fully-populated config (typically the return value of `readConfigFromEnv(process.env)`)."

---

## [MEDIUM] ARCH-001: First-session-wins heuristic fragile + `markAsSubagent` is dead public API

**Status:** ✅ Fixed (2026-05-19)

**ID:** ARCH-001
**Location:** `src/hooks/session-notification/session-tracker.ts:5-19`, `src/hooks/session-notification/session-notification.ts:81-92`
**Category:** Architecture
**Effort:** medium (defer to v2 per spec)

**Problem:** The "first `session.created` becomes main" heuristic relies on the user's session always being created before any `dispatch_parallel` child. Two breakage scenarios: late/lazy plugin load, and process restart with an active subagent. `markAsSubagent` is exported and unit-tested but never wired into the orchestrator — making it dead code with a forward-compatibility justification only.

**Remediation:** Acceptable for MVP per spec §2. Add an inline `// TODO(pantheon-v2): wire parentSessionID detection through markAsSubagent` comment in `session-notification.ts` to keep the escape hatch from rotting. Consider reading `properties.parentSessionID` and calling `tracker.markAsSubagent(sessionId)` when present.

---

## [MEDIUM] MAINT-003: `parseInt` accepts garbage suffixes in `AV_PANTHEON_NOTIFY_DELAY_MS`

**Status:** ✅ Fixed (2026-05-19)

**ID:** MAINT-003
**Location:** `src/hooks/session-notification/env-config.ts:29`
**Category:** Maintainability (Robustness)
**Effort:** trivial

**Problem:** `Number.parseInt("1500ms", 10) === 1500` — the obvious shorthand silently succeeds with wrong semantics. Spec §6 promises a warning for invalid values; only fully non-numeric strings trigger it.

**Remediation:**
```ts
if (typeof env.AV_PANTHEON_NOTIFY_DELAY_MS === "string") {
  const raw = env.AV_PANTHEON_NOTIFY_DELAY_MS.trim()
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (Number.isFinite(parsed) && parsed >= 0) {
    config.idleConfirmationDelayMs = parsed
  } else {
    console.warn(`[pantheon/session-notification] invalid AV_PANTHEON_NOTIFY_DELAY_MS="${raw}"; using default`)
  }
}
```
Add tests for `"1500ms"`, `"1.5"`, `"0"`.

---

## [MEDIUM] MAINT-004: Warn-once test does not interleave `send` and `playSound`

**Status:** ✅ Fixed (2026-05-19)

**ID:** MAINT-004
**Location:** `tests/hooks/session-notification/notification-sender.test.ts:146-153`
**Category:** Maintainability (Test Quality)
**Effort:** trivial

**Problem:** The test calls `sender.send()` twice. The `warnedNoShell` flag is shared with `playSound`. A refactor that introduces two flags (`warnedForSend`, `warnedForSound`) would still pass — but `playSound` would re-emit. Anchor the shared-flag invariant.

**Remediation:** Add `await sender.playSound("/x"); await sender.send(...); await sender.playSound("/x")` after the existing two `send` calls and re-assert `warn.toHaveBeenCalledTimes(1)`.

---

## [MEDIUM] DOC-003: Spec §3.3 file layout omits `env-config.ts`

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-003
**Location:** `docs/superpowers/specs/2026-05-19-session-notification-hook-design.md:102-124,269`
**Category:** Documentation
**Effort:** trivial

**Problem:** §3.3 lists 5 source files; shipped code has 6 (`env-config.ts` extracted as a separate module per the impl plan, not back-ported to spec). §4.5 still says `readConfigFromEnv` lives in `plugin.ts`. User-facing docs are accurate; this is internal spec drift only — challenger downgraded from HIGH.

**Remediation:** Add `env-config.ts` row to §3.2/§3.3 tables; update §4.5 to import from `./env-config.js`.

---

## [MEDIUM] DOC-004: Spec §8.1 test inventory missing `env-config.test.ts`

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-004
**Location:** `docs/superpowers/specs/2026-05-19-session-notification-hook-design.md:376-382`
**Category:** Documentation
**Effort:** trivial

**Problem:** §8.1 lists 4 unit-test files; shipped suite has 5 (`env-config.test.ts`, 9 cases). Spec under-sells the actual test surface.

**Remediation:** Add the row and bump §8.4 totals.

---

## [LOW] SEC-001: Broad `files: ["src"]` whitelist + additive `cp -R` may leak stray files into tarball

**Status:** ✅ Fixed (2026-05-19)

**ID:** SEC-001
**Location:** `package.json:8,29`
**Category:** Security (Supply Chain) · **CWE:** CWE-532 · **OWASP:** A03:2025
**Effort:** easy

**Problem:** Commit `96a4baf` switched `files` from explicit paths to `"src"` directory glob, and `build:root` to `cp -R .tmp-build/src/. src/` (additive — does not delete stale files). Any stray file ever placed in `src/` (debug dump, `.env`, fixture) will persist across rebuilds and ship in the next `npm pack`. No live exposure today; operational hygiene risk only.

**Remediation (one of):**
1. Make `build:root` non-additive: `rm -rf src/hooks && tsc -p tsconfig.build.json && cp -R .tmp-build/src/. src/ && rm -rf .tmp-build`
2. Tighten `files`: `["src/index.js", "src/index.d.ts", "src/hooks/**/*.{js,d.ts}", ...]`
3. Add `.npmignore` for `*.test.ts`, `*.env`, `*.key`, `*.pem`

---

## [LOW] SEC-002: `escapeAppleScriptText` doesn't strip ASCII control / BiDi override chars

**Status:** ✅ Fixed (2026-05-19)

**ID:** SEC-002
**Location:** `src/hooks/session-notification/notification-sender.ts:22-25`
**Category:** Security (Defense-in-Depth) · **CWE:** CWE-150
**Effort:** trivial

**Problem:** Bun's `$` tagged-template auto-escapes shell metacharacters (verified — no command injection). The escape correctly handles `\` and `"`. NOT exploitable. However, ASCII control chars (NUL, CR, LF, BEL) and Unicode BiDi-override codepoints (U+202E etc.) are not stripped — these can spoof or truncate the notification banner if hostile model output reaches `osascript`. Defense-in-depth concern.

**Remediation:**
```ts
export function escapeAppleScriptText(input: string): string {
  const sanitized = input
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[‪-‮⁦-⁩]/g, "")
  return sanitized.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}
```

---

## [LOW] ARCH-002: `as unknown as NotificationSenderContext` double-cast (justified)

**Status:** ✅ Fixed (2026-05-19)

**ID:** ARCH-002
**Location:** `src/hooks/session-notification/plugin.ts:11-14`
**Category:** Architecture (Type Safety)

**Problem:** Initially flagged as MEDIUM for "single cast would compile." Challenger verified: `PluginInput.$` is Bun's `BunShell`/`BunShellPromise` with recursive `this`-returning methods (`quiet()`, `nothrow()`); structural compatibility with our minimal `ShellTag`/`ShellChain` likely *does* require the `unknown` intermediate. The double-cast is documented and pragmatic. Downgraded to LOW informational. If desired, extract a narrow `Pick<PluginInput, "$">` type to make the comment more accurate.

---

## [LOW] ARCH-003: `IdleScheduler` swallows all `onFire` rejections silently

**Status:** ✅ Fixed (2026-05-19)

**ID:** ARCH-003
**Location:** `src/hooks/session-notification/idle-scheduler.ts:13-18`
**Category:** Architecture (Observability)
**Effort:** trivial

**Problem:** `void Promise.resolve(this.onFire(sessionId)).catch(() => undefined)` correctly absorbs rejections to avoid unhandled-rejection noise — but emits no diagnostic. The orchestrator already uses `console.error("[pantheon/session-notification]", err)`; following the same convention here costs nothing.

**Remediation:** `.catch((err) => console.error("[pantheon/idle-scheduler] onFire rejected", err))`.

---

## [LOW] ARCH-004: `markAsSubagent` is unused public API (deferred per spec)

**Status:** ✅ Fixed (2026-05-19)

**ID:** ARCH-004
**Location:** `src/hooks/session-notification/session-tracker.ts:14-19`
**Category:** Architecture (YAGNI)

**Problem:** Public + tested but never called. Spec explicitly documents it as a v2 escape hatch — acceptable, but mark as `@internal` or add inline TODO so it doesn't rot.

---

## [LOW] MAINT-005: `AV_PANTHEON_NOTIFY_SOUND` only accepts `"1"` (documented)

**Status:** ✅ Fixed (2026-05-19)

**ID:** MAINT-005
**Location:** `src/hooks/session-notification/env-config.ts:38-40`
**Category:** Maintainability (UX)

**Problem:** `"true"`/`"yes"`/`"on"` silently ignored. Challenger verified the contract is documented in `docs/plugins/pantheon.md:39` ("Set to `1` to enable"). Downgraded to LOW. Optional improvement: accept the standard truthy set or warn on unrecognized non-empty values.

---

## [LOW] MAINT-006: `warnedNoShell` instance-flag lifetime not documented

**Status:** ✅ Fixed (2026-05-19)

**ID:** MAINT-006
**Location:** `src/hooks/session-notification/notification-sender.ts:29`
**Category:** Maintainability (Clarity)
**Effort:** trivial

**Remediation:** Add a one-line JSDoc: `/** Per-instance one-shot guard for the "ctx.$ unavailable" warning. */`

---

## [LOW] DOC-005: Spec §7 promises unsupported-platform warning that code does not emit

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-005
**Location:** `docs/superpowers/specs/2026-05-19-session-notification-hook-design.md:358-369`
**Category:** Documentation

**Problem:** Spec promises one-time warn when `which osascript` returns nothing; code silently no-ops. Test codifies silent behavior; user-facing `docs/plugins/pantheon.md:21` matches code ("no-op on other platforms"). Challenger downgraded from MEDIUM to LOW because user docs and code agree; only the internal spec drifts. Pick one direction: either delete the §7 "log once" promise, or implement a `warnedNoMacOS` flag.

---

## [LOW] DOC-006: README "Package" badge not bumped

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-006
**Location:** `README.md:3`
**Category:** Documentation

**Problem:** Badge still shows `package-9`. Pantheon is a 10th registered plugin (counting harness-resident hook) per `defaultPluginFactories` in `src/index.ts:18-28`. Tension: badge says "package" and Pantheon doesn't have its own `packages/` workspace. Either bump to 10 and document harness-resident plugins count, or clarify the rule in AGENTS.md.

---

## [LOW] DOC-007: AGENTS.md stale about harness-resident `src/hooks/` location

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-007
**Location:** `AGENTS.md` (Monorepo Layout table, Build & Packaging Details, Root Entrypoint Registration)
**Category:** Documentation

**Problem:** AGENTS.md still says "Published files: Only `src/index.js`, `src/index.d.ts`, and the nine `packages/*/dist/` directories" — factually wrong post-merge (`files: ["src", ...]` now ships the whole `src/` tree). Layout table has no row for `src/hooks/session-notification/`. Future contributors lack a template for the next harness-resident plugin.

**Remediation:** Add a `src/hooks/session-notification/` row to the layout table, fix the "Published files" claim, add a Root Entrypoint Registration example showing `./hooks/<name>/plugin.js` imports.

---

## [LOW] DOC-008: `docs/plugins/pantheon.md` requirements overstate the macOS guard

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-008
**Location:** `docs/plugins/pantheon.md:19-26`
**Category:** Documentation

**Problem:** Says "macOS only" but the code has no `process.platform === "darwin"` guard — macOS-only behavior relies on `which osascript`/`which terminal-notifier` failing on Linux/Windows. Either add the explicit guard in `plugin.ts` or soften the doc wording.

---

## [LOW] DOC-009: `docs/plugins/pantheon.md` missing "how the confirmation delay works"

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-009
**Location:** `docs/plugins/pantheon.md`
**Category:** Documentation

**Problem:** Users get no explanation that any tool call / message-part-delta cancels the idle timer — they'll wonder why some idle events don't produce banners. Add a "How the confirmation delay works" subsection after the three triggers.

---

## [LOW] DOC-010: `docs/plugins/pantheon.md` doesn't link the implementation plan

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-010
**Location:** `docs/plugins/pantheon.md:52`
**Category:** Documentation

**Problem:** Footer only links to the spec. The plan (`docs/superpowers/plans/2026-05-19-session-notification-hook.md`) is more accurate post-implementation; cross-link both.

---

## [LOW] DOC-011: README Pantheon table row doesn't flag macOS-only

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-011
**Location:** `README.md:247`
**Category:** Documentation

**Problem:** Description says "native macOS banners" but does not say *only* macOS — readers on Linux may assume cross-platform support. Tweak to: "Session-notification hook (macOS only) — …".

---

## [LOW] DOC-012: README "Repository Structure" omits `src/hooks/session-notification/`

**Status:** ✅ Fixed (2026-05-19)

**ID:** DOC-012
**Location:** `README.md:265-283`
**Category:** Documentation

**Problem:** Every other plugin has a source-path → docs-path pair in this section; Pantheon does not.

---

## Composite Findings (Cross-Verifier)

### [COMP-001] [HIGH] Non-idempotent `src/` ship surface with under-scoped packaging test

**Components:** SEC-001 + MAINT-002
**Combined risk:** No authoritative manifest of `src/` contents at either the build layer (additive `cp -R`) or verification layer (test asserts 2 of 7 shipped files). A single PR should fix both: clean step before `cp -R`, plus all 10 transitive paths asserted.

### [COMP-002] [HIGH] Sprint refactor landed without doc/dead-code sweep

**Components:** DOC-001, DOC-002, DOC-003, DOC-007, ARCH-004
**Combined risk:** Spec, AGENTS.md, and the unwired `markAsSubagent` all describe a pre-refactor state. A contributor reading the spec gets wrong API surface (free functions vs class), wrong field optionality, wrong file layout, and discovers an exported escape hatch that the spec implies must be wired. Single "doc sweep" PR with new PR-template checklist item: "any module-level refactor updates spec + AGENTS.md in the same PR."

### [COMP-003] [MEDIUM] Systemic "silent rejection of bad/unsupported input"

**Components:** DOC-005, MAINT-003, MAINT-005, ARCH-003
**Combined risk:** Five paths silently swallow input/state errors (parseInt suffix garbage, unrecognized SOUND values, missing osascript+terminal-notifier, async onFire rejection, send/playSound throws). Operator-side triage is impossible. Adopt a shared `warnOnce` convention across env parsing, sender, and scheduler.

### [COMP-004] [MEDIUM] Untrusted-input escape gap compounded by suppressed observability

**Components:** SEC-002 + DOC-005 + catch-swallow at `notification-sender.ts:51,63`
**Combined risk:** BiDi/control chars can spoof the notification banner; the swallow-everything error policy means an exploitation attempt leaves no audit trail. Tighten escape + warn-once on swallowed catches → 3 lines of code, restores spec contract.

### [COMP-005] [MEDIUM] Tautological kill-switch test on a security-relevant config flag

**Components:** MAINT-001 + latent security risk
**Combined risk:** `AV_PANTHEON_NOTIFY=0` is the documented escape hatch for operators who must not have shell-out side effects. A test that cannot detect a regression here is a regression-blindness gap on a security-relevant flag.

---

## Verification Summary

**Method:** Cross-domain correlation (Cross-Verifier) + adversarial review (Challenger)

| Metric | Count |
|---|---|
| Findings verified `[verified]` | 18 |
| Severity adjustments | 5 (4 down, 1 up via composite) |
| Composite findings added | 5 |
| False positives removed | 0 |

### Challenged Findings (adjustments)
- **MAINT-001 (test tautology):** CONFIRMED HIGH — challenger traced both failure modes and confirmed the test passes regardless of flag honor.
- **Spec §3.3 omits env-config:** HIGH → **MEDIUM** — internal-spec drift only; user docs accurate.
- **Double-cast in plugin.ts:** MEDIUM → **LOW** — Bun's `BunShell` recursive types likely require the `unknown` intermediate; cast is justified.
- **`AV_PANTHEON_NOTIFY_SOUND` truthy strictness:** MEDIUM → **LOW** — contract documented in user-facing docs.
- **Spec §7 unfired warning:** MEDIUM → **LOW** — user docs and code agree; only internal spec drifts.

### Cross-Analysis Correlations
The 5 composite findings are the actionable cross-domain patterns. Two HIGH composites (`COMP-001`, `COMP-002`) recommend single-PR fixes that resolve multiple findings each.
