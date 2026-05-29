# Bun Migration (mszenfeld 0.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate av-opencode-plugins monorepo (mszenfeld fork, version 0.3.0) from npm to bun as the package manager and script runner, with 9 forward-applied quality improvements from iteration 1's `/fix-all` review baked into the initial change.

**Architecture:** Big-bang single-PR strategy on branch `feature/migrate-to-bun`. 6 atomic commits (one per Step 2-5 logical unit; Step 1 has no commits; Step 6 is final validation). vitest/tsup/eslint/prettier/typescript unchanged — only PM and script invocation pathways. Bun runtime API adoption (e.g., `Bun.spawn`) deferred to follow-up PR per spec audit section.

**Tech Stack:** Bun 1.3.13 (pin exact in `packageManager` and `.bun-version`); vitest 3.1.2; tsup 8.5.0; TypeScript 5.8.3; ESM with NodeNext resolution; `tsup.root.config.ts` with `bundle: false` for root + per-workspace tsup builds.

**Spec:** `docs/superpowers/specs/2026-05-28-bun-migration-mszenfeld-design.md` (commit d54e360).

**Branch:** `feature/migrate-to-bun` (already created, tracking origin/master = mszenfeld fork).

**Commit conventions:**
- Use `/commit` skill if available, or `AV_COMMIT_SKILL=1 git commit -m "..."` as bypass (the commit plugin blocks direct `git commit` via runtime hook in this repo).
- Conventional Commits: `chore(scope): subject` / `docs(scope): subject` / `fix(scope): subject` etc., subject ≤ 72 chars, lowercase scope.
- DO NOT push to origin or upstream. PR creation happens manually after all 6 commits land locally.

---

## Steps Overview

| Step | Tasks | Commits | Description |
|------|-------|---------|-------------|
| 1 | 1.1 – 1.7 | 0 | Pre-flight validation (linker, vitest+bun, pack layout, lifecycle scripts) |
| 2 | 2.1 – 2.6 | 1 | Lockfile swap + safety files (`bun.lock`, conditional `bunfig.toml`, `.gitattributes`, `.bun-version`) |
| 3a | 3a.1 – 3a.5 | 1 | Root `package.json` scripts + `scripts/check-package-manager.mjs` + atomic version bump |
| 3b | 3b.1 – 3b.3 | 1 | Per-package test scripts (4 packages) |
| 4 | 4.1 – 4.5 | 1 | `tests/root-plugin.test.ts` rewrite + `scripts/verify-dist-sync.mjs` ergonomics |
| 5 | 5.1 – 5.5 | 1 | Documentation (AGENTS.md, README.md, .prettierignore) |
| 6 | 6.1 – 6.4 | 0 | Final smoke (frozen-lockfile, full check, tarball validation, optional benchmarks) |

**Total: 5 commits** (one per logical milestone). Stop points possible after any commit.

---

## Step 1 — Pre-flight Validation (no commits)

**Goal:** Empirically validate spec assumptions before destructive changes. All Step 1 work uses temporary artifacts that are cleaned up at the end (Task 1.7).

**Inputs to determine:**
- Whether `bunfig.toml linker = "hoisted"` pin is needed (D6/R11)
- Whether vitest 3.1.2 works under bun runtime (R15)
- Whether `bun pm pack --destination` produces expected tarball layout (D7)
- Whether `bun pm untrusted` flags any lifecycle scripts (R5)

### Task 1.1: Bun version sanity

**Files:** none (system check only)

- [ ] **Step 1: Check installed bun version**

```bash
bun --version
```

Expected: a version number printed (e.g., `1.3.13`). If command not found, install bun first: `curl -fsSL https://bun.sh/install | bash`, then restart shell.

- [ ] **Step 2: Compare against spec pin (1.3.13)**

```bash
INSTALLED=$(bun --version)
EXPECTED=1.3.13
if [ "$INSTALLED" = "$EXPECTED" ]; then
  echo "OK: matches spec pin"
elif [ "$(printf '%s\n' "$EXPECTED" "$INSTALLED" | sort -V | head -1)" = "$EXPECTED" ]; then
  echo "INSTALLED ($INSTALLED) > EXPECTED ($EXPECTED) — spec says do NOT auto-bump, ask user"
else
  echo "INSTALLED ($INSTALLED) < EXPECTED ($EXPECTED) — run: bun upgrade --to $EXPECTED"
fi
```

Expected: `OK: matches spec pin`. If lower, run `bun upgrade --to 1.3.13`. If higher, **STOP and ask user** whether to bump spec pin (D2 floor-update is a separate decision).

### Task 1.2: Save dist/ baseline from current npm state

**Files:** none (creates `/tmp/dist-baseline/` for later comparison)

- [ ] **Step 1: Capture current dist/ as baseline**

```bash
# Ensure we have a clean npm-built dist/ to compare against
npm run check 2>&1 | tail -5
echo "Exit: $?"
# Copy dist/ to temp baseline location
rm -rf /tmp/dist-baseline
cp -r dist /tmp/dist-baseline
echo "Baseline saved: $(find /tmp/dist-baseline -type f | wc -l) files"
```

Expected: exit 0 from `npm run check`; baseline file count matches `find dist -type f | wc -l`. If npm check fails, abort migration (existing state is broken).

### Task 1.3: Empirical linker test (D6/R11 critical validation)

**Files:** temporary `bunfig.toml`, temporary `bun.lock`

- [ ] **Step 1: Save current npm artifacts for restore**

```bash
cp package-lock.json /tmp/package-lock.json.preflight
echo "Saved package-lock.json (size: $(wc -c < /tmp/package-lock.json.preflight))"
```

- [ ] **Step 2: Remove npm artifacts (will restore in Step 5)**

```bash
rm -rf node_modules
rm -f package-lock.json
```

- [ ] **Step 3: First trial — let bun choose default linker (no bunfig.toml)**

```bash
# No bunfig.toml — bun chooses default linker based on its policy
bun install 2>&1 | tail -10
echo "Exit: $?"
echo ""
echo "=== configVersion in generated bun.lock ==="
head -5 bun.lock
echo ""
echo "=== Linker resolution check ==="
ls -la node_modules/@appverk/opencode-skill-utils 2>&1 | head -2
# Symlink output = isolated linker; directory output = hoisted
```

Expected: `bun install` exit 0, `bun.lock` head shows `configVersion: N` (record value as `$DEFAULT_LINKER_CONFIG_VERSION`), and `@appverk/opencode-skill-utils` is either a symlink (isolated) or a flat dir (hoisted). Record both values.

- [ ] **Step 4: Build with default linker and compare against baseline**

```bash
bun run build:root 2>&1 | tail -5
echo "build:root exit: $?"
# Build skill-utils (its dist is consumed by other workspace typechecks)
(cd packages/skill-utils && bun run build) 2>&1 | tail -3
# Compare to baseline
diff -r dist /tmp/dist-baseline 2>&1 | head -20
echo "diff exit: $?"
```

Expected: `diff` exit 0 (empty output) → default linker works fine, **no `bunfig.toml` pin needed**. If diff shows differences → record them, may need pin.

- [ ] **Step 5: Record decision for Step 2**

```bash
# Create a decision marker file (consumed by Step 2)
mkdir -p /tmp/bun-migration-decisions
cat > /tmp/bun-migration-decisions/linker.txt <<EOF
bun_default_config_version=$(grep -E '^\s*"configVersion"' bun.lock | head -1 | sed 's/.*: //; s/,//')
default_linker_works=$([ -z "$(diff -r dist /tmp/dist-baseline 2>&1)" ] && echo "yes" || echo "no")
recommendation=$([ -z "$(diff -r dist /tmp/dist-baseline 2>&1)" ] && echo "skip-bunfig" || echo "pin-hoisted")
EOF
cat /tmp/bun-migration-decisions/linker.txt
```

Expected: file written with three fields. `recommendation=skip-bunfig` is the optimistic case; `pin-hoisted` is the conservative fallback.

### Task 1.4: Empirical vitest+bun smoke test (R15 validation)

**Files:** none (uses temporary `bun install` state from Task 1.3)

- [ ] **Step 1: Run the most mock-heavy package's tests under bun**

```bash
# code-review has the most complex vitest mock patterns in mszenfeld
bun --filter @appverk/opencode-code-review build 2>&1 | tail -5
bun --filter @appverk/opencode-code-review test 2>&1 | tail -15
echo "Exit: $?"
```

Expected: exit 0 from both build and test. If tests fail under bun (specifically mocking patterns), record details — this would be a major migration blocker per R15.

- [ ] **Step 2: Record vitest+bun decision**

```bash
cat >> /tmp/bun-migration-decisions/linker.txt <<EOF
vitest_bun_smoke=$([ $? -eq 0 ] && echo "pass" || echo "fail")
EOF
cat /tmp/bun-migration-decisions/linker.txt
```

Expected: `vitest_bun_smoke=pass`. If `fail`, **STOP migration** and report to upstream (vitest/bun).

### Task 1.5: Verify `bun pm pack --destination` tarball layout (D7)

**Files:** temporary `/tmp/bun-pack-test/`

- [ ] **Step 1: Pack and inspect tarball**

```bash
rm -rf /tmp/bun-pack-test
mkdir /tmp/bun-pack-test
bun pm pack --destination /tmp/bun-pack-test 2>&1 | tail -5
echo "Exit: $?"
ls /tmp/bun-pack-test/
TARBALL=$(ls /tmp/bun-pack-test/*.tgz | head -1)
echo "Tarball: $TARBALL"
echo ""
echo "=== First 15 paths in tarball ==="
tar -tzf "$TARBALL" | head -15
echo ""
echo "=== Total paths ==="
tar -tzf "$TARBALL" | wc -l
echo ""
echo "=== Path prefix check (all should start with 'package/') ==="
tar -tzf "$TARBALL" | grep -v '^package/' | head -5 || echo "(none — all paths have package/ prefix)"
echo ""
echo "=== dist/modules/ paths present? ==="
tar -tzf "$TARBALL" | grep 'dist/modules/' | head -5
```

Expected:
- exit 0
- one `.tgz` file written
- all paths prefixed with `package/`
- `dist/modules/{commit,qa,coordinator,explore,agent-registry,pantheon-config,_shared}` paths present
- Total paths ≥ 50 (mszenfeld has many `dist/` files)

### Task 1.6: Verify `bun pm untrusted` (R5)

**Files:** none

- [ ] **Step 1: Check for blocked lifecycle scripts**

```bash
bun pm untrusted 2>&1
echo "Exit: $?"
```

Expected: empty output (no blocked lifecycle scripts in current dep tree). If non-empty, record packages — they need to be added to bunfig `trustedDependencies` array.

- [ ] **Step 2: Record findings**

```bash
UNTRUSTED_OUTPUT=$(bun pm untrusted 2>&1)
echo "untrusted_packages=$(echo \"$UNTRUSTED_OUTPUT\" | grep -v '^$' | wc -l | xargs)" >> /tmp/bun-migration-decisions/linker.txt
echo "$UNTRUSTED_OUTPUT" > /tmp/bun-migration-decisions/untrusted.txt
cat /tmp/bun-migration-decisions/linker.txt
```

Expected: `untrusted_packages=0` (or low single digit, with names recorded for spec addendum).

### Task 1.7: Cleanup pre-flight artifacts

**Files:** removes `node_modules`, `bun.lock`, restores `package-lock.json`

- [ ] **Step 1: Restore npm baseline state**

```bash
rm -rf node_modules bun.lock
cp /tmp/package-lock.json.preflight package-lock.json
echo ""
echo "=== Working tree should be clean (only spec docs are uncommitted, on feature branch) ==="
git status --short
```

Expected: only `docs/superpowers/specs/...` and `docs/superpowers/plans/...` are tracked changes (already committed in spec commit + this plan being written). No new files outside docs/.

- [ ] **Step 2: Optional — clean up `/tmp/bun-pack-test/` and `/tmp/dist-baseline/`**

```bash
# Keep /tmp/bun-migration-decisions/linker.txt for Step 2 reference
# Optionally clean others
rm -rf /tmp/bun-pack-test
# /tmp/dist-baseline is needed for Step 2's bunfig decision verify, keep
```

Expected: tmp test dirs removed, decisions file retained.

**Step 1 exit criterion:** `/tmp/bun-migration-decisions/linker.txt` contains all 4 fields (`bun_default_config_version`, `default_linker_works`, `recommendation`, `vitest_bun_smoke`, `untrusted_packages`); working tree clean.

---

## Step 2 — Lockfile Swap + Safety Files (1 commit)

**Goal:** Replace `package-lock.json` with `bun.lock`, add safety files (`.bun-version`, `.gitattributes`), conditionally create `bunfig.toml` based on Step 1 result.

### Task 2.1: Save rollback baseline

**Files:** writes `/tmp/npm-ls-mszenfeld-before-bun.txt`

- [ ] **Step 1: Capture npm dependency tree snapshot**

```bash
npm ls --all > /tmp/npm-ls-mszenfeld-before-bun.txt 2>&1
echo "Saved $(wc -l < /tmp/npm-ls-mszenfeld-before-bun.txt) lines"
```

Expected: file written with full transitive tree (likely 200+ lines). This is for post-rollback comparison if needed.

### Task 2.2: Remove npm artifacts

**Files:** deletes `node_modules`, `package-lock.json`

- [ ] **Step 1: Remove**

```bash
rm -rf node_modules package-lock.json
git status --short | grep -E 'package-lock|node_modules' || echo "(no tracked changes from removal)"
echo ""
echo "=== Verify package-lock.json is staged as deleted ==="
git status --short
```

Expected: `D package-lock.json` shown in `git status` (or empty if it was untracked, unlikely). `node_modules/` doesn't show (gitignored).

### Task 2.3: Create `.bun-version`

**Files:**
- Create: `.bun-version`

- [ ] **Step 1: Write the file**

```bash
echo "1.3.13" > .bun-version
cat .bun-version
```

Expected: file content exactly `1.3.13` (no trailing newline issues).

### Task 2.4: Create `.gitattributes`

**Files:**
- Create: `.gitattributes`

- [ ] **Step 1: Write the file**

```bash
echo "bun.lock text eol=lf" > .gitattributes
cat .gitattributes
```

Expected: file content exactly `bun.lock text eol=lf`. This pins lockfile to LF line endings (Windows reproducibility).

### Task 2.5: Conditionally create `bunfig.toml`

**Files:**
- Create (conditional): `bunfig.toml`

- [ ] **Step 1: Read Step 1 decision**

```bash
cat /tmp/bun-migration-decisions/linker.txt
```

Expected: file contains `recommendation=skip-bunfig` or `recommendation=pin-hoisted`.

- [ ] **Step 2a: If recommendation=skip-bunfig, do nothing**

If `recommendation=skip-bunfig`, skip Task 2.5 entirely. Note in the commit message that bunfig was not needed (default linker matched npm baseline).

- [ ] **Step 2b: If recommendation=pin-hoisted, create bunfig.toml**

Create `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/bunfig.toml`:

```toml
# Pin: Bun 1.3.2+ changed default linker to "isolated" (pnpm-style symlinks
# via node_modules/.bun/) for new workspace projects with configVersion=1
# in bun.lock. We pin "hoisted" because Step 1 pre-flight verification
# showed tsup bundle:false output diverges under isolated linker on this
# project (see /tmp/bun-migration-decisions/linker.txt and spec D6).
#
# Remove this pin only after re-validating with empty bunfig + diff vs
# npm-built dist/ baseline (matches Step 1 protocol).
[install]
linker = "hoisted"
```

- [ ] **Step 3: Verify**

```bash
ls -la bunfig.toml 2>&1 | head -2
cat bunfig.toml 2>&1 | head -2 || echo "(no bunfig — skip-bunfig path taken)"
```

Expected: either file exists with TOML content, or "no bunfig" message confirming skip path.

### Task 2.6: `bun install` + sanity checks

**Files:** creates `bun.lock`

- [ ] **Step 1: Install**

```bash
bun install 2>&1 | tail -10
echo "Exit: $?"
ls bun.lock 2>&1
echo "bun.lock size: $(wc -c < bun.lock) bytes"
```

Expected: exit 0, `bun.lock` created (likely 50-100 KB).

- [ ] **Step 2: Sanity 1 — package.json unchanged**

```bash
git diff package.json
echo "Diff lines: $(git diff package.json | wc -l)"
```

Expected: empty (0 lines). If non-empty, bun reordered keys → record and consider as out-of-scope formatting.

- [ ] **Step 3: Sanity 2 — workspace symlinks**

```bash
ls -la node_modules/@appverk/ 2>&1
```

Expected: symlinks pointing to `../../packages/{skill-utils,skill-registry,code-review,frontend-developer,python-developer,swift-developer}/` (under hoisted) or symlinks via `.bun/` (under isolated).

- [ ] **Step 4: Sanity 3 — untrusted lifecycle scripts**

```bash
bun pm untrusted 2>&1
```

Expected: empty (or matching `/tmp/bun-migration-decisions/untrusted.txt` from Task 1.6).

- [ ] **Step 5: Sanity 4 — uuid override honored**

```bash
bun pm ls uuid 2>&1 | head -5
```

Expected: at least one entry with version ≥ `14.0.0` (mszenfeld has `overrides: { uuid: ">=14.0.0" }`).

- [ ] **Step 6: Sanity 5 — npm check passes with new install (sanity, npm still in scripts at this stage)**

```bash
# Scripts in package.json still use `npm run --workspace`, so this requires npm to be available.
# If npm is not installed, skip this sanity and proceed to Step 3.
which npm > /dev/null && npm run check 2>&1 | tail -10 || echo "npm not available, skipping sanity (acceptable)"
echo "Exit: $?"
```

Expected: either exit 0 from `npm run check` (npm still available, scripts still npm-based — works because bun installed deps in compatible layout), or "npm not available" message.

- [ ] **Step 7: Stage and commit**

```bash
git add bun.lock .bun-version .gitattributes
git add -A package-lock.json  # stage deletion
# Conditionally add bunfig.toml if it was created
[ -f bunfig.toml ] && git add bunfig.toml

git status --short
```

Expected: staged additions for `bun.lock`, `.bun-version`, `.gitattributes`, and conditionally `bunfig.toml`; staged deletion for `package-lock.json`.

- [ ] **Step 8: Commit**

```bash
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
chore(lock): add bun.lock + safety files, remove package-lock.json

Iteration 2 of bun migration on mszenfeld base. Drops npm
package-lock.json (~130 KB) in favor of bun.lock text format
(default since Bun 1.2).

Safety files added:
- .bun-version (1.3.13) for version-manager hint (mise/asdf/proto)
- .gitattributes pinning bun.lock to LF EOL (Windows reproducibility)

bunfig.toml is added only if Step 1 pre-flight showed dist/ drift
under bun default isolated linker (see /tmp/bun-migration-decisions/
linker.txt for the empirical result on this machine). If absent here,
bun's default linker matched npm-built dist/ byte-for-byte.

Scripts in package.json still reference 'npm run --workspace' at this
commit — those are rewritten in the next commit (chore(root): ...).
EOF
)"
```

Expected: commit created on `feature/migrate-to-bun`. Verify with `git log --oneline -1`.

**Step 2 exit criterion:** 1 new commit on branch; `bun.lock` exists; npm artifacts gone; sanity checks all pass.

---

## Step 3a — Root scripts + check-package-manager.mjs (1 commit)

**Goal:** Add preinstall guard script, rewrite all 4 root scripts to use `bun --filter`, add `build:skill-utils` named script, pin `packageManager` field, atomic version bump across root + 6 workspaces.

### Task 3a.1: Create `scripts/check-package-manager.mjs`

**Files:**
- Create: `scripts/check-package-manager.mjs`

- [ ] **Step 1: Write the file**

Create `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/scripts/check-package-manager.mjs`:

```javascript
// Preinstall guard for av-opencode-plugins.
//
// This is NOT a security control — npm_config_user_agent is trivially
// spoofable (e.g., npm_config_user_agent='bun/x' npm install bypasses it).
// Its purpose is to catch accidental `npm install` / `yarn install`
// invocations from developers unfamiliar with the bun-only convention.
// Real enforcement is via `packageManager` + README/AGENTS Prerequisites docs.
const ua = process.env.npm_config_user_agent ?? ""
if (!ua.startsWith("bun/")) {
  console.error("This project requires bun (>= 1.3.13). Detected:", ua || "<unset>")
  console.error("Install: https://bun.sh")
  console.error("See README.md Prerequisites for details.")
  process.exit(1)
}
```

- [ ] **Step 2: Smoke test the guard**

```bash
# Verify rejection (no UA → exit 1)
env -u npm_config_user_agent node scripts/check-package-manager.mjs 2>&1
echo "Exit (expected 1): $?"
echo ""
# Verify acceptance (bun UA → exit 0)
npm_config_user_agent='bun/1.3.13 (linux; x64)' node scripts/check-package-manager.mjs
echo "Exit (expected 0): $?"
echo ""
# Verify rejection of spoofed npm UA
npm_config_user_agent='npm/10.0.0 (linux; x64)' node scripts/check-package-manager.mjs 2>&1
echo "Exit (expected 1): $?"
```

Expected:
- First case: exits 1, prints "This project requires bun..." with "Detected: <unset>"
- Second case: exits 0, no output
- Third case: exits 1, prints "Detected: npm/10.0.0 ..."

### Task 3a.2: Edit root `package.json`

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Read current file**

Read `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/package.json` to confirm current state.

- [ ] **Step 2: Edit `package.json` — set `version`**

Change line 3 from `"version": "0.3.0",` to `"version": "0.4.0",`.

- [ ] **Step 3: Edit `package.json` — add `packageManager` field**

After `"private": true,` (or wherever fits the JSON property order), add:

```json
  "packageManager": "bun@1.3.13",
```

- [ ] **Step 4: Edit `package.json` `scripts` block — rewrite all 4 main scripts and add `build:skill-utils`**

Replace the existing `"scripts"` block with:

```json
  "scripts": {
    "preinstall": "node scripts/check-package-manager.mjs",
    "build:root": "tsup --config tsup.root.config.ts && node scripts/copy-root-assets.mjs",
    "build:skill-utils": "bun --filter @appverk/opencode-skill-utils build",
    "build": "bun run build:root && bun run build:skill-utils && bun --filter @appverk/opencode-python-developer build && bun --filter @appverk/opencode-code-review build && bun --filter @appverk/opencode-frontend-developer build && bun --filter @appverk/opencode-skill-registry build && bun --filter @appverk/opencode-swift-developer build",
    "test": "bun run build:root && bun run build:skill-utils && vitest run --config vitest.config.ts && bun --filter @appverk/opencode-python-developer test && bun --filter @appverk/opencode-code-review test && bun --filter @appverk/opencode-frontend-developer test && bun --filter @appverk/opencode-skill-registry test && bun --filter @appverk/opencode-swift-developer test",
    "typecheck": "tsc -p tsconfig.json --noEmit && bun run build:skill-utils && bun --filter @appverk/opencode-skill-utils typecheck && bun --filter @appverk/opencode-python-developer typecheck && bun --filter @appverk/opencode-code-review typecheck && bun --filter @appverk/opencode-frontend-developer typecheck && bun --filter @appverk/opencode-skill-registry typecheck && bun --filter @appverk/opencode-swift-developer typecheck",
    "check": "bun run typecheck && bun run test && bun run build",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "verify-dist": "node scripts/verify-dist-sync.mjs"
  },
```

(Note: `lint`, `format`, `format:check`, `verify-dist` are unchanged — they invoke local Node tooling, not npm.)

- [ ] **Step 5: Verify the edits**

```bash
node -e "const p = require('./package.json'); console.log('version:', p.version); console.log('packageManager:', p.packageManager); console.log('preinstall:', p.scripts.preinstall); console.log('build:skill-utils:', p.scripts['build:skill-utils'])"
```

Expected:
```
version: 0.4.0
packageManager: bun@1.3.13
preinstall: node scripts/check-package-manager.mjs
build:skill-utils: bun --filter @appverk/opencode-skill-utils build
```

### Task 3a.3: Atomic version bump across 6 workspaces

**Files:**
- Modify: `packages/code-review/package.json`
- Modify: `packages/frontend-developer/package.json`
- Modify: `packages/python-developer/package.json`
- Modify: `packages/skill-utils/package.json`
- Modify: `packages/skill-registry/package.json`
- Modify: `packages/swift-developer/package.json`

- [ ] **Step 1: Bump all 6 package versions atomically**

For each of the 6 `packages/*/package.json` files, change `"version": "0.3.0"` to `"version": "0.4.0"`.

Do all 6 in this task (NOT split across multiple commits) — `bun pm ls` would show version mismatch between root and workspaces if split.

- [ ] **Step 2: Verify all 7 versions match**

```bash
echo "Root: $(node -p "require('./package.json').version")"
for pkg in code-review frontend-developer python-developer skill-utils skill-registry swift-developer; do
  echo "$pkg: $(node -p "require('./packages/$pkg/package.json').version")"
done
```

Expected: all 7 lines show `0.4.0`.

### Task 3a.4: Validate `bun run typecheck`

**Files:** none (validation only)

- [ ] **Step 1: Reinstall to pick up new preinstall script**

```bash
bun install 2>&1 | tail -5
echo "Exit: $?"
```

Expected: exit 0. The new `preinstall` script triggers and exits 0 (bun UA passes guard).

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck 2>&1 | tail -20
echo "Exit: $?"
```

Expected: exit 0. This validates that root scripts work, `build:skill-utils` chain works, all per-package typechecks pass.

### Task 3a.5: Commit

- [ ] **Step 1: Stage**

```bash
git add scripts/check-package-manager.mjs package.json packages/*/package.json
git status --short
```

Expected: staged additions of `scripts/check-package-manager.mjs`, modifications to root `package.json` + 6 workspace `package.json` files.

- [ ] **Step 2: Commit**

```bash
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
chore(root): switch scripts to bun --filter, add packageManager + preinstall guard, bump to 0.4.0

Rewrites all 4 root scripts (build, test, typecheck, check) to use
'bun --filter' instead of 'npm run --workspace'. Adds the canonical
form 'bun --filter <name> <script>' (no 'run' keyword) per spec D4.

Extracted scripts/check-package-manager.mjs as a standalone preinstall
guard with explicit "UX hint, NOT a security control" header comment
(spec D3, ulepszenie #1). Replaces the absence of any preinstall
guard pre-migration — this is ADD, not refactor.

Added named 'build:skill-utils' script (spec D11, ulepszenie #5) so
the cross-workspace build dependency that build/test/typecheck all
rely on is intentional and named rather than hidden.

Atomic version bump 0.3.0 -> 0.4.0 (minor) across root + 6 workspace
packages, signalling consumer-facing build pipeline change (downstream
needs to install with bun, not npm).
EOF
)"
```

Expected: commit created. Verify with `git log --oneline -1`.

**Step 3a exit criterion:** 2 commits on branch; `bun run typecheck` passes; root and all 6 packages at version 0.4.0; preinstall guard works.

---

## Step 3b — Per-package test scripts (1 commit)

**Goal:** Update 4 packages' `test` script to use `bun run build` instead of `npm run build`. (skill-utils and skill-registry have no build prefix in their test script — no change.)

### Task 3b.1: Edit 4 per-package `package.json` files

**Files:**
- Modify: `packages/code-review/package.json`
- Modify: `packages/frontend-developer/package.json`
- Modify: `packages/python-developer/package.json`
- Modify: `packages/swift-developer/package.json`

- [ ] **Step 1: Edit each file**

For each of the 4 files, change:

```json
    "test": "npm run build && vitest run --config vitest.config.ts",
```

to:

```json
    "test": "bun run build && vitest run --config vitest.config.ts",
```

- [ ] **Step 2: Verify**

```bash
for pkg in code-review frontend-developer python-developer swift-developer; do
  grep -E '"test":' "packages/$pkg/package.json"
done
echo ""
echo "=== skill-utils and skill-registry should still have just vitest (no build prefix) ==="
for pkg in skill-utils skill-registry; do
  grep -E '"test":' "packages/$pkg/package.json"
done
```

Expected: 4 lines showing `"test": "bun run build && vitest run --config vitest.config.ts"`, 2 lines showing `"test": "vitest run --config vitest.config.ts"`.

### Task 3b.2: Validate full `bun run check`

**Files:** none (validation only)

- [ ] **Step 1: Run full check (typecheck + test + build)**

```bash
bun run check 2>&1 | tail -30
echo "Exit: $?"
```

Expected: exit 0. This is the first full end-to-end validation that bun-driven scripts work for the entire monorepo.

If failures occur:
- Look for "No packages matched the filter" errors → check filter syntax (must be `bun --filter <name> <script>`, not `bun --filter <name> run <script>`)
- Look for build ordering issues → may indicate `build:skill-utils` is missing from one of the chains
- Look for `bun pm untrusted` triggering → verify Step 1 pre-flight result still holds

### Task 3b.3: Verify shell semantics (R6 — bun shell differences)

**Files:** none (validation only)

- [ ] **Step 1: Verify chained scripts work under bun shell**

```bash
# Test build:root chain (uses && and node CLI)
bun run build:root 2>&1 | tail -5
echo "build:root exit: $?"
echo ""
# Test per-package build chain (uses && and node copy-assets script)
bun --filter @appverk/opencode-code-review build 2>&1 | tail -5
echo "code-review build exit: $?"
```

Expected: exit 0 from both. If either fails with shell errors (e.g., command not found, syntax error), R6 has materialized and chained scripts need rewriting (likely move `node copy-assets.mjs` invocations into separate bun scripts).

- [ ] **Step 2: Commit**

```bash
git add packages/code-review/package.json packages/frontend-developer/package.json packages/python-developer/package.json packages/swift-developer/package.json
git status --short
```

Expected: 4 staged modifications.

```bash
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
chore(packages): switch per-package test scripts to bun run build

Updates the 4 packages whose test script begins with 'npm run build'
to use 'bun run build' instead: code-review, frontend-developer,
python-developer, swift-developer.

skill-utils and skill-registry are unchanged — their test scripts
are just 'vitest run' (no build prefix needed because their tests
don't import from dist/).

This is the second of three commits that complete the script-level
PM migration. After this commit, 'bun run check' runs end-to-end
with no npm references remaining in any package.json script.
EOF
)"
```

**Step 3b exit criterion:** 3 commits on branch; full `bun run check` passes end-to-end.

---

## Step 4 — `tests/root-plugin.test.ts` + `verify-dist-sync.mjs` rewrite (1 commit)

**Goal:** Update `scripts/verify-dist-sync.mjs` to use bun + execFileSync + bound catches (ulepszenia #3, #4). Rewrite the "packages a self-contained git-install surface" test to use `bun pm pack --destination + tar -tzf` with `try/finally` cleanup and `arrayContaining(...)` derived from `package.json:files` (ulepszenia #2, #9).

### Task 4.1: Edit `scripts/verify-dist-sync.mjs`

**Files:**
- Modify: `scripts/verify-dist-sync.mjs`

- [ ] **Step 1: Read current file**

Read `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/scripts/verify-dist-sync.mjs` to confirm current state (53 lines, uses `execSync` for both build and git status).

- [ ] **Step 2: Add `execFileSync` to imports**

Change line 6 from:

```javascript
import { execSync } from "node:child_process"
```

to:

```javascript
import { execFileSync, execSync } from "node:child_process"
```

- [ ] **Step 3: Update comment block (top of file)**

Change the file header (lines 1-5) to reference bun:

```javascript
#!/usr/bin/env node
/**
 * Verifies that committed dist/ artifacts are in sync with src/.
 * Run this after `bun run build` in CI to prevent drift.
 */
```

(Change `npm run build` → `bun run build` in comment.)

- [ ] **Step 4: Update trackedDistPaths comment**

Lines 9-12 comment block — change `Run this after 'npm run build'` to `Run this after 'bun run build'` if present. (Content of `trackedDistPaths` array unchanged.)

- [ ] **Step 5: Update build step (execSync) with bound catch**

Change lines 23-29:

```javascript
// Run build first
console.log("Running npm run build...")
try {
  execSync("npm run build", { stdio: "inherit" })
} catch {
  console.error("Build failed. Fix build errors before checking dist sync.")
  process.exit(1)
}
```

to:

```javascript
// Run build first
console.log("Running bun run build...")
try {
  execSync("bun run build", { stdio: "inherit" })
} catch (err) {
  console.error("Build failed (exit", err.status, "). Fix build errors before checking dist sync.")
  process.exit(1)
}
```

(Changed: log message `npm run build` → `bun run build`, `execSync` arg `npm run build` → `bun run build`, `catch {}` → `catch (err)` with exit code logged.)

- [ ] **Step 6: Update git status with execFileSync + bound catch**

Change lines 33-42:

```javascript
let changedFiles

try {
  const output = execSync("git status --short -- " + trackedDistPaths.join(" "), {
    encoding: "utf8",
  })
  changedFiles = output.trim()
} catch {
  console.error("Failed to run git status. Ensure this is a git repository.")
  process.exit(1)
}
```

to:

```javascript
let changedFiles

try {
  const output = execFileSync(
    "git",
    ["status", "--short", "--", ...trackedDistPaths],
    { encoding: "utf8" },
  )
  changedFiles = output.trim()
} catch (err) {
  console.error("Failed to run git status:", err.message)
  console.error("Ensure this is a git repository.")
  process.exit(1)
}
```

(Changed: `execSync` with shell-concat → `execFileSync` argv-form; `catch {}` → `catch (err)` with message logged.)

- [ ] **Step 7: Update final success and failure messages**

Change line 49 from:

```javascript
  console.error("\nRun 'npm run build' locally and commit the updated dist/ files.")
```

to:

```javascript
  console.error("\nRun 'bun run build' locally and commit the updated dist/ files.")
```

- [ ] **Step 8: Verify the file is valid**

```bash
node --check scripts/verify-dist-sync.mjs && echo "Syntax OK"
```

Expected: `Syntax OK`.

- [ ] **Step 9: Run it**

```bash
bun run verify-dist 2>&1 | tail -10
echo "Exit: $?"
```

Expected: exit 0, output `✅ dist/ is in sync with src/` (or whatever the existing success message is). If non-zero, dist/ has drifted — rebuild and commit before continuing.

### Task 4.2: Update `tests/root-plugin.test.ts` — imports

**Files:**
- Modify: `tests/root-plugin.test.ts`

- [ ] **Step 1: Read current file**

Confirm current state.

- [ ] **Step 2: Update imports**

Change line 2 from:

```typescript
import { existsSync, readFileSync } from "node:fs"
```

to:

```typescript
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
```

After line 2, add (if not already present):

```typescript
import { tmpdir } from "node:os"
```

(Verify: `import path from "node:path"` should already be present.)

### Task 4.3: Add `deriveExpectedFilesFromPackageJson` helper

**Files:**
- Modify: `tests/root-plugin.test.ts`

- [ ] **Step 1: Add helper near top of file (after existing helpers, before `describe("AppVerkPlugins", ...)`)**

Insert after line 27 (after `loadRootModule` function), before line 29 (`type ShellEnvHook`):

```typescript
function deriveExpectedFilesFromPackageJson(
  packageJson: { files?: string[] },
  rootDir: string,
): string[] {
  const SKIP_FILES = new Set([".DS_Store", "Thumbs.db"])
  const SKIP_EXTENSIONS = [".tsbuildinfo"]
  const isSkippable = (name: string): boolean =>
    name.startsWith(".") ||
    SKIP_FILES.has(name) ||
    SKIP_EXTENSIONS.some((ext) => name.endsWith(ext))

  const entries = packageJson.files ?? []
  const result: string[] = []

  for (const entry of entries) {
    // Assumption (verified): mszenfeld package.json `files` has no glob patterns
    if (entry.includes("*")) {
      throw new Error(`Glob in files array not supported: ${entry}`)
    }
    const absPath = path.join(rootDir, entry)
    if (!existsSync(absPath)) {
      throw new Error(`File or directory not found: ${absPath}`)
    }
    const stat = statSync(absPath)
    if (stat.isFile()) {
      // Skip if filename is in skip-list
      const basename = path.basename(entry)
      if (!isSkippable(basename)) result.push(entry)
      continue
    }
    // It's a directory — recurse
    const dirEntries = readdirSync(absPath, { recursive: true, withFileTypes: true })
    for (const dirent of dirEntries) {
      if (dirent.isDirectory()) continue
      if (isSkippable(dirent.name)) continue
      // dirent.parentPath is absolute; compute path relative to entry
      const parentPath = dirent.parentPath ?? absPath
      const relativePath = path.relative(absPath, path.join(parentPath, dirent.name))
      result.push(path.posix.join(entry, relativePath.split(path.sep).join("/")))
    }
  }

  return result
}
```

(Notes for the engineer:
- `readdirSync({recursive: true, withFileTypes: true})` is available in Node 20+ / Bun.
- `dirent.parentPath` is the abs path of the dirent's parent; fallback for older types is `absPath`.
- Path separator normalized to POSIX `/` because tarball uses POSIX paths regardless of OS.)

### Task 4.4: Rewrite the "packages a self-contained git-install surface" test

**Files:**
- Modify: `tests/root-plugin.test.ts`

- [ ] **Step 1: Locate the test**

The test is at approximately line 101, starts with:

```typescript
  it("packages a self-contained git-install surface", () => {
```

- [ ] **Step 2: Replace the entire test body**

Replace lines 101–191 (the entire `it(...)` block from opening `it(` through its closing `})`) with:

```typescript
  it("packages a self-contained git-install surface", () => {
    const packageJson = readRootPackageJson()

    expect(packageJson.dependencies).toMatchObject({
      "@opencode-ai/plugin": expect.any(String),
    })
    expect(packageJson.dependencies).not.toHaveProperty(
      "@appverk/opencode-commit",
    )
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "dist",
      ]),
    )

    const tmpDir = mkdtempSync(path.join(tmpdir(), "bun-pack-"))
    try {
      execFileSync("bun", ["pm", "pack", "--destination", tmpDir], {
        cwd: rootDirectory,
      })

      const tarball = readdirSync(tmpDir).find((entry) => entry.endsWith(".tgz"))
      if (!tarball) {
        throw new Error(`No .tgz file found in ${tmpDir}`)
      }

      const packedFiles = execFileSync("tar", ["-tzf", path.join(tmpDir, tarball)], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .map((entry) => entry.replace(/^package\//, ""))
        .filter((entry) => entry.length > 0)

      // Derive expected files from package.json `files` (ulepszenie #9):
      // any new path added to `files` is auto-asserted without test maintenance
      const expectedFiles = deriveExpectedFilesFromPackageJson(packageJson, rootDirectory)
      expect(packedFiles).toEqual(expect.arrayContaining(expectedFiles))
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
```

(Notes:
- `try/finally + rmSync` is ulepszenie #2 — cleanup guaranteed.
- `expect.arrayContaining(...)` order-agnostic — derived list need not be sorted.
- Outer test type for `packageJson` is `{ files?: string[]; dependencies?: Record<string, string> }` — confirm `readRootPackageJson` type assertion includes `files`.)

- [ ] **Step 3: Verify `readRootPackageJson` includes `files` in its type**

Check existing type assertion at line 13-17:

```typescript
function readRootPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    main: string
    types?: string
    files?: string[]
    dependencies?: Record<string, string>
  }
}
```

`files?: string[]` should already be present. If not, add it.

### Task 4.5: Validate test changes

**Files:** none (validation only)

- [ ] **Step 1: Run the modified test in isolation**

```bash
# Build first (test imports from dist)
bun run build:root 2>&1 | tail -3
# Run just the root-plugin test
bun run vitest run --config vitest.config.ts tests/root-plugin.test.ts 2>&1 | tail -20
echo "Exit: $?"
```

Expected: exit 0, all `it(...)` blocks pass including the "packages a self-contained git-install surface" test.

- [ ] **Step 2: Run full `bun run check`**

```bash
bun run check 2>&1 | tail -20
echo "Exit: $?"
```

Expected: exit 0.

- [ ] **Step 3: Run `bun run verify-dist`**

```bash
bun run verify-dist 2>&1 | tail -5
echo "Exit: $?"
```

Expected: exit 0, success message printed.

- [ ] **Step 4: Verify tmp cleanup**

```bash
ls /tmp/bun-pack-* 2>&1 | head -5 || echo "(no leftover tmp dirs — cleanup working)"
```

Expected: no leftover `/tmp/bun-pack-*` directories (test's try/finally cleaned up).

### Task 4.6: Commit

- [ ] **Step 1: Stage**

```bash
git add scripts/verify-dist-sync.mjs tests/root-plugin.test.ts
git status --short
```

- [ ] **Step 2: Commit**

```bash
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
test(root): use bun pm pack + tar, derive expected files from package.json

Replaces 'npm pack --dry-run --json' in tests/root-plugin.test.ts
with 'bun pm pack --destination <tmp>' + 'tar -tzf' parsing. bun's
'bun pm pack' has no --json flag (spec D7), so we use the tarball
listing as the order-agnostic source of truth.

Wraps the pack+assertion block in try/finally with rmSync to clean
up the temp directory on every exit path (ulepszenie #2 — eliminates
~10-50 KB leak per test run).

The assertion list is now derived from package.json's 'files' field
via deriveExpectedFilesFromPackageJson helper (ulepszenie #9). Any
new dist/ path added to 'files' is automatically asserted — closes
the R13 regression class without manual list maintenance.

Updates scripts/verify-dist-sync.mjs in same commit:
- npm run build -> bun run build
- execSync('git status -- ' + paths.join(' ')) -> execFileSync(...)
  with argv form, eliminates latent CWE-78 (ulepszenie #3)
- catch {} -> catch (err) with exit code logged (ulepszenie #4)
EOF
)"
```

**Step 4 exit criterion:** 4 commits on branch; `bun run check && bun run verify-dist` both pass; no /tmp leaks after test run.

---

## Step 5 — Documentation (1 commit)

**Goal:** Update AGENTS.md (Prerequisites + Commands + skill-utils build dep + filter syntax note), README.md (Prerequisites + Local Development), .prettierignore (`package-lock.json` → `bun.lock`). Grep sanity sweep with ripgrep.

### Task 5.1: Update `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add Prerequisites section**

Insert new section **before** the existing "Pantheon harness configuration" section (currently around line 28). The new section should be:

```markdown
## Prerequisites

**Required:** Bun ≥ 1.3.13. Install:

```bash
curl -fsSL https://bun.sh/install | bash
```

This project uses Bun exclusively for installation and script execution. Do NOT use `npm`, `yarn`, or other package managers — a `preinstall` guard in root `package.json` (`scripts/check-package-manager.mjs`) rejects non-bun runners. The guard is a UX hint, not a security control (`npm_config_user_agent` is spoofable); real enforcement is via the `packageManager` field and these docs.

`.bun-version` pins the toolchain version for version managers (mise/asdf/proto auto-switch to 1.3.13 when entering the repo).
```

- [ ] **Step 2: Update Commands section**

In the existing "## Commands" section (currently around line 32), replace the three `npm run X` lines with `bun run X`:

```markdown
## Commands

```bash
# Full validation (run this before pushing)
bun run check          # typecheck + test + build

# Individual steps
bun run typecheck      # tsc --noEmit at root + each workspace
bun run test           # vitest at root + each workspace
bun run build          # tsup ESM + DTS for all packages
```
```

- [ ] **Step 3: Update Per-package commands section**

In "### Per-package commands" section (currently around line 44), replace:

```bash
npm run build --workspace @appverk/opencode-python-developer
npm run test  --workspace @appverk/opencode-python-developer
```

with:

```bash
bun --filter @appverk/opencode-python-developer build
bun --filter @appverk/opencode-python-developer test
```

Then add the filter syntax note (ulepszenie #7) immediately after this code block:

```markdown
**Note:** bun's `--filter` takes the script name directly (e.g., `bun --filter X build`). The form `bun --filter X run build` returns `No packages matched the filter` because bun parses `run` as the script target. The alternate form `bun run --filter X build` (run BEFORE filter) is also documented-valid; we use the canonical `bun --filter X SCRIPT` form throughout this project.
```

- [ ] **Step 4: Add skill-utils build dependency section**

After the existing "### Per-package commands" section, add a new subsection:

```markdown
### skill-utils build dependency (intentional)

Root `typecheck`, `test`, and `build` all invoke `bun run build:skill-utils` early in their chains. This is because other workspace packages typecheck and import against `packages/skill-utils/dist/*.d.ts` — so skill-utils must be built first, BEFORE other workspaces can typecheck.

The `build:skill-utils` script is exposed as a named root script (not inlined) so this side-effect is intentional and discoverable, not hidden chain magic. When adding a new workspace that imports from skill-utils, no script changes are needed — the dependency is already encoded.
```

- [ ] **Step 5: Verify edits**

```bash
grep -n "Prerequisites" AGENTS.md | head -5
grep -nE "bun (run|--filter)" AGENTS.md | head -10
grep -n "skill-utils build dependency" AGENTS.md | head -3
```

Expected: lines printed for all three patterns, confirming sections were added.

### Task 5.2: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Local Development → Install commands**

In the "## Local Development" section, change:

```bash
npm install
```

to:

```bash
bun install
```

And change any other `npm run X` to `bun run X` in this section.

- [ ] **Step 2: Add Prerequisites section in Local Development**

Add a "### Prerequisites" subsection at the top of "## Local Development":

```markdown
### Prerequisites

**Required:** Bun ≥ 1.3.13.

```bash
curl -fsSL https://bun.sh/install | bash
```

This project uses Bun exclusively. A `preinstall` guard rejects `npm install` and `yarn install`. See AGENTS.md "Prerequisites" for the rationale.
```

- [ ] **Step 3: Verify edits**

```bash
grep -nE "bun (install|run)" README.md | head -10
grep -n "Prerequisites" README.md | head -3
```

Expected: lines printed showing the bun usage and the new Prerequisites section.

- [ ] **Step 4: Note about Installation downstream tag**

The "## Installation" section (top of README) currently references `#v0.3.0`. The tag bump to `v0.4.0` happens **after merge** (as a separate manual step), NOT in this commit. Leave `#v0.3.0` as-is in this commit; document the tag bump as a post-merge step.

### Task 5.3: Update `.prettierignore`

**Files:**
- Modify: `.prettierignore`

- [ ] **Step 1: Read current file**

```bash
cat .prettierignore
```

- [ ] **Step 2: Replace `package-lock.json` with `bun.lock`**

If `.prettierignore` contains a line `package-lock.json`, change it to `bun.lock`. If it contains both already (unlikely), remove the npm one.

```bash
# Verify after edit
grep -E '(bun\.lock|package-lock\.json)' .prettierignore
```

Expected: `bun.lock` line present, no `package-lock.json` line.

### Task 5.4: Grep sanity sweep (with ripgrep)

**Files:** none (validation only)

- [ ] **Step 1: Sweep for residual npm/npx references in infra files**

```bash
rg -nE '\b(npm|npx)\b' \
  --type-add 'cfg:*.{json,mjs,cjs,ts,js,md,yml,yaml,sh}' \
  --type cfg \
  --glob '!node_modules' \
  --glob '!.git' \
  --glob '!**/dist/**' \
  --glob '!packages/*/src/**' \
  --glob '!src/modules/**' \
  --glob '!src/{skills,commands,agents,hooks}/**' \
  . 2>&1 | head -40
```

Expected: ideally empty. If any matches appear, classify each:
- **Allowed:** any match in `packages/*/src/{skills,agents,commands}/`, `src/modules/**/*.{md,ts}`, `src/{skills,commands,agents,hooks}/**`, `dist/**` (intentional product content for downstream consumers — covered by exclusion globs above)
- **Allowed:** any match inside spec/plan files in `docs/superpowers/` (they reference npm as the OLD state)
- **Allowed:** test files quoting npm in error messages or comparisons
- **NOT allowed:** any match in `package.json` (root or packages), `bunfig.toml`, `tsconfig*.json`, `vitest.config.ts`, `scripts/*.{mjs,sh}` (except `scripts/check-package-manager.mjs` which mentions npm by design)

For NOT-allowed matches, fix them in this commit.

### Task 5.5: Commit

- [ ] **Step 1: Stage**

```bash
git add AGENTS.md README.md .prettierignore
git status --short
```

Expected: 3 modifications staged.

- [ ] **Step 2: Commit**

```bash
AV_COMMIT_SKILL=1 git commit -m "$(cat <<'EOF'
docs: switch commands to bun, add Prerequisites sections

AGENTS.md:
- New Prerequisites section before Pantheon harness config
- Commands: npm run X -> bun run X
- Per-package commands: bun --filter syntax + motivating error
  message note (ulepszenie #7)
- New 'skill-utils build dependency' section documenting the
  build:skill-utils named script and why it exists (ulepszenie #5)

README.md:
- New Prerequisites subsection in Local Development
- npm install -> bun install
- npm run X -> bun run X

.prettierignore:
- package-lock.json -> bun.lock (lockfile that needs ignoring changed)

Downstream Installation tag (#v0.4.0) is bumped post-merge, not in
this commit.
EOF
)"
```

**Step 5 exit criterion:** 5 commits on branch; docs reflect bun-based workflow; grep sweep clean.

---

## Step 6 — Final Smoke (no commit)

**Goal:** Validate the full migration end-to-end from a clean state.

### Task 6.1: Clean install with frozen lockfile

**Files:** none (validation only)

- [ ] **Step 1: Wipe node_modules and reinstall from frozen lockfile**

```bash
rm -rf node_modules
bun install --frozen-lockfile 2>&1 | tail -10
echo "Exit: $?"
```

Expected: exit 0. `--frozen-lockfile` ensures the lockfile is deterministic (no auto-resolution of missing deps).

### Task 6.2: Full `bun run check + verify-dist`

**Files:** none (validation only)

- [ ] **Step 1: Run check**

```bash
bun run check 2>&1 | tail -15
echo "check exit: $?"
```

Expected: exit 0.

- [ ] **Step 2: Run verify-dist**

```bash
bun run verify-dist 2>&1 | tail -5
echo "verify-dist exit: $?"
```

Expected: exit 0, success message.

### Task 6.3: Tarball smoke test (end-to-end packaging validation)

**Files:** none (validation only)

- [ ] **Step 1: Pack and import**

```bash
TMP=$(mktemp -d)
echo "TMP: $TMP"
bun pm pack --destination "$TMP" 2>&1 | tail -3
echo "pack exit: $?"
echo ""
cd "$TMP"
tar -xzf *.tgz
echo "Extracted: $(ls package/ | head -10)"
echo ""
cd package
bun install 2>&1 | tail -5
echo "install exit: $?"
echo ""
node -e "import('./dist/index.js').then(m => console.log('OK keys:', Object.keys(m))).catch(e => { console.error('FAIL:', e.message); process.exit(1) })"
echo "import exit: $?"
echo ""
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
rm -rf "$TMP"
```

Expected: final line should print `OK keys: [ 'AppVerkPlugins', 'createAppVerkPlugins', 'default' ]` or similar — confirms the published artifact loads correctly.

### Task 6.4: Optional benchmark recording

**Files:** none (validation only; outputs go to PR description)

- [ ] **Step 1: Record bun install time (frozen)**

```bash
rm -rf node_modules
{ time bun install --frozen-lockfile 2>&1 > /dev/null; } 2>&1 | grep -E 'real|user|sys'
```

Expected: ~750ms-2s for warm cache, may be slower cold.

- [ ] **Step 2: Record bun check time**

```bash
{ time bun run check 2>&1 > /dev/null; } 2>&1 | grep -E 'real|user|sys'
```

Expected: 30-60s (depends on test suite size).

- [ ] **Step 3: Optional — same with npm on backup tag (only if user has npm available)**

```bash
git stash  # temporarily save any uncommitted changes
git checkout backup/master-before-mszenfeld-rebase
rm -rf node_modules
{ time npm ci 2>&1 > /dev/null; } 2>&1 | grep -E 'real|user|sys'
{ time npm run check 2>&1 > /dev/null; } 2>&1 | grep -E 'real|user|sys'
git checkout feature/migrate-to-bun
git stash pop || true
```

Record both numbers; include in PR description as motivation evidence.

**Step 6 exit criterion:** all validations pass; tarball smoke imports cleanly; (optional) benchmark recorded.

---

## Final Verification Checklist (DoD from spec)

Before opening PR, confirm each of these:

**Build/test pipeline:**
- [ ] `bun run typecheck` — exit 0 (root + 6 packages)
- [ ] `bun run test` — exit 0 (all tests across `tests/`, `tests/modules/{commit,qa,coordinator,explore,agent-registry,pantheon-config}`, per-package `tests/`)
- [ ] `bun run build` — exit 0, dist/ matches committed
- [ ] `bun run verify-dist` — exit 0

**Reproducibility:**
- [ ] `bun install --frozen-lockfile` from scratch — exit 0
- [ ] `bun.lock` in repo, `package-lock.json` removed
- [ ] `git diff package.json` after `bun install` — empty (no reorder)

**Packaging:**
- [ ] Tarball smoke test (Step 6.3) — `node -e "import('./dist/index.js')"` prints OK
- [ ] `tests/root-plugin.test.ts` "packages a self-contained git-install surface" passes with derived expected files

**Toolchain enforcement:**
- [ ] `packageManager: "bun@1.3.13"` in root `package.json`
- [ ] `.bun-version` = `1.3.13`
- [ ] `bunfig.toml` present with `linker = "hoisted"` + comment (or absent if Step 1 verified `isolated` works — record in PR description)
- [ ] `.gitattributes` with `bun.lock text eol=lf`
- [ ] `scripts/check-package-manager.mjs` present with "UX hint, NOT a security control" header
- [ ] Preinstall guard: `npm install` exits 1 with helpful error
- [ ] Preinstall guard does NOT block `bun install`

**Versioning:**
- [ ] Root `package.json` version `0.4.0`
- [ ] All 6 `packages/*/package.json` version `0.4.0`

**Lifecycle safety:**
- [ ] `bun pm untrusted` empty (or matches recorded Step 1.6 result)
- [ ] `bun pm ls uuid` shows ≥ 14.0.0

**Documentation:**
- [ ] `AGENTS.md` has Prerequisites + Commands + skill-utils build dep + filter syntax note
- [ ] `README.md` has Prerequisites in Local Development
- [ ] `.prettierignore` has `bun.lock`, not `package-lock.json`
- [ ] Grep sweep (ripgrep) clean for infra (allowed exceptions documented)
- [ ] Spec + plan files in `docs/superpowers/`

**Commit hygiene:**
- [ ] 5 commits on `feature/migrate-to-bun` (one per Step 2-5)
- [ ] Subject lines ≤ 72 chars, lowercase scopes
- [ ] All commit messages explain "why" not just "what"
- [ ] Branch NOT pushed to remote (manual step after PR approval)

---

## Summary of Commits

After plan execution, expected commits on `feature/migrate-to-bun`:

1. `chore(lock): add bun.lock + safety files, remove package-lock.json` (Step 2)
2. `chore(root): switch scripts to bun --filter, add packageManager + preinstall guard, bump to 0.4.0` (Step 3a)
3. `chore(packages): switch per-package test scripts to bun run build` (Step 3b)
4. `test(root): use bun pm pack + tar, derive expected files from package.json` (Step 4)
5. `docs: switch commands to bun, add Prerequisites sections` (Step 5)

Total: **5 commits** (Step 1 is pre-flight only, no commits; Step 6 is final smoke only, no commits).

---

## Pause/Resume Strategy

The plan supports pausing between any step. To resume:

1. Run `git log --oneline -10 feature/migrate-to-bun` to see which commits have landed
2. Find the next Step in the plan (Step 2/3a/3b/4/5)
3. Resume from the first task of that Step

**Recommended pause points** (logically complete states):

- **After Step 2 commit:** lockfile swapped, safety files in place, but scripts still use npm. Repo functional under both npm and bun. (Stop here only if needing to debug Step 3+ later.)
- **After Step 3a + 3b commits:** all scripts on bun, versions bumped. Full bun-based workflow operational. (Best pause point if needing extended interruption.)
- **After Step 4 commit:** tarball test updated, verify-dist modernized. Only docs left.
- **After Step 5 commit:** complete. Step 6 is validation-only, can be deferred to PR review.

If pausing for > 1 day, also save `/tmp/bun-migration-decisions/linker.txt` to a more permanent location (e.g., `.git/info/bun-migration-decisions.txt`) since `/tmp` may be cleared by the OS.

---

## Rollback Strategy (from spec)

If migration needs to be aborted post-merge:

```bash
# 1. Revert merge commit
git revert <merge-commit>

# 2. Clean bun artifacts (git revert doesn't touch these)
rm -rf node_modules bun.lock

# 3. Restore npm baseline
npm install
npm run check
```

Time: < 5 min on developer machine.

Per-machine cleanup may be needed for team members who already pulled the branch — they need `rm -rf node_modules` on their machines.

Backup tag for full reset reference: `backup/master-before-mszenfeld-rebase` (iteration 1, AppVerk-based), and an additional `backup/mszenfeld-master-before-bun-migration` should be created post-merge.

---

## Post-Merge Follow-ups (not part of this plan)

After merge to mszenfeld/master:

1. **Release tag:** Create `v0.4.0` tag pointing at merge commit; update README "Installation" example from `#v0.3.0` to `#v0.4.0`.
2. **Bun runtime API audit follow-up (spec section "Bun runtime API audit"):** Consider PoC PR `feature/bun-spawn-run-bash` for A1 — but only after writing a benchmark spec (n samples, warm-up, threshold). Without benchmark spec, do not open the PoC.
3. **Documentation maintenance:** If iteration 1's spec (`docs/superpowers/specs/2026-05-28-bun-migration-design.md`) and plan (`docs/superpowers/plans/2026-05-28-bun-migration-plan.md`) remain in repo, consider marking them clearly as `[ARCHIVED — superseded by 2026-05-28-bun-migration-mszenfeld-design.md, iteration 1 worked against AppVerk base, never merged]`.

---

## Addendum (post-implementation)

> Notka korygująca dodana po wdrożeniu. Nie zmienia oryginalnych kroków ani milestone'ów powyżej — jedynie odnotowuje rozjazd między planem a faktyczną implementacją.

- **Liczba commitów — przekroczyła planowane 5 (sprostowanie):** Mapa milestone'ów deklarowała **"Total: 5 commits"** (jeden na milestone). Faktyczna liczba commitów na branchu przekroczyła 5 z powodu post-implementacyjnych poprawek code review (m.in. `b4581e4`, `79b8902`, `d6a5628`). Pierwotny podział na milestone'y pozostaje aktualny jako logiczna struktura pracy.
- **`package.json` `files[]` — zmieniony:** Wbrew deklaracji w spec ("files[] BEZ ZMIAN"), `files[]` zyskało wpis `"scripts"` (commit `b4581e4`), aby guard preinstall działał w scenariuszu extract-then-install. Szczegóły w sekcji "Addendum (post-implementation)" pliku spec (`2026-05-28-bun-migration-mszenfeld-design.md`).
