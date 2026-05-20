# AppVerk OpenCode Plugins — Agent Guide

This is an **OpenCode plugin monorepo** that bundles multiple workspace plugins (a Python `/python` workflow, a TypeScript + React `/frontend` workflow, a Swift `/swift` workflow, a `/review` code review workflow, a QA testing workflow (`/create-qa-plan`, `/run-qa`), a Pantheon coordinator plugin (`@perun` primary agent with `dispatch_parallel` and `assign_issue_ids` tools), and shared `skill-utils` helpers), plus absorbed modules under `src/modules/<name>/` (currently: `commit`) and a Pantheon session-notification hook (`src/hooks/session-notification/`). The root package re-exports all of them and handles plugin merging.

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
| `packages/qa` | QA plugin — end-to-end testing workflow. Registers `/create-qa-plan` and `/run-qa` commands, plus `qa-fe-tester` and `qa-be-tester` subagents. Ships with test-plan-format, report-format, fe-testing, and be-testing skills. Output shipped at `packages/qa/dist/`. |
| `packages/swift-developer` | Swift-developer plugin source, tests, skills, build scripts. Output shipped at `packages/swift-developer/dist/`. |
| `packages/coordinator` | Coordinator plugin source — Pantheon `@perun` primary agent, `dispatch_parallel` and `assign_issue_ids` tools. Output shipped at `packages/coordinator/dist/`. |
| `src/hooks/session-notification/` | **Harness-resident plugin** (not a workspace package) — Pantheon session-notification hook that triggers macOS desktop notifications on OpenCode session events. Source `.ts` and built `.js`/`.d.ts` are colocated and shipped together as part of the root `src/` tree. |
| `.opencode/` | Local OpenCode config for this repo (separate `package.json`). |

**Important:** `dist/` is usually ignored, but the **root `dist/`** and **`packages/*/dist/`** are committed and published (see `.gitignore`). Do not delete those `dist/` trees.

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
- **Published files:** The root `dist/` tree (compiled `.js`/`.d.ts` + copied `.md` assets) plus the eight remaining `packages/*/dist/` directories for each workspace plugin (see root `package.json` `files`).

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

Update these sections:

1. **Plugin count badge** — increment the number: `[![Plugins](https://img.shields.io/badge/plugins-N-blue.svg)]`
2. **Introduction paragraph** — add a one-line description of the new plugin
3. **Usage section** — add a subsection with `/command` example and what it does
4. **Available Commands & Agents table** — add rows for the new command and
   any agents. Verify each agent has the correct `mode` (`"primary"` for
   user-facing agents, `"subagent"` for background/skill agents).
5. **Repository Structure** — add `packages/<name>` and `docs/plugins/<name>.md` entries
6. **Documentation list** — add link to the new plugin guide

### `docs/plugins/<name>.md` (per-plugin guide)

Create a dedicated guide with:

1. **Installation** — "The root plugin bundle includes this package automatically."
2. **Usage** — `/command <args>` syntax with examples
3. **What it does** — step-by-step breakdown of the workflow
4. **Direct agent use** — `opencode agent <agent-name> "..."` examples (if applicable)
5. **Architecture** — table of registered elements (commands, agents, tools) and their purposes
6. **Limitations** — known MVP limitations or deferred features
7. **Project Structure** — list of key source files

---

## Adding a New Plugin Package

1. Create `packages/<name>/` with `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, and `tests/`.
2. Add the workspace name to root `package.json` `workspaces` (already `packages/*`).
3. **Import and register the new plugin factory in `src/index.ts`.** See [Root Entrypoint Registration](#root-entrypoint-registration) above.
4. Add the new `packages/<name>/dist/` path to root `package.json` `files`.
5. Update root `npm run build` / `npm run test` / `npm run typecheck` scripts to include the new workspace.
6. Add a smoke/packaging test in `tests/` or `packages/<name>/tests/`.
7. **Update `README.md`** following the [Documentation Checklist](#documentation-checklist).
8. **Create `docs/plugins/<name>.md`** following the per-plugin guide template.
9. **Update this `AGENTS.md`** — increment plugin counts, add new rows to layout table, update published files count.
10. **Add a `.gitignore` exception** for the new package's `dist/` directory:
    ```gitignore
    !packages/<name>/dist/
    !packages/<name>/dist/**
    ```
    Then run `git add packages/<name>/dist/` so the built output is committed. Without this, installing the plugin from git will fail with `Cannot find module` because the consumer has no built files.

---

## Adding a New Absorbed Module

For small absorbed modules (no separate workspace), follow this pattern instead:

> **Canonical reference:** The `src/` TypeScript absorption program is documented in
> [`docs/superpowers/specs/2026-05-20-src-typescript-migration-commit-pilot-design.md`](docs/superpowers/specs/2026-05-20-src-typescript-migration-commit-pilot-design.md)
> (design rationale: `bundle: false`, build-order constraints, `tsup.root.config.ts` filename) and
> [`docs/superpowers/plans/2026-05-20-src-typescript-migration-commit-pilot.md`](docs/superpowers/plans/2026-05-20-src-typescript-migration-commit-pilot.md)
> (staged execution plan — Stage 1 of N is the `commit` pilot). Read both before starting a new absorption stage so future work does not re-derive or contradict these decisions.

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

## Common Pitfalls

- Do not run `git commit` or `git push` via the bash tool in this repo — the commit plugin blocks direct commits and pushes at runtime (`tool.execute.before` hook). Use `/commit` instead. This bash gate (`classifyBashCommand` in `src/modules/commit/bash-policy.ts`) is **defense-in-depth / a workflow rail, not a security boundary** — it keeps the `/commit` workflow consistent but is bypassable by shapes the literal `git` token-match misses (`/usr/bin/git …`, `bash -c "git …"`, `hub commit`, `command git …`, alias indirection, `$(echo git) commit`, plumbing subcommands like `commit-tree` / `fast-import` / `update-ref`). Per project doctrine ([`docs/plugins/coordinator.md`](docs/plugins/coordinator.md): *"Treat code-enforced rules as the security boundary. The LLM-requested rules are defense in depth — they raise the cost of a successful prompt-injection escalation but are not the last line of defense."*), real shell-execution boundaries live outside this plugin. See [`docs/plugins/commit.md`](docs/plugins/commit.md#classifybashcommand-is-defense-in-depth-not-a-security-boundary) for the full bypass list.
- After changing anything under `src/`, run `npm run build:root` to regenerate `dist/` — published consumers and OpenCode load from `dist/`, not `src/`.
- Removing a workspace `packages/<name>/dist/` will break the root entrypoint and packaging tests. (The root `dist/` is also committed — do not delete it manually; let `npm run build:root` regenerate it.)
- **Forgetting to add a `.gitignore` exception and commit `packages/<name>/dist/`** will cause `Cannot find module` errors for consumers installing from git, because npm does not run the build step on git dependencies.
