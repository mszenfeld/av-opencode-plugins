# Spec — Root `src/` TypeScript Migration + `commit` Pilot Absorption

**Date:** 2026-05-20
**Status:** Draft (awaiting user review)
**Stage:** 1 of N (broader monorepo→single-project consolidation)

> **Deviation from original plan:** The root tsup config is named `tsup.root.config.ts`, not `tsup.config.ts`. tsup auto-discovers any `tsup.config.ts` in a parent of the cwd, so a generic name at the repo root would leak `bundle: false` into every workspace build. The distinctive filename is invoked explicitly via `tsup --config tsup.root.config.ts` (see `package.json` → `scripts.build:root`).

## Goal

Align the root package to the workspace pattern (TS-only in `src/`, build output in `dist/`) and, as the first step of a longer-term consolidation of the monorepo into a single-project layout (in the style of `oh-my-openagent`), absorb the `commit` workspace package into root `src/modules/commit/`. This spec defines the **first stage** only; subsequent packages will be migrated in their own specs following the pattern established here.

## Motivation

The root `src/` currently commits three versions of each module — `.ts` (source), `.js` (compiled), and `.d.ts` (declarations) — produced by an in-place build that compiles TypeScript and copies the output back into `src/`. This is inconsistent with the workspace packages (which use the conventional `src/` → `dist/` pattern) and clutters code review, editor navigation, and diffs.

Beyond the local cleanup, this is the opening move of a longer effort: collapse the nine workspace packages into a single project so future contributions don't require workspace-level book-keeping.

## In Scope

- Root build pipeline: `src/` becomes TS-only, output goes to `dist/` via `tsup` (matching workspaces).
- Update `package.json` (`main`, `types`, `files`, `scripts`) and `.gitignore` for the new layout.
- Absorb `packages/commit/` into:
  - `src/modules/commit/` — TypeScript source.
  - `src/commands/commit.md` — slash-command asset.
  - `tests/modules/commit/` — test files.
- Remove `packages/commit/` from the tree and from the workspaces configuration.
- Update path resolution in the absorbed `commit` plugin to find `commit.md` under the new layout.
- Update root `src/index.ts` to import `AppVerkCommitPlugin` from the new location.

## Out of Scope

- The remaining 8 workspaces (`python-developer`, `code-review`, `frontend-developer`, `skill-utils`, `skill-registry`, `qa`, `swift-developer`, `coordinator`) stay as-is.
- Reorganisation of `src/hooks/session-notification/` (stays where it is).
- npm publication strategy — root remains private, workspaces remain individually publishable.
- Unification of test configurations across root and workspaces.
- Any refactor inside `commit` beyond what migration requires (1:1 move).

## Success Criteria

1. `src/` contains **only** `.ts` files (no `.js`, no `.d.ts`).
2. `dist/` is committed and contains the compiled output (1:1 mirror of `src/`) plus copied assets.
3. `packages/commit/` no longer exists; nothing in the tree imports `@appverk/opencode-commit`.
4. `npm run check` (typecheck + test + build) passes on every commit (git-bisectable).
5. After restart, OpenCode loads the plugin from `./dist/index.js` and the `/commit` slash-command works end-to-end.

## Target Directory Layout

```
src/
  index.ts                       # entry, merges all plugins
  modules/
    commit/
      index.ts                   # AppVerkCommitPlugin
      bash-policy.ts
      controlled-commit.ts
      message-policy.ts
  hooks/
    session-notification/        # unchanged
      plugin.ts
      env-config.ts
      idle-scheduler.ts
      notification-sender.ts
      session-notification.ts
      session-tracker.ts
  commands/
    commit.md                    # moved from packages/commit/src/commands/
  agents/                        # empty for now (populated when coordinator migrates)
  skills/                        # empty for now (populated when *-developer packages migrate)
tests/
  modules/
    commit/
      bash-policy.test.ts
      controlled-commit.integration.test.ts
      message-policy.test.ts
      plugin.test.ts
  hooks/
    session-notification/        # unchanged
dist/                            # build output, committed (same convention as workspaces)
  index.js
  index.d.ts
  modules/
    commit/
      index.js
      index.d.ts
      bash-policy.js
      bash-policy.d.ts
      controlled-commit.js
      controlled-commit.d.ts
      message-policy.js
      message-policy.d.ts
  hooks/
    session-notification/
      *.js + *.d.ts            # 1:1 mirror of src/hooks/session-notification/
  commands/
    commit.md
```

Note the 1:1 mirror — `bundle: false` (see [Build Pipeline](#build-pipeline)) produces one `.js` per `.ts` rather than a single bundled `dist/index.js`.

## Build Pipeline

### `tsup.root.config.ts` (new file, root)

```ts
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.{test,spec}.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  bundle: false,
  target: "es2022",
  sourcemap: false,
})
```

The `!src/**/*.{test,spec}.ts` exclusion is defensive — tests currently live under top-level `tests/`, but the exclusion future-proofs against contributors who place colocated tests under `src/`.

**`bundle: false` is deliberate.** With bundling enabled, tsup would inline every workspace `dist/` it follows from `src/index.ts` into a single `dist/index.js`. That would force two changes:

1. **Build-order flip.** Workspaces would need to be built before the root in `npm run build`, otherwise the root bundle inlines stale workspace `dist/`. Today the root is built first.
2. **Double-bundling.** Every workspace's code would ship twice — once in `packages/*/dist/` and again inside `dist/index.js`.

Both problems disappear once every workspace is absorbed, but for the transitional stages they're real costs. `bundle: false` produces a 1:1 file mapping (`src/x/y.ts` → `dist/x/y.js`) like `tsc`, while still giving us tsup's nicer config, `.d.ts` emission, and watch mode. Runtime semantics stay identical to today: workspace `dist/` files are resolved at load time, not at build time.

ESM format with type declarations. `clean: true` wipes `dist/` on each build.

### `scripts/copy-root-assets.mjs` (new file, root)

Copies `.md` assets from `src/` to `dist/`, preserving the relative path. Processes:
- `src/commands/**/*.md` → `dist/commands/**/*.md`
- `src/agents/**/*.md` → `dist/agents/**/*.md` (no-op until coordinator migrates)
- `src/skills/**/*.md` → `dist/skills/**/*.md` (no-op until developer packages migrate)

Must be a no-op (not an error) when source directories are empty or absent.

### `package.json` changes (root) — end state after both commits

The table below shows the **final** state. Each commit owns part of it; per-commit deltas are in [Migration Sequence](#migration-sequence).

| Field | Before | After (end state) | Commit |
|---|---|---|---|
| `main` | `./src/index.js` | `./dist/index.js` | Commit 1 |
| `types` | `./src/index.d.ts` | `./dist/index.d.ts` | Commit 1 |
| `files` | includes `src` | replaces `src` with `dist`; drops `packages/commit/dist` | Commit 1 (src→dist) + Commit 2 (drop commit entry) |
| `scripts.build:root` | `find src -delete && tsc ... && cp ... && rm` | `tsup --config tsup.root.config.ts && node scripts/copy-root-assets.mjs` | Commit 1 |
| `scripts.build` | chains `@appverk/opencode-commit` | drops `@appverk/opencode-commit` from the chain | Commit 2 |
| `scripts.test` | chains `@appverk/opencode-commit` | drops it | Commit 2 |
| `scripts.typecheck` | chains `@appverk/opencode-commit` | drops it | Commit 2 |
| `workspaces` | `["packages/*"]` glob | unchanged if it's a glob; otherwise drop explicit `packages/commit` entry | Commit 2 |

### `.gitignore` changes

- Remove `!packages/commit/dist/` and `!packages/commit/dist/**` (package gone).
- Add `!dist/` and `!dist/**` (root `dist/` committed, matching workspace convention).

### Removed files

- `tsconfig.build.json` — replaced by `tsup.root.config.ts`.

## Path Resolution

After migration, `commit.md` lives at:
- **Build output:** `dist/commands/commit.md` (target).
- **Source (dev fallback):** `src/commands/commit.md`.

Because the build uses `bundle: false`, `dist/modules/commit/index.js` is a real file (mirroring `src/modules/commit/index.ts`). At runtime `import.meta.url` resolves to `<repo>/dist/modules/commit/index.js`, so:

```ts
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const packagedCommandPath = path.resolve(moduleDirectory, "../../commands/commit.md")
const sourceCommandPath = path.resolve(moduleDirectory, "../../../src/commands/commit.md")
```

The `../../` reflects climbing out of `dist/modules/commit/` back to `dist/`. For the dev fallback (running tests, where the import target is `src/modules/commit/index.ts`), `../../../` climbs out of `src/modules/commit/` back to the repo root, then into `src/commands/`.

The dev fallback exists for two reasons:
1. Tests import `src/modules/commit/index.ts` directly (un-built). `import.meta.url` points to the source file, so `dist/commands/commit.md` may not yet exist — fallback finds it under `src/`.
2. Local development before a build — the file in `src/` is the source of truth.

## Migration Sequence

Two atomic commits, each independently passing `npm run check`, each independently revertible.

### Commit 1 — Root cleanup

Pure infrastructure move; no plugin code is moved or modified.

**Pre-flight:**

- `git status` clean on the working branch's baseline (so any failure is attributable to the migration, not pre-existing drift).
- `npm run check` green on the baseline branch.

**Steps:**

1. Add `tsup.root.config.ts` in the root.
2. Add `scripts/copy-root-assets.mjs`.
3. Update `package.json`: change `main`, `types`, `files` (replace `"src"` with `"dist"`, keep all `packages/*/dist` entries), and the `build:root` script.
4. Update `.gitignore`: un-ignore root `dist/`.
5. Delete `tsconfig.build.json`.
6. **Update `scripts/verify-dist-sync.mjs`:** in the `trackedDistPaths` array, remove the now-stale `"src/index.js"`, `"src/index.d.ts"`, `"src/hooks"` entries and add `"dist"` as the new root output path. (Keep all `packages/*/dist` entries — those still need verifying.) Side note: `packages/qa/dist` is missing from the list — that is a pre-existing bug, **out of scope** for this stage; do not fix it here.
7. **Update `tests/root-plugin.test.ts`:**
   - In the `expect(packageJson.files).toEqual(expect.arrayContaining([...]))` block, change `"src"` to `"dist"` (keep all workspace entries including `"packages/commit/dist"` — Commit 2 will drop that one).
   - In the `expect(packedFiles).toEqual(expect.arrayContaining([...]))` block:
     - `"src/index.js"` → `"dist/index.js"`
     - `"src/index.d.ts"` → `"dist/index.d.ts"`
     - All 12 `"src/hooks/session-notification/*.js"` and `*.d.ts` paths → `"dist/hooks/session-notification/*.js"` and `*.d.ts`
     - Leave the `packages/*/dist/...` paths untouched — Commit 2 handles `packages/commit/`.
8. Run `npm run build:root` to produce the new `dist/`.
9. Delete the now-stale compiled artefacts from `src/`:
   - `src/index.js`, `src/index.d.ts`
   - `src/hooks/session-notification/*.js`
   - `src/hooks/session-notification/*.d.ts`
10. **Verify `dts` emission worked for every entry under `bundle: false`:** confirm `dist/index.d.ts`, `dist/hooks/session-notification/*.d.ts` all exist. tsup's `bundle: false` + `dts: true` + glob entries is type-system-supported but **not empirically verified for this repo**; if dts is missing or slow/broken, fall back to adding `tsc --emitDeclarationOnly -p tsconfig.json` as a chained build step (see Risks).
11. Commit `dist/`.

**Validation (must all pass before commit):**

- `npm run typecheck` green.
- `npm run test` green.
- `npm run build` green.
- `ls src/` shows no `.js` or `.d.ts` files.
- `ls dist/` shows `index.js` and `index.d.ts`.
- **Manual:** restart OpenCode, run any workspace slash-command (e.g. `/commit`, `/python`, `/review`) — works. This proves OpenCode picks up the new `main` from `package.json`.

**Risks:**

| Risk | Mitigation |
|---|---|
| OpenCode caches old `./src/index.js` path beyond just process memory | Restart OpenCode first; if `/commit` is missing post-restart, clear any OpenCode plugin cache (e.g. `~/.cache/opencode` or `~/.local/share/opencode`, platform-dependent). The OpenCode CLI loader is not in this repo, so cache behavior is not verifiable here. |
| `tsup` emits files in a different shape than current `tsc` (file count, layout) | `bundle: false` is designed for 1:1 mapping like `tsc`. After build, verify `dist/` layout mirrors `src/`. Smoke test the `session-notification` hook (it relies on `import.meta.url`). |
| **tsup `bundle: false` + `dts: true` + glob entries** is type-supported but not empirically validated for this codebase. Per-entry dts generation can be slow or unreliable. | Step 10 explicitly verifies dts emission. If dts is missing or unworkable, fall back to `tsc --emitDeclarationOnly -p tsconfig.json` chained after the tsup invocation in `build:root`. |
| `scripts/verify-dist-sync.mjs` references paths that no longer exist after cleanup | Step 6 handles this — remove `src/index.js`, `src/index.d.ts`, `src/hooks` and add `dist`. |
| `tests/root-plugin.test.ts` hardcodes `src/index.js`, `src/index.d.ts`, and `src/hooks/session-notification/*.{js,d.ts}` paths | Step 7 handles this — switch the assertions to `dist/` paths. |

**End state of Commit 1:**
- `src/index.ts` exists; `src/index.js`, `src/index.d.ts` do **not**.
- `src/hooks/session-notification/` contains only `.ts`.
- `dist/index.js` and `dist/index.d.ts` exist, committed.
- `packages/commit/` **unchanged** — root still imports it from `../packages/commit/dist/index.js`.

### Commit 2 — Pilot absorption (`commit` package)

**Pre-flight:**

- Commit 1 is on the branch and `npm run check` is green.
- `git status` clean (modulo intentional uncommitted spec/plan files).

**Pre-flight grep:**

```
grep -rn "@appverk/opencode-commit" . --include='*.{ts,js,md,json,mjs}' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  --exclude-dir=packages
```

(Wider than the original `packages/ src/ tests/` scope — we know from agent-verified fact-checking that `AGENTS.md`, `README.md`, root `package.json`, and `tests/root-plugin.test.ts` also reference `@appverk/opencode-commit`. The grep must surface all of them so nothing is missed.)

Confirm no consumer outside the locations listed in the steps below imports the package. If something does, the spec must be updated to handle it.

**Steps:**

1. Create directories: `src/modules/commit/`, `src/commands/`, `tests/modules/commit/`.
2. `git mv` source files:
   - `packages/commit/src/index.ts` → `src/modules/commit/index.ts`
   - `packages/commit/src/bash-policy.ts` → `src/modules/commit/bash-policy.ts`
   - `packages/commit/src/controlled-commit.ts` → `src/modules/commit/controlled-commit.ts`
   - `packages/commit/src/message-policy.ts` → `src/modules/commit/message-policy.ts`
3. `git mv` asset: `packages/commit/src/commands/commit.md` → `src/commands/commit.md`.
4. Update path resolution in `src/modules/commit/index.ts` — change the asset paths to `"../../commands/commit.md"` (packaged) and `"../../../src/commands/commit.md"` (dev fallback). See [Path Resolution](#path-resolution) for the rationale.
5. `git mv` tests:
   - `packages/commit/tests/bash-policy.test.ts` → `tests/modules/commit/bash-policy.test.ts`
   - `packages/commit/tests/controlled-commit.integration.test.ts` → `tests/modules/commit/controlled-commit.integration.test.ts`
   - `packages/commit/tests/message-policy.test.ts` → `tests/modules/commit/message-policy.test.ts`
   - `packages/commit/tests/plugin.test.ts` → `tests/modules/commit/plugin.test.ts`
6. **Do not migrate** `packages/commit/tests/build-output.test.ts` and `packages/commit/tests/package-smoke.test.ts`:
   - `package-smoke.test.ts` (export-shape smoke) is already covered by `tests/root-plugin.test.ts:33-48`. Drop with the package.
   - `build-output.test.ts` (asserts `dist/commands/commit.md` exists post-build and the lazy template loader reads back its content) is **not redundant** — it's the only automated check on the asset-copy + path-resolution invariant. A replacement is required: see step 14 below.
7. Update import paths inside the migrated tests. Concrete renames (verified against actual sources):
   - `bash-policy.test.ts`: `from "../src/bash-policy.js"` → `from "../../../src/modules/commit/bash-policy.js"`
   - `controlled-commit.integration.test.ts`: `from "../src/controlled-commit.js"` → `from "../../../src/modules/commit/controlled-commit.js"`
   - `message-policy.test.ts`: `from "../src/message-policy.js"` → `from "../../../src/modules/commit/message-policy.js"`
   - `plugin.test.ts`: `from "../src/index.js"` → `from "../../../src/modules/commit/index.js"`
8. Update `src/index.ts` (root):
   ```ts
   // before
   import { AppVerkCommitPlugin } from "../packages/commit/dist/index.js"
   // after
   import { AppVerkCommitPlugin } from "./modules/commit/index.js"
   ```
9. `git rm -r packages/commit/` (also removes `packages/commit/scripts/copy-command-template.mjs` — its functionality is covered by `scripts/copy-root-assets.mjs` in the root).
10. Clean root `package.json`:
    - Remove `packages/commit/dist` from `files`.
    - Remove `@appverk/opencode-commit` from all script chains (`build`, `test`, `typecheck`).
    - **Optional:** bump root `version` (current `0.2.16`) to invalidate `bun install` / npm cache for `git+https` consumers — see `AGENTS.md` "External Tarball Install" section.
11. **`npm install`** — regenerates `package-lock.json` (drops the `@appverk/opencode-commit` workspace symlink in `node_modules/`). Commit the updated lockfile.
12. Clean `.gitignore`: remove `!packages/commit/dist/` and `!packages/commit/dist/**`.
13. **Update `tests/root-plugin.test.ts`:** in the `expect(packedFiles).toEqual(expect.arrayContaining([...]))` block:
    - Remove `"packages/commit/dist/index.js"`, `"packages/commit/dist/index.d.ts"`, `"packages/commit/dist/commands/commit.md"`.
    - Add `"dist/modules/commit/index.js"`, `"dist/modules/commit/index.d.ts"`, `"dist/commands/commit.md"`.
    
    In the `expect(packageJson.files).toEqual(expect.arrayContaining([...]))` block: remove `"packages/commit/dist"` from the expected list.
14. **Create `tests/modules/commit/build-output.test.ts`** — replaces the deleted `build-output.test.ts`. After running the build (or assuming a fresh build), assert:
    - `dist/commands/commit.md` exists.
    - File contains the expected markers (`## Context`, `Use the \`av_commit\` tool`).
    - Loading `dist/modules/commit/index.js`, calling `AppVerkCommitPlugin().config()` resolves the template via the **packaged path** (`"../../commands/commit.md"`), not the dev fallback. The simplest way is to assert the resolved template content matches the file content.
    
    This is the only automated guard catching a wrong path constant in step 4; without it only the manual OpenCode smoke test would notice.
15. Update `scripts/verify-dist-sync.mjs`: remove `"packages/commit/dist"` from `trackedDistPaths`.
16. Clean other references:
    - `docs/plugins/commit.md` — update pointers from `packages/commit/src/...` and `packages/commit/dist/...` to `src/modules/commit/...` and `dist/modules/commit/...`.
    - `AGENTS.md` — concrete edits:
      - **Line 10 (layout table row for `packages/commit`):** remove the row; optionally add a `src/modules/commit/` row describing the new pattern.
      - **Lines 41-42 (build/test command examples):** drop the `npm run … --workspace @appverk/opencode-commit` example, or replace with a note that root `npm run check` covers the pilot.
      - **Line 63 (integration test path):** update from `packages/commit/tests/controlled-commit.integration.test.ts` → `tests/modules/commit/controlled-commit.integration.test.ts`.
      - **Lines 73-96 ("Root Entrypoint Registration"):** rewrite — `src/index.js` no longer exists as a source file (build output is in `dist/`), and the absorbed `commit` plugin is imported from `./modules/commit/index.js`, not `../packages/commit/dist/index.js`. Document the new pattern.
      - **Lines 162-178 ("Adding a New Plugin Package"):** add a parallel sub-section documenting the new `src/modules/<name>/` pattern, since absorbed modules are no longer workspaces.
      - **Line 208 ("Common Pitfalls"):** reconcile — removing `packages/commit/dist` is exactly what Commit 2 does, so the pitfall warning must be scoped to the **remaining** workspace dists.
    - `README.md` — update the "Repository Structure" section and any link to the commit plugin guide.

**Validation (must all pass before commit):**

- `npm run typecheck` green.
- `npm run test` green; specifically the 5 test files now under `tests/modules/commit/` (4 migrated + 1 new `build-output.test.ts`) and the updated `tests/root-plugin.test.ts`.
- `npm run build` green; `dist/modules/commit/index.js` exists and exports `AppVerkCommitPlugin` (`grep -l "AppVerkCommitPlugin" dist/modules/commit/index.js`).
- `dist/commands/commit.md` exists.
- `packages/commit/` does not exist.
- `node_modules/@appverk/opencode-commit` symlink no longer exists (proves `npm install` cleaned the workspace symlink).
- `package-lock.json` no longer references `@appverk/opencode-commit`.
- **Manual:** restart OpenCode, run `/commit` in a repo with uncommitted changes — slash-command starts, template loads, flow executes. This proves (a) plugin registration, (b) path resolution against the built `dist/`.
- **Dev fallback:** the new `build-output.test.ts` covers the packaged path; the existing `plugin.test.ts` exercises the dev fallback by importing source.

**Risks:**

| Risk | Mitigation |
|---|---|
| Another workspace or doc silently imports `@appverk/opencode-commit` | Pre-flight grep is now broader (excludes only `node_modules`, `.git`, `dist`, `packages`); known consumers are enumerated in the steps. Verified by agent fact-check: only consumers are `package.json`, `AGENTS.md`, `tests/root-plugin.test.ts`. |
| `plugin.test.ts` assumes `packages/commit/dist` layout | Step 7 updates the import path; step 14's new `build-output.test.ts` covers asset resolution. |
| `import.meta.url` in tests points to source files (un-built `src/modules/commit/index.ts`), not to the built `dist/` output | Dev fallback path (`../../../src/commands/commit.md`) handles tests. The new `build-output.test.ts` (step 14) drives the packaged-path branch explicitly so both code paths are exercised by CI. |
| `controlled-commit.integration.test.ts` is environment-sensitive (real git) | No change to its logic — only the import path in step 7. |
| Lockfile drift after `git rm -r packages/commit/` | Step 11 runs `npm install` and commits the regenerated lockfile. |
| Stale Bun / npm cache on `git+https` consumers of root | Step 10 (optional) bumps version; otherwise consumers must clear their cache (see `AGENTS.md` external-install guidance). |

**End state of Commit 2:**
- `packages/commit/` removed.
- `src/modules/commit/` holds 4 TS files.
- `src/commands/commit.md` in place.
- `tests/modules/commit/` holds 4 tests.
- `dist/modules/commit/` contains the compiled plugin; `dist/commands/commit.md` copied.
- `npm run check` green.
- OpenCode runs `/commit` end-to-end from the root build.

## Rollback Strategy

Each commit is independently revertible:

- **Revert Commit 1:** restores `src/index.js`, `src/hooks/session-notification/*.{js,d.ts}`, removes the root `dist/`, restores old `package.json` and old `tsconfig.build.json`, restores old `scripts/verify-dist-sync.mjs` and `tests/root-plugin.test.ts` assertions. OpenCode reverts to loading `./src/index.js`.
- **Revert Commit 2:** restores `packages/commit/` with its workspace registration, restores `tests/root-plugin.test.ts` packages-commit assertions, restores `package-lock.json`. Run `npm install` after the revert to re-create the `node_modules/@appverk/opencode-commit` workspace symlink. Reverting Commit 2 does **not** revert Commit 1 — root stays on the new `dist/` layout, which is independently valid.

## CI / Pre-commit Considerations

- `npm run check` must pass after each commit (bisectable history).
- This repository currently has **no `.github/workflows/` and no `.husky/` (or other) pre-commit hooks** (verified by agent inspection). Nothing to update. The "pre-commit hook" mentioned colloquially around `AV_COMMIT_SKILL=1` is the **runtime** `tool.execute.before` hook inside `AppVerkCommitPlugin`, which Commit 2 preserves intact (the same plugin code, just at a new location).
- `scripts/verify-dist-sync.mjs` is the in-repo drift detector; it's updated explicitly in Commit 1 step 6 and Commit 2 step 15.

## Future Phases (informative, not part of this spec)

Suggested ordering for subsequent absorptions, each in its own spec/plan:

| Stage | Package | Rationale |
|---|---|---|
| 2 | `skill-utils` | Shared library — early migration minimises iterations of import updates in consumers. |
| 3 | `skill-registry` | Utility-grade, likely pairs with `skill-utils`. |
| 4 | `code-review` | Medium complexity, good second "real" plugin after `commit`. |
| 5 | `qa` | Medium complexity, well-tested. |
| 6 | `swift-developer` | Smaller of the developer-style plugins. |
| 7 | `python-developer` | Large, many skills — exercises `src/skills/` copy at scale. |
| 8 | `frontend-developer` | Similar to python-developer. |
| 9 | `coordinator` | Last — most complex, has agents and tools, requires `src/agents/` workflow. |

Decisions deferred to those phases:
- Whether `src/modules/<pkg>/` continues to be the right grouping or needs sub-grouping.
- How cross-module tests live in `tests/`.
- Whether `packages/` is removed entirely once empty.
- Naming: `modules/` vs `plugins/` vs `features/` — revisit after stage 1 lands.
- Future npm publication strategy.

**Guardrail:** if any stage shows the `src/modules/` pattern doesn't scale, halt and re-brainstorm. Don't propagate a broken pattern.
