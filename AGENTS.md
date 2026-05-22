# AppVerk OpenCode Plugins — Agent Guide

This is an **OpenCode plugin monorepo** that bundles multiple workspace plugins (a Python `/python` workflow, a TypeScript + React `/frontend` workflow, a Swift `/swift` workflow, a `/review` code review workflow, and shared `skill-utils` helpers), plus absorbed modules under `src/modules/<name>/` (currently: `commit`, `qa` — the `/create-qa-plan` + `/run-qa` workflow with the `zmora` logical agent, `pantheon-config` — the harness configuration library, and `coordinator` — the Pantheon `@perun` primary agent with `dispatch_parallel` and `assign_issue_ids` tools) and a Pantheon session-notification hook (`src/hooks/session-notification/`). The root package re-exports all of them and handles plugin merging.

## Monorepo Layout

| Path | Role |
|------|------|
| `src/index.ts` | **Root entrypoint** (TypeScript source) — loads built outputs from all workspace packages plus absorbed modules under `src/modules/`, merges their tools/hooks. Built into `dist/index.js` for runtime. |
| `src/modules/commit/` | Absorbed commit plugin — TS source only. Asset: `src/commands/commit.md`. Tests: `tests/modules/commit/`. Built into `dist/modules/commit/` and `dist/commands/`. |
| `packages/python-developer` | Python-developer plugin source, tests, skills, build scripts. Output shipped at `packages/python-developer/dist/`. |
| `packages/code-review` | Code-review plugin source, tests, agent prompts, command templates, skill-agents, build scripts. Output shipped at `packages/code-review/dist/`. All agents and commands automatically load the `standards-discovery` skill during pre-analysis to discover project-specific standards before reviewing. |
| `packages/frontend-developer` | Frontend-developer plugin source, tests, skills, build scripts. Output shipped at `packages/frontend-developer/dist/`. |
| `packages/skill-utils` | Shared helpers for creating skill-based plugins. Output shipped at `packages/skill-utils/dist/`. |
| `packages/skill-registry` | Global skill registry — scans skill folders, parses frontmatter, registers unified `load_appverk_skill` tool, injects activation rules into every agent's system prompt. Output shipped at `packages/skill-registry/dist/`. |
| `src/modules/qa/` | Absorbed QA plugin — TS source only. Assets: `src/commands/{create-qa-plan,run-qa}.md`, `src/skills/qa/**`, `src/modules/qa/prompt-sections/*.md`. Registers two `zmora-{fe,be}` subagent variants composed via `prompt-builder.ts`; logical agent name `zmora` everywhere user-facing. Tests: `tests/modules/qa/`. Built into `dist/modules/qa/`, `dist/commands/`, `dist/skills/qa/`. |
| `packages/swift-developer` | Swift-developer plugin source, tests, skills, build scripts. Output shipped at `packages/swift-developer/dist/`. |
| `src/modules/coordinator/` | Absorbed coordinator plugin — TS source only. Asset: `src/agents/perun.md`. Registers `dispatch_parallel` (worker pool, concurrency 4, cap 50) and `assign_issue_ids` tools alongside the `@perun` primary agent. Tests: `tests/modules/coordinator/`. Built into `dist/modules/coordinator/` and `dist/agents/`. |
| `src/modules/pantheon-config/` | Harness-resident **library** (no plugin export) — reads `pantheon.json` (user-global + per-project walk-up, closest-wins merge) and exposes `loadPantheonConfig()` / `getLoadErrors()` / `pantheonConfigEmpty()`. Consumed by `coordinator/` and `qa/` in their `config` hooks. Tests: `tests/modules/pantheon-config/`. Built into `dist/modules/pantheon-config/`. |
| `src/hooks/session-notification/` | **Harness-resident plugin** (not a workspace package) — Pantheon session-notification hook that triggers macOS desktop notifications on OpenCode session events. Source `.ts` and built `.js`/`.d.ts` are colocated and shipped together as part of the root `src/` tree. |
| `.opencode/` | Local OpenCode config for this repo (separate `package.json`). |

**Important:** `dist/` is usually ignored, but the **root `dist/`** and **`packages/*/dist/`** are committed and published (see `.gitignore`). Do not delete those `dist/` trees.

## Pantheon harness configuration

Per-agent model selection lives in `pantheon.json`. See [`docs/configuring-agents.md`](docs/configuring-agents.md) for the user-facing reference.

## Commands

```bash
# Full validation (run this before pushing)
npm run check          # typecheck + test + build

# Individual steps
npm run typecheck      # tsc --noEmit at root + each workspace
npm run test           # vitest at root + each workspace
npm run build          # tsup ESM + DTS for all packages
```

### Per-package commands

Each workspace package has its own `typecheck`, `test`, and `build` scripts. Tests import from `dist/` (not `src/`), so **build is required before test**:

```bash
npm run build --workspace @appverk/opencode-python-developer
npm run test  --workspace @appverk/opencode-python-developer
```

Note: absorbed modules (e.g. `src/modules/commit/`) build and test via the **root** `npm run build:root` / `npm run test` — they no longer have a per-workspace script.

## Build & Packaging Details

- **Module system:** ESM only (`"type": "module"`, NodeNext resolution).
- **Package builds:** `tsup src/index.ts --format esm --dts`.
- **Post-build asset copying:** Each package runs a Node script to copy markdown templates/skills into `dist/` (e.g., `dist/commands/commit.md`, `dist/skills/*.md`).
- **Root entrypoint:** `src/index.ts` is the typed source. The root build (`npm run build:root`) compiles it (and everything under `src/`) to `dist/` via `tsup --bundle=false`. OpenCode loads `./dist/index.js` (the `main` field in root `package.json`). There is no longer a hand-edited `src/index.js`.
- **Published files:** The root `dist/` tree (compiled `.js`/`.d.ts` + copied `.md` assets — this is where every absorbed module under `src/modules/` lands) plus the remaining `packages/*/dist/` directories for each workspace plugin — see root `package.json` `files` for the canonical list.

### Tracked dist paths in CI

`scripts/verify-dist-sync.mjs` is the **source of truth** for which `dist/` trees are checked for drift after `npm run build`. The `trackedDistPaths` array in that script must stay in sync with:

- The `files` array in the root `package.json` (everything published must be verified).
- The `.gitignore` carve-outs for each `packages/<name>/dist/` (everything verified must be committed).
- The per-workspace `build` invocations in the root `build` script (everything verified must actually be built).

When adding a new workspace plugin, update **all four** locations together. If any are out of sync, CI will either silently pass on dist drift (path missing from the script) or fail permanently (path tracked but never built/committed).

## TypeScript Configuration

- `tsconfig.base.json` sets `target: ES2022`, `module: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`.
- Each package extends the base and includes `src/**/*.ts`, `tests/**/*.ts`, `vitest.config.ts`.
- Vitest uses globals mode (`types: ["vitest/globals"]`).

## Testing Conventions

- **Root tests:** `tests/root-plugin.test.ts` validates plugin merging and packaging via `npm pack --dry-run`.
- **Package tests:** Located in `packages/*/tests/**/*.test.ts`.
- **Integration tests:** `tests/modules/commit/controlled-commit.integration.test.ts` exercises real git operations.
- All workspace vitest configs use `include: ["tests/**/*.test.ts"]`.

## Root Entrypoint Registration

Every new plugin must be imported and registered in `src/index.ts`. The build (`npm run build:root`) produces `dist/index.js` from it; nothing is hand-edited under `dist/`.

### Workspace plugin import

```typescript
import { AppVerkNewPlugin } from "../packages/<name>/dist/index.js"

const defaultPluginFactories: Plugin[] = [
  AppVerkPythonDeveloperPlugin,
  AppVerkCodeReviewPlugin,
  AppVerkNewPlugin,  // <-- add here
]
```

### Absorbed module import

For plugins absorbed into `src/modules/<name>/`:

```typescript
import { AppVerkCommitPlugin } from "./modules/commit/index.js"
```

### Harness-resident hook import

For hooks under `src/hooks/<name>/`:

```typescript
import { AppVerkPantheonPlugin } from "./hooks/session-notification/plugin.js"
```

All three patterns import a built `.js` file at runtime (Node ESM resolution). For workspace plugins, the built file lives in `packages/<name>/dist/`. For absorbed modules and hooks, the build emits to `dist/modules/<name>/` and `dist/hooks/<name>/` — referenced via the source-side `.js` extension which Node resolves at runtime.

## Agent Visibility (`mode`)

OpenCode agents support a `mode` property that controls tab-completion visibility:

- **`mode: "primary"`** — User-facing agent. Appears in tab-completion and is
  intended for direct user interaction. Use this for agents that users invoke
  directly, such as `python-developer`.
- **`mode: "subagent"`** — Hidden agent. Excluded from tab-completion;
  intended to be invoked programmatically by commands or other agents. Use this
  for skill-agents and background workers, such as `fix-auto` or
  `security-auditor`.

If `mode` is omitted, OpenCode defaults to `"all"` (visible everywhere). Always
set an explicit `mode` when registering an agent to avoid unnecessary
tab-completion noise or accidentally hiding user-facing agents.

---

## Documentation Checklist

When adding a new plugin, you MUST update both top-level and per-plugin documentation. An undocumented plugin is an unpublished plugin.

### `README.md` (root)

The README is harness-first (Pantheon agents + configuration). When you add a new piece:

1. **If it is user-facing in the harness** (a new primary agent, a new subagent surfaced through Perun, or a new configuration surface), add a short entry under "What you get today" and link to its detailed reference under `docs/`.
2. **If it is plumbing** (a new library module like `pantheon-config`, a new dispatch primitive, a hook), update `AGENTS.md`'s monorepo-layout table — do not add to the README. The README is not a system-architecture diagram.

Do **not** maintain a plugin badge, a comprehensive command/agent table, or per-plugin marketing copy. Those constructs were retired with the harness pivot.

### `docs/<topic>.md` (harness reference)

For user-facing harness concerns (e.g. configuration, agent reference, workflow guides), write a dedicated topic doc directly under `docs/`. `docs/configuring-agents.md` is the first of these.

> Do **not** add new files under `docs/plugins/`. That tree is legacy and will be removed once the harness migration completes.

---

## Adding a New Plugin Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, and `tests/`.
2. Add the workspace name to root `package.json` `workspaces` (already `packages/*`).
3. **Import and register the new plugin factory in `src/index.ts`.** See [Root Entrypoint Registration](#root-entrypoint-registration) above.
4. Add the new `packages/<name>/dist/` path to root `package.json` `files`.
5. Update root `npm run build` / `npm run test` / `npm run typecheck` scripts to include the new workspace.
6. Add a smoke/packaging test in `tests/` or `packages/<name>/tests/`.
7. **Update `README.md` and contributor docs** following the [Documentation Checklist](#documentation-checklist). New user-facing harness surfaces get a topic doc under `docs/` (e.g. `docs/configuring-agents.md`); do **not** add new files under `docs/plugins/` (that tree is legacy).
8. **Update this `AGENTS.md`** — add a row to the monorepo-layout table; update published files count.
9. **Add a `.gitignore` exception** for the new package's `dist/` directory:
    ```gitignore
    !packages/<name>/dist/
    !packages/<name>/dist/**
    ```
    Then run `git add packages/<name>/dist/` so the built output is committed. Without this, installing the plugin from git will fail with `Cannot find module` because the consumer has no built files.

---

## Adding a New Absorbed Module

For small absorbed modules (no separate workspace), follow this pattern instead:

> **Design constraints carried over from the original src/ absorption program:**
> - **`bundle: false`** in `tsup.root.config.ts` — each module is compiled standalone so relative imports between modules keep working at runtime.
> - **Build-order matters:** the root build (`npm run build:root`) emits `dist/` from `src/` first; workspace package builds run afterwards. Modules that read assets from `dist/` (via `import.meta.url` resolution) rely on this ordering.
> - **The config filename is `tsup.root.config.ts`** (not the default `tsup.config.ts`) — this is intentional so workspace `tsup.config.ts` files are not picked up by the root build.

1. Create `src/modules/<name>/` with `index.ts` and supporting `.ts` modules.
2. Place `.md` assets under `src/commands/`, `src/agents/`, or `src/skills/` (the layout `scripts/copy-root-assets.mjs` knows about).
3. Place tests under `tests/modules/<name>/`. Import sources via `from "../../../src/modules/<name>/<file>.js"`.
4. Import and register the plugin factory in `src/index.ts` (see [Root Entrypoint Registration](#root-entrypoint-registration)).
5. Build and test via root `npm run build:root` and `npm run check` — no per-package scripts.
6. Update `tests/root-plugin.test.ts` packed-file assertions to include the new `dist/modules/<name>/*` and `dist/commands/<file>.md` paths.
7. Update `README.md` and this `AGENTS.md` per the [Documentation Checklist](#documentation-checklist).

## Versioning & Git Installation

When installing from git, OpenCode (via Bun) caches the repository and **does not automatically pull updates** when the branch moves. To ensure users receive the latest commands and agents:

1. **Bump the version** in **all** `package.json` files (root + every workspace) when adding new commands, agents, or built assets.
2. **Create a git tag** matching the version (e.g. `v0.2.8`) after the bump commit.
3. **Update installation examples** in `README.md`, `AGENTS.md`, and `.opencode/opencode.json` to reference the new tag instead of a branch name like `#master`.

Example config:
```json
{
  "plugin": [
    "av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.2.16"
  ]
}
```

If a user reports missing commands after an update, instruct them to either:
- Re-install with `opencode plugin -f av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.2.16`, or
- Remove the old cache directory manually:
  ```bash
  rm -rf ~/.cache/opencode/packages/av-opencode-plugins*
  ```

## Superpowers Artefacts

**Never link to anything under `docs/superpowers/` from source, tests, or any other documentation file.** That tree (`docs/superpowers/specs/*.md`, `docs/superpowers/plans/*.md`) holds *temporary working artefacts* produced by the brainstorming / writing-plans skills. Specs and plans get archived or deleted once their work has shipped — every link to them becomes a broken reference the moment that happens.

If a design decision needs to stay reachable after the spec is gone:

- **Inline the decision and its rationale** in the permanent doc that needs it (e.g. `AGENTS.md` for contributor patterns, `docs/<topic>.md` for user-facing reference). The *why* should live in the doc that survives.
- **Use git history** for the audit trail — `git log --follow <file>` and `git blame` are the durable record of when and why a decision was made.

Exceptions: cross-references *within* `docs/superpowers/` (a plan linking to its spec, etc.) are fine — those files are temporary together.

## Code Review Artefacts

**Never write code-review issue IDs into source or test files.** IDs like `SEC-001`, `MAINT-006`, `PERF-001`, `ARCH-002`, `COMPOSITE-3` are generated per-review by the `/review` workflow and live in `docs/reviews/*.md`. They are context-bound to a single report and become noise the moment that report is archived, regenerated, or deleted.

When applying a fix from a review:

- **Keep the technical rationale** ("treat specialist output as untrusted, then truncate by UTF-8 byte length…"). The *why* belongs in the code.
- **Drop the issue ID** ("SEC-001 / MAINT-006"). The *which-report* belongs in git history, not in the comment.
- **Keep standardised external identifiers** like `CWE-117`, `CVE-2023-…`, `OWASP A03:2025` — those are stable, cross-project references, not per-review labels.

Exceptions (these IDs are *system documentation*, not review residue, and may stay):

- `docs/plugins/code-review.md`, `README.md` — describe the ID format the plugin emits.
- `tests/modules/coordinator/assign-issue-ids.test.ts` — fixtures for the function that *generates* these IDs.
- `src/skills/qa/report-format/SKILL.md` — illustrative examples for `/fix` routing.

When in doubt: if removing the ID would make the comment less useful, the ID was load-bearing and the comment is wrong; rewrite the prose to stand on its own.

## Common Pitfalls

- Do not run `git commit` or `git push` via the bash tool in this repo — the commit plugin blocks direct commits and pushes at runtime (`tool.execute.before` hook). Use `/commit` instead. This bash gate (`classifyBashCommand` in `src/modules/commit/bash-policy.ts`) is **defense-in-depth / a workflow rail, not a security boundary** — it keeps the `/commit` workflow consistent but is bypassable by shapes the literal `git` token-match misses (`/usr/bin/git …`, `bash -c "git …"`, `hub commit`, `command git …`, alias indirection, `$(echo git) commit`, plumbing subcommands like `commit-tree` / `fast-import` / `update-ref`). Per project doctrine ([`docs/plugins/coordinator.md`](docs/plugins/coordinator.md): *"Treat code-enforced rules as the security boundary. The LLM-requested rules are defense in depth — they raise the cost of a successful prompt-injection escalation but are not the last line of defense."*), real shell-execution boundaries live outside this plugin. See [`docs/plugins/commit.md`](docs/plugins/commit.md#classifybashcommand-is-defense-in-depth-not-a-security-boundary) for the full bypass list.
- After changing anything under `src/`, run `npm run build:root` to regenerate `dist/` — published consumers and OpenCode load from `dist/`, not `src/`.
- Removing a workspace `packages/<name>/dist/` will break the root entrypoint and packaging tests. (The root `dist/` is also committed — do not delete it manually; let `npm run build:root` regenerate it.)
- **Forgetting to add a `.gitignore` exception and commit `packages/<name>/dist/`** will cause `Cannot find module` errors for consumers installing from git, because npm does not run the build step on git dependencies.
