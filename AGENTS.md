# AppVerk OpenCode Plugins — Agent Guide

This is an **OpenCode plugin monorepo** that bundles multiple workspace plugins (a Python `/python` workflow, a TypeScript + React `/frontend` workflow, a Swift `/swift` workflow, a `/review` code review workflow, and shared `skill-utils` helpers), plus absorbed modules under `src/modules/<name>/` (currently: `commit`, `qa` — the `/create-qa-plan` + `/run-qa` workflow with the `zmora` logical agent, `pantheon-config` — the harness configuration library, and `coordinator` — the Pantheon `@perun` primary agent with `dispatch_parallel`, `assign_issue_ids`, `compute_waves`, and the background-dispatch tools `dispatch_background` / `poll_background` / `wait_background`) and a Pantheon session-notification hook (`src/hooks/session-notification/`). The root package re-exports all of them and handles plugin merging.

## Monorepo Layout

| Path | Role |
|------|------|
| `src/index.ts` | **Root entrypoint** (TypeScript source) — loads built outputs from all workspace packages plus absorbed modules under `src/modules/`, merges their tools/hooks. Built into `dist/index.js` for runtime. |
| `src/modules/commit/` | Absorbed commit plugin — TS source only. Asset: `src/commands/commit.md`. Tests: `tests/modules/commit/`. Built into `dist/modules/commit/` and `dist/commands/`. |
| `packages/python-developer` | Python-developer plugin source, tests, skills, build scripts. Output shipped at `packages/python-developer/dist/`. |
| `packages/code-review` | Code-review plugin source, tests, agent prompts, command templates, skill-agents, build scripts. Output shipped at `packages/code-review/dist/`. All agents and commands automatically load the `standards-discovery` skill during pre-analysis to discover project-specific standards before reviewing. |
| `packages/frontend-developer` | Frontend-developer plugin source, tests, skills, build scripts. Output shipped at `packages/frontend-developer/dist/`. |
| `packages/skill-utils` | Shared helpers for creating skill-based plugins (`createSkillPlugin` / `createSkillLoader`). Also exports two **stateless coordinator-policy primitives** consumed by `coordinator-policy/` and `skill-registry`: `session-identity.ts` (`getSessionAgent` / `isCoordinatorSession` / `getSessionParentID` resolvers + the `COORDINATOR_AGENT_NAME` constant — the agent slug Perun runs under, kept in sync with `coordinator/`'s `config.agent[...]` key via the Task-7 sync test) and `coordinator-bash-policy.ts` (the pure `parseAllowedBashPrograms` / `classifyCoordinatorBash` / `buildViolationError` resolver — allowlist + compound-shell rejection, no I/O). **Two consumers:** the `coordinator-policy/` `tool.execute.before` bash gate and the `skill-registry` `experimental.chat.system.transform` rule-suppression. Output shipped at `packages/skill-utils/dist/`. |
| `packages/skill-registry` | Global skill registry — scans skill folders, parses frontmatter, registers unified `load_appverk_skill` tool, injects activation rules into every agent's system prompt. Output shipped at `packages/skill-registry/dist/`. |
| `src/modules/qa/` | Absorbed QA plugin — TS source only. Assets: `src/commands/{create-qa-plan,run-qa}.md`, `src/skills/qa/**`, `src/modules/qa/prompt-sections/{core,overlay-fe,overlay-be,overlay-setup}.md`. Registers three `zmora-{fe,be,setup}` subagent variants composed via `prompt-builder.ts` (overlay-setup.md joins overlay-fe/overlay-be on top of `core.md`); logical agent name `zmora` everywhere user-facing. Also registers the `parse_plan` (Perun-only, populates per-run recipe AST from the plan's `## Setup` → `**Bindings:**` block), `execute_recipe` (zmora-setup only, mints/refreshes bindings), and `record_input` (Perun-only, captures user-pasted `NAME=value` inputs) plugin tools, plus the `shell.env` hook that injects per-parent bindings into child shells, the `BindingsStore` / `scrubSecrets` pipeline, and a periodic TTL sweep that purges expired (non-pinned) entries. Tests: `tests/modules/qa/`. Built into `dist/modules/qa/`, `dist/commands/`, `dist/skills/qa/`. |
| `src/modules/explore/` | Absorbed explore plugin — TS source only. Registers the `triglav` read-only explorer subagent (`mode: "subagent"`) and calls `registerAgentMetadata()` so Perun can route to it. Semantic search is gated on the optional serena MCP; if serena is absent the agent still registers but runs in degraded mode (Grep/Glob) and emits a one-time warning toast on `session.created`. Tests: `tests/modules/explore/`. Built into `dist/modules/explore/`. |
| `src/modules/plan/` | Absorbed planning module — TS source only. Registers the planning agent under the display/dispatch name `Veles - Planner` (`mode: "all"`, user-switchable AND Perun-dispatchable via `DISPATCHABLE_ALL_AGENTS`; the pantheon-config slug stays `agents.veles`) and calls `registerAgentMetadata()` so Perun can route to it. Asset: `veles.md`. Opt-in dispatch tools via `config.agent.tools` (`dispatch_parallel`/`dispatch_background`/`poll_background`/`wait_background`). Serena-gated: if serena MCP is absent the agent still registers but runs in degraded mode (Grep/Glob) and emits a one-time warning toast on `session.created`. Tests: `tests/modules/plan/`. Built into `dist/modules/plan/`. |
| `packages/swift-developer` | Swift-developer plugin source, tests, skills, build scripts. Output shipped at `packages/swift-developer/dist/`. |
| `src/modules/agent-registry/` | Harness-resident **library** (no plugin export) — process-wide `SpecialistInfo` registry. Exposes `registerAgentMetadata()` (fail-fast on a conflicting duplicate logical name; idempotent on identical re-registration) / `getAgentMetadataRegistry()` (returns a name-sorted copy), and the `buildPerunPrompt` placeholder renderer that fills Perun's prompt template from the registered specialists. Agent-registering modules call `registerAgentMetadata()` in their factory bodies; `coordinator/` consumes the registry via `buildPerunPrompt` when it builds Perun's prompt. Tests: `tests/modules/agent-registry/`. Built into `dist/modules/agent-registry/`. |
| `src/modules/coordinator/` | Absorbed coordinator plugin — TS source only. Asset: `src/agents/perun.md`. Registers `dispatch_parallel` (worker pool, concurrency 4, cap 4 — chunk larger workloads), `assign_issue_ids`, and `compute_waves` tools alongside the `@perun` primary agent. Also registers the **background-dispatch** tools `dispatch_background` / `poll_background` / `wait_background` (non-blocking, within-turn overlap; `session.promptAsync` fire-and-forget + a factory-scoped in-memory `BackgroundTaskStore`, per-session cap 4, `session.deleted` cleanup). The exported `PERUN_TOOLS` constant lists every coordinator tool and `tests/modules/coordinator/perun-tools-sync.test.ts` enforces it matches perun.md's `allowed-tools` frontmatter. Tests: `tests/modules/coordinator/`. Built into `dist/modules/coordinator/` and `dist/agents/`. |
| `src/modules/coordinator-policy/` | Absorbed coordinator-policy plugin — TS source only (no `.md` asset). Registers a `tool.execute.before` **bash gate** (`makeBashGate`) that enforces an allowlist on `bash` calls — but **only** when the session is positively identified as the coordinator (`getSessionAgent(...) === COORDINATOR_AGENT_NAME`). **Fail-OPEN on identity uncertainty:** if the agent can't be resolved the gate does nothing, so non-coordinator sessions are never blocked. The allowlist is read at plugin-init from `src/agents/perun.md` frontmatter (`Bash(<prog>:*)` entries — single source of truth) by `read-allowlist.ts`, with a hardcoded `FALLBACK_ALLOWLIST` (`mkdir`, `ls`, `./scripts/qa-preflight.sh`) used when the frontmatter can't be read/parsed (guarded against drift by the Task-7 sync test). Classification logic (`classifyCoordinatorBash` + compound-shell rejection) and the rejection error (`buildViolationError`) live in the `skill-utils` `coordinator-bash-policy.ts` primitive. Tests: `tests/modules/coordinator-policy/`. Built into `dist/modules/coordinator-policy/`. |
| `src/modules/pantheon-config/` | Harness-resident **library** (no plugin export) — reads `pantheon.json` (user-global + per-project walk-up, closest-wins merge) and exposes `loadPantheonConfig()` / `getLoadErrors()` / `pantheonConfigEmpty()`. Consumed by `coordinator/` and `qa/` in their `config` hooks. Tests: `tests/modules/pantheon-config/`. Built into `dist/modules/pantheon-config/`. |
| `src/modules/_shared/` | Cross-module helpers: `loadModuleAsset` (sibling markdown loading under tsup's `bundle: false` layout), `SessionAgentRegistry` (childSessionID → agentName), `register/getDispatchExtensions` (QA publishes scrubberFactory + registry that coordinator reads at dispatch time), and `serena-detect` (`isSerenaAvailable` — the optional-serena gate shared by `explore` + `plan`). Consumed by `coordinator/`, `qa/`, `explore/`, and `plan/`. |
| `src/hooks/session-notification/` | **Harness-resident plugin** (not a workspace package) — Pantheon session-notification hook that triggers macOS desktop notifications on OpenCode session events. Source `.ts` and built `.js`/`.d.ts` are colocated and shipped together as part of the root `src/` tree. |

**Important:** `dist/` is usually ignored, but the **root `dist/`** and **`packages/*/dist/`** are committed and published (see `.gitignore`). Do not delete those `dist/` trees.

## Prerequisites

**Required:** Bun >= 1.3.13. Install:

```bash
curl -fsSL https://bun.sh/install | bash
```

This project uses Bun exclusively for installation and script execution. Do NOT use `npm`, `yarn`, or other package managers — a `preinstall` guard in root `package.json` (`scripts/check-package-manager.mjs`) rejects non-bun runners. The guard is a UX hint, not a security control (`npm_config_user_agent` is spoofable); real enforcement is via the `packageManager` field and these docs.

`.bun-version` pins the toolchain version for version managers (mise/asdf/proto auto-switch to 1.3.13 when entering the repo).

## Pantheon harness configuration

Per-agent model selection lives in `pantheon.json`. See [`docs/configuring-agents.md`](docs/configuring-agents.md) for the user-facing reference.

## Commands

```bash
# Full validation (run this before pushing)
bun run check          # typecheck + test + build

# Individual steps
bun run typecheck      # tsc --noEmit at root + each workspace
bun run test           # vitest at root + each workspace
bun run build          # tsup ESM + DTS for all packages
```

### Per-package commands

Each workspace package has its own `typecheck`, `test`, and `build` scripts. Tests import from `dist/` (not `src/`), so **build is required before test**:

```bash
bun --filter @appverk/opencode-python-developer build
bun --filter @appverk/opencode-python-developer test
```

**Note:** bun's `--filter` takes the script name directly (e.g., `bun --filter X build`). The form `bun --filter X run build` returns `No packages matched the filter` because bun parses `run` as the script target. The alternate form `bun run --filter X build` (run BEFORE filter) is also documented-valid; we use the canonical `bun --filter X SCRIPT` form throughout this project.

Note: absorbed modules (e.g. `src/modules/commit/`) build and test via the **root** `bun run build:root` / `bun run test` — they no longer have a per-workspace script.

### skill-utils build dependency (intentional)

Root `typecheck`, `test`, and `build` all invoke `bun run build:skill-utils` early in their chains. This is because other workspace packages typecheck and import against `packages/skill-utils/dist/*.d.ts` — so skill-utils must be built first, BEFORE other workspaces can typecheck.

The `build:skill-utils` script is exposed as a named root script (not inlined) so this side-effect is intentional and discoverable, not hidden chain magic. When adding a new workspace that imports from skill-utils, no script changes are needed — the dependency is already encoded.

## Build & Packaging Details

- **Module system:** ESM only (`"type": "module"`, NodeNext resolution).
- **Package builds:** `tsup src/index.ts --format esm --dts`.
- **Post-build asset copying:** Each package runs a Node script to copy markdown templates/skills into `dist/` (e.g., `dist/commands/commit.md`, `dist/skills/*.md`).
- **Root entrypoint:** `src/index.ts` is the typed source. The root build (`bun run build:root`) compiles it (and everything under `src/`) to `dist/` via `tsup --bundle=false`. OpenCode loads `./dist/index.js` (the `main` field in root `package.json`). There is no longer a hand-edited `src/index.js`.
- **Published files:** The root `dist/` tree (compiled `.js`/`.d.ts` + copied `.md` assets — this is where every absorbed module under `src/modules/` lands) plus the remaining `packages/*/dist/` directories for each workspace plugin — see root `package.json` `files` for the canonical list.

### Tracked dist paths in CI

`scripts/verify-dist-sync.mjs` is the **source of truth** for which `dist/` trees are checked for drift after `bun run build`. The `trackedDistPaths` array in that script must stay in sync with:

- The `files` array in the root `package.json` (everything published must be verified).
- The `.gitignore` carve-outs for each `packages/<name>/dist/` (everything verified must be committed).
- The per-workspace `build` invocations in the root `build` script (everything verified must actually be built).

When adding a new workspace plugin, update **all four** locations together. If any are out of sync, CI will either silently pass on dist drift (path missing from the script) or fail permanently (path tracked but never built/committed).

### Working directory assumption for repo-relative script paths

OpenCode must be started from the project root. The preflight script path `./scripts/qa-preflight.sh` declared in `@perun`'s `allowed-tools` (see `src/agents/perun.md`) is resolved against the shell CWD, so launching OpenCode from any other directory will cause that tool match to miss. The same assumption applies to the `scripts/qa-preflight.sh` path used by `tests/scripts/qa-preflight.test.ts` — vitest's default CWD is the project root, which keeps the existing relative path working.

### QA preflight probe runner

`scripts/qa-preflight.sh` is invoked by `@perun` Step 3.5 (preflight) via the allowed-tool match `Bash(./scripts/qa-preflight.sh:*)`. It reads probe descriptors (`env`, `service`, `db`) one-per-line from stdin and emits `OK <ident>` / `MISSING <ident> (<reason>)` lines to stdout — Perun parses that output to count gaps before dispatching `zmora` subagents. The script never echoes environment variable values; only names and OK/MISSING status appear on stdout, keeping secrets out of the session transcript.

## TypeScript Configuration

- `tsconfig.base.json` sets `target: ES2022`, `module: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`.
- Each package extends the base and includes `src/**/*.ts`, `tests/**/*.ts`, `vitest.config.ts`.
- Vitest uses globals mode (`types: ["vitest/globals"]`).

## Testing Conventions

- **Root tests:** `tests/root-plugin.test.ts` validates plugin merging and packaging via `bun pm pack`.
- **Package tests:** Located in `packages/*/tests/**/*.test.ts`.
- **Integration tests:** `tests/modules/commit/controlled-commit.integration.test.ts` exercises real git operations.
- All workspace vitest configs use `include: ["tests/**/*.test.ts"]`.

## Root Entrypoint Registration

Every new plugin must be imported and registered in `src/index.ts`. The build (`bun run build:root`) produces `dist/index.js` from it; nothing is hand-edited under `dist/`.

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
5. Update root `bun run build` / `bun run test` / `bun run typecheck` scripts to include the new workspace.
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
> - **Build-order matters:** the root build (`bun run build:root`) emits `dist/` from `src/` first; workspace package builds run afterwards. Modules that read assets from `dist/` (via `import.meta.url` resolution) rely on this ordering.
> - **The config filename is `tsup.root.config.ts`** (not the default `tsup.config.ts`) — this is intentional so workspace `tsup.config.ts` files are not picked up by the root build.

1. Create `src/modules/<name>/` with `index.ts` and supporting `.ts` modules.
2. Place `.md` assets under `src/commands/`, `src/agents/`, or `src/skills/` (the layout `scripts/copy-root-assets.mjs` knows about).
3. Place tests under `tests/modules/<name>/`. Import sources via `from "../../../src/modules/<name>/<file>.js"`.
4. Import and register the plugin factory in `src/index.ts` (see [Root Entrypoint Registration](#root-entrypoint-registration)).
5. **If the module registers an agent Perun should route to**, call `registerAgentMetadata()` (from `src/modules/agent-registry/`) with the agent's `SpecialistInfo` in the module's factory body — otherwise the agent is invocable but invisible to Perun's routing (it never renders into Perun's prompt). **Ordering matters:** every agent must register *before* the coordinator builds Perun's prompt. `getPerunPrompt()` snapshots the registry on its first call and caches the result, so any agent-registering module must appear *before* `AppVerkCoordinatorPlugin` in the `defaultPluginFactories` array in `src/index.ts`. The coordinator is registered after every agent-registering module precisely to satisfy this (non-agent plugins like `coordinator-policy` may follow it); place a new agent-registering module ahead of it (e.g. as `src/modules/explore/` does with `triglav`).
6. Build and test via root `bun run build:root` and `bun run check` — no per-package scripts.
7. Update `tests/root-plugin.test.ts` packed-file assertions to include the new `dist/modules/<name>/*` and `dist/commands/<file>.md` paths.
8. Update `README.md` and this `AGENTS.md` per the [Documentation Checklist](#documentation-checklist).

## Versioning & Git Installation

When installing from git, OpenCode (via Bun) caches the repository and **does not automatically pull updates** when the branch moves. To ensure users receive the latest commands and agents:

1. **Bump the version** in **all** `package.json` files (root + every workspace) when adding new commands, agents, or built assets.
2. **Create a git tag** matching the version (e.g. `v0.3.0`) after the bump commit.
3. **Update installation examples** in `README.md` and `AGENTS.md` to reference the new tag instead of a branch name like `#master`.

Example config:
```json
{
  "plugin": [
    "av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.3.0"
  ]
}
```

If a user reports missing commands after an update, instruct them to either:
- Re-install with `opencode plugin -f av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.3.0`, or
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

### Where review reports live

Code-review reports are **permanent artefacts** that get committed to the repo. They live under `docs/reviews/` and follow the naming convention `YYYY-MM-DD-<branch-slug>.md`, with a `-N` suffix on collisions when the same branch is re-reviewed on the same day (e.g. `2026-05-27-feature-explore.md`, `2026-05-27-feature-explore-2.md`).

Conventions:

- **Commit the report** as soon as the review run produces it. An untracked report file under `docs/reviews/` is ambiguous (forgotten? leftover? local-only?) and should never linger across sessions.
- **Keep "Fixed" status in the report**, not in commit messages — the report itself is the audit trail for which findings shipped on which branch.
- **Do not link to `docs/reviews/*.md` from source or other docs.** Like superpowers artefacts, individual reports are point-in-time records; references to them rot once the branch is merged or the file is archived. Inline anything load-bearing into the permanent doc that needs it.

## Common Pitfalls

- Do not run `git commit` or `git push` via the bash tool in this repo — the commit plugin blocks direct commits and pushes at runtime (`tool.execute.before` hook). Use `/commit` instead. This bash gate (`classifyBashCommand` in `src/modules/commit/bash-policy.ts`) is **defense-in-depth / a workflow rail, not a security boundary** — it keeps the `/commit` workflow consistent but is bypassable by shapes the literal `git` token-match misses (`/usr/bin/git …`, `bash -c "git …"`, `hub commit`, `command git …`, alias indirection, `$(echo git) commit`, plumbing subcommands like `commit-tree` / `fast-import` / `update-ref`). Per project doctrine ([`docs/plugins/coordinator.md`](docs/plugins/coordinator.md): *"Treat code-enforced rules as the security boundary. The LLM-requested rules are defense in depth — they raise the cost of a successful prompt-injection escalation but are not the last line of defense."*), real shell-execution boundaries live outside this plugin. See [`docs/plugins/commit.md`](docs/plugins/commit.md#classifybashcommand-is-defense-in-depth-not-a-security-boundary) for the full bypass list.
- After changing anything under `src/`, run `bun run build:root` to regenerate `dist/` — published consumers and OpenCode load from `dist/`, not `src/`.
- Removing a workspace `packages/<name>/dist/` will break the root entrypoint and packaging tests. (The root `dist/` is also committed — do not delete it manually; let `bun run build:root` regenerate it.)
- **Forgetting to add a `.gitignore` exception and commit `packages/<name>/dist/`** will cause `Cannot find module` errors for consumers installing from git, because Bun (like npm) does not run the build step on git dependencies.
