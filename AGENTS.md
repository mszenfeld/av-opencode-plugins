# AppVerk OpenCode Plugins — Agent Guide

This is an **OpenCode plugin monorepo** that bundles multiple workspace plugins: a controlled `/commit` workflow, a Python `/python` workflow, a TypeScript + React `/frontend` workflow, a Swift `/swift` workflow, a `/review` code review workflow, a QA testing workflow (`/create-qa-plan`, `/run-qa`), a Pantheon coordinator plugin (`@perun` primary agent with `dispatch_parallel` and `assign_issue_ids` tools), and shared `skill-utils` helpers. The root package re-exports all of them and handles plugin merging.

## Monorepo Layout

| Path | Role |
|------|------|
| `src/index.js` + `src/index.d.ts` | **Published root entrypoint** — loads built outputs from all packages and merges their tools/hooks. |
| `packages/commit` | Commit plugin source, tests, build scripts. Output shipped at `packages/commit/dist/`. |
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

**Important:** `dist/` is usually ignored, but `packages/*/dist/` is **committed and published** (see `.gitignore`). Do not delete those `dist/` trees.

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
npm run build --workspace @appverk/opencode-commit
npm run test  --workspace @appverk/opencode-commit
```

## Build & Packaging Details

- **Module system:** ESM only (`"type": "module"`, NodeNext resolution).
- **Package builds:** `tsup src/index.ts --format esm --dts`.
- **Post-build asset copying:** Each package runs a Node script to copy markdown templates/skills into `dist/` (e.g., `dist/commands/commit.md`, `dist/skills/*.md`).
- **Root entrypoint:** `src/index.js` is the runtime file consumed by tests and published consumers; `src/index.ts` is the typed source. When changing merge logic, update both `src/index.ts` and `src/index.js`, then run `npm run build` so the package-level tests still pass.
- **Published files:** The entire `src/` tree (built `.js`/`.d.ts` artifacts colocated with their `.ts` sources, including harness-resident plugins under `src/hooks/`) plus the nine `packages/*/dist/` directories for each workspace plugin (see root `package.json` `files`).

## TypeScript Configuration

- `tsconfig.base.json` sets `target: ES2022`, `module: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`.
- Each package extends the base and includes `src/**/*.ts`, `tests/**/*.ts`, `vitest.config.ts`.
- Vitest uses globals mode (`types: ["vitest/globals"]`).

## Testing Conventions

- **Root tests:** `tests/root-plugin.test.ts` validates plugin merging and packaging via `npm pack --dry-run`.
- **Package tests:** Located in `packages/*/tests/**/*.test.ts`.
- **Integration tests:** `packages/commit/tests/controlled-commit.integration.test.ts` exercises real git operations.
- All workspace vitest configs use `include: ["tests/**/*.test.ts"]`.

## Root Entrypoint Registration

Every new plugin must be imported and registered in **both** root entrypoints. Skipping either will break tests or the published package.

### `src/index.ts` (typed source)

```typescript
import { AppVerkNewPlugin } from "../packages/<name>/dist/index.js"

const defaultPluginFactories: Plugin[] = [
  AppVerkCommitPlugin,
  AppVerkPythonDeveloperPlugin,
  AppVerkCodeReviewPlugin,
  AppVerkNewPlugin,  // <-- add here
]
```

### `src/index.js` (runtime entrypoint)

```javascript
import { AppVerkNewPlugin } from "../packages/<name>/dist/index.js"

const defaultPluginFactories = [
  AppVerkCommitPlugin,
  AppVerkPythonDeveloperPlugin,
  AppVerkCodeReviewPlugin,
  AppVerkNewPlugin,  // <-- add here
]
```

**Critical:** After adding to `src/index.ts`, mirror the exact same change in `src/index.js`. The JS file is the runtime entrypoint consumed by tests and published consumers; the TS file provides types.

### Harness-resident plugins (`src/hooks/<name>/`)

Plugins that live inside the root `src/` tree (rather than as a workspace package under `packages/`) are imported using a **relative path** to their colocated build artifact. Use this pattern when a plugin only needs to ship hooks (no separate build pipeline, tests can live alongside the source):

```typescript
import { AppVerkPantheonPlugin } from "./hooks/session-notification/plugin.js"

const defaultPluginFactories: Plugin[] = [
  // ...workspace plugins (imported from ../packages/<name>/dist/)...
  AppVerkPantheonPlugin,
]
```

Because the entire `src/` tree is published (see [Build & Packaging Details](#build--packaging-details)), the built `plugin.js`/`plugin.d.ts` siblings of `plugin.ts` ship automatically — no `packages/*/dist/` entry is required in root `package.json` `files`. Mirror the import in `src/index.js` exactly as with workspace plugins.

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

1. **Package count badge** — increment the number: `[![Package](https://img.shields.io/badge/package-N-blue.svg)]`
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
3. **Import and register the new plugin factory in `src/index.ts` and `src/index.js`.** See [Root Entrypoint Registration](#root-entrypoint-registration) above.
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

- Do not run `git commit` or `git push` via the bash tool in this repo — the commit plugin blocks direct commits and pushes at runtime (`tool.execute.before` hook). Use `/commit` instead.
- Changing `src/index.ts` without the corresponding `src/index.js` will break root tests and the published package.
- Removing `packages/*/dist/` will break the root entrypoint and packaging tests.
- **Forgetting to add a `.gitignore` exception and commit `packages/<name>/dist/`** will cause `Cannot find module` errors for consumers installing from git, because npm does not run the build step on git dependencies.
