# Pantheon — Per-Agent Model Configuration (Design)

**Status:** Draft (revision 2, post sequential-thinking verification)
**Date:** 2026-05-22
**Owner:** Marian Szenfeld
**Scope:** MVP — Perun + Zmora (renamed from `qa-tester`); `pantheon.json` as the first piece of harness-resident configuration.

---

## 1. Motivation

We are gradually migrating from a "collection of OpenCode plugins" model into a dedicated **Pantheon harness**. The first orchestrator — **Perun** — already coordinates QA work by dispatching specialist agents (today registered as `qa-tester-fe` / `qa-tester-be`). The next step is letting users choose **which Anthropic model each agent runs on**, configured via a dedicated harness file rather than via per-agent OpenCode config sprinkled across `opencode.json`.

Two goals:

1. **Operational** — give users a single, harness-owned place to assign models (e.g. Perun on Opus for reasoning-heavy coordination, Zmora on Sonnet/Haiku for cheap parallel scenarios).
2. **Architectural** — establish `pantheon.json` as the fundament of the new harness config surface. Today it carries only model selection; tomorrow it can grow `dispatch.*`, `logging.*`, etc.

This spec also incorporates a **rename**: `qa-tester` → **Zmora** (Slavic minor deity: the nightmare-bringer who haunts sleepers — semantically apt for QA, which hunts bugs). Perun stays Perun. Higher-tier Slavic gods (Veles, Morana, Svarog) are reserved for future major agents.

## 2. Goals & Non-Goals

### Goals (MVP)
- Read a `pantheon.json` (JSONC) from user-global and per-project locations with **closest-wins** merge.
- Apply the resolved model to each agent's `AgentConfig.model` at plugin boot.
- Support `perun` and `zmora` keys today; design must allow more agents tomorrow without loader changes.
- Graceful fallback when no config exists; user-facing TUI toast informing them defaults are in use.
- User-facing documentation at `docs/configuring-agents.md` (not `docs/plugins/…` — that tree is legacy and will be removed once migration completes).

### Non-Goals (deferred)
- **Per-dispatch model override** — Perun cannot pick a different model per scenario today. Always uses the agent's configured model.
- **Hot-reload** — edits to `pantheon.json` require OpenCode restart.
- **Schema beyond `agents.<name>.model`** — no `temperature`, `prompt`, `tools`, `permission` overrides yet. The loader tolerates and ignores unknown keys for forward compatibility, but does not expose them.
- **Alias resolution** — no `"opus"` shorthand; full `<providerID>/<modelID>` only.
- **Backward compatibility for `qa-tester` agent name** — hard rename, bump major.

## 3. High-Level Architecture

A new harness-resident module **`src/modules/pantheon-config/`** acts as a **library** (no Plugin export, no agent/tool registration). Its only public function: `loadPantheonConfig()` returns a merged, validated config dict. Existing modules (`coordinator/`, `qa/`) import it inside their `config: async (config) => {…}` hooks and inject the resolved model into the appropriate `AgentConfig`.

```
src/modules/pantheon-config/
├── index.ts           # public API: loadPantheonConfig(), pantheonConfigEmpty(), getLoadErrors()
├── loader.ts          # walk-up filesystem + JSONC parsing + merge
├── schema.ts          # types + shape validation
└── paths.ts           # resolve ~/.config/opencode/, .opencode/, walk-up boundary

tests/modules/pantheon-config/
├── loader.test.ts
├── schema.test.ts
└── paths.test.ts
```

**Boundaries:**
- `pantheon-config` knows only the **file format** and **merge algorithm**. It does not know about Perun or Zmora.
- `coordinator/index.ts` and `qa/index.ts` import `loadPantheonConfig()` and read their own keys (`perun`, `zmora`).
- Loader is **synchronous** (`fs.readFileSync`) and **cached at module scope**. First call performs I/O; subsequent calls return the cached result. The cache lives for the lifetime of the OpenCode process.

## 4. File Format & Discovery

### 4.1 Locations & precedence

1. **User-global:** `~/.config/opencode/pantheon.json` (sibling of `opencode.json`).
2. **Per-project walk-up:** starting from `PluginInput.directory` (fall back to `process.cwd()`), check each ancestor for `<dir>/.opencode/pantheon.json`. Stop at `os.homedir()` (do not cross into user-global twice). If `cwd` is outside `$HOME`, walk to filesystem root; user-global is still loaded independently.

### 4.2 Merge rule — closest wins, per agent

- **Base:** user-global file (if present).
- For each project-level file found (from furthest ancestor to closest), perform a **shallow merge keyed by `agents.<name>`** — the entire per-agent object replaces any prior value; no deep merge of inner fields.
- Result: `{ [agentName: string]: { model: string } }`.

### 4.2.1 Precedence vs. `opencode.json`

`pantheon.json` is consumed inside our plugin's `config` hook, which contributes to the OpenCode config tree. Standard OpenCode config-resolution rules apply afterwards: user-supplied `agent.<name>.model` in `opencode.json` (project or global) **overrides** what our plugin sets. Effective precedence (lowest → highest):

1. OpenCode built-in default model (`config.model`)
2. **`pantheon.json` via our plugin** (the layer this spec adds)
3. User-supplied `agent.<name>.model` in `opencode.json`

This must be called out in `docs/configuring-agents.md` so users understand why a model set in `opencode.json` wins over `pantheon.json`. We are **augmenting**, not replacing, the OpenCode override chain.

### 4.3 Schema

```typescript
type PantheonConfigFile = {
  agents?: {
    [agentName: string]: {
      model?: string  // "<providerID>/<modelID>", regex: ^[^/]+/[^/]+$
    }
  }
}
```

### 4.4 Example

```jsonc
// ~/.config/opencode/pantheon.json
{
  // user-global defaults across all projects
  "agents": {
    "perun": { "model": "anthropic/claude-opus-4-7" },
    "zmora": { "model": "anthropic/claude-haiku-4-5-20251001" }
  }
}

// /repo/.opencode/pantheon.json (closer — overrides user-global per agent)
{
  "agents": {
    "zmora": { "model": "anthropic/claude-sonnet-4-6" }
  }
}

// Effective config after merge:
// {
//   "perun": { "model": "anthropic/claude-opus-4-7" },     // from user-global
//   "zmora": { "model": "anthropic/claude-sonnet-4-6" }    // from project (closer)
// }
```

### 4.5 JSONC support

We use the [`jsonc-parser`](https://www.npmjs.com/package/jsonc-parser) npm package (~30 KB, zero dependencies, MIT, the parser VS Code itself uses) to allow `//` and `/* */` comments and trailing commas — convenient for handwritten config.

### 4.6 Agent-key conventions

| Pantheon key | OpenCode registry key(s) | Note |
|---|---|---|
| `perun` | `"Perun - Coordinator"` (mode: `primary`) | One registered agent. |
| `zmora` | `"zmora-fe"`, `"zmora-be"` (mode: `subagent`) | One logical agent, two variants. The `zmora.model` value is applied to **both** variants. |

## 5. Data Flow

Plugin factory order in `src/index.ts` puts `AppVerkQAPlugin` **before** `AppVerkCoordinatorPlugin`. Correctness does not depend on this order — `loadPantheonConfig()` is idempotent and module-scope cached, so whichever plugin's `config` hook fires first performs I/O and the rest hit the cache.

```
OpenCode start
  └─ AppVerkPlugins → plugin factories iterated in defaultPluginFactories order
      ├─ AppVerkQAPlugin.config(config)
      │    ├─ loadPantheonConfig()     ← first call, performs I/O
      │    │    ├─ paths.userGlobalPath()      → ~/.config/opencode/pantheon.json
      │    │    ├─ paths.walkUpProjectPaths()  → ordered list
      │    │    ├─ for each path: readFileSync + jsonc-parse + schema-validate
      │    │    ├─ merge (closest-wins, per agentName)
      │    │    └─ cache result (module-scope)
      │    ├─ const model = cfg.agents.zmora?.model
      │    └─ if model: set on BOTH config.agent["zmora-fe"].model and
      │                config.agent["zmora-be"].model
      │
      ├─ AppVerkCoordinatorPlugin.config(config)
      │    ├─ loadPantheonConfig()     ← CACHED, zero I/O
      │    ├─ const model = cfg.agents.perun?.model
      │    └─ if model: config.agent["Perun - Coordinator"].model = model
      │
      └─ OpenCode TUI ready

First session.created event (any session, main or subagent — we do not filter)
  └─ event hook fires
      └─ if !toastShown:
          toastShown = true   ← module-scope flag, once per process
          if loadErrors > 0  → warning toast
          else if empty config → info toast
```

**Runtime dispatch (unchanged):** `dispatch_parallel({ tasks: [{ name: "zmora-fe", … }] })` flows through `dispatch.ts` → `sdk-specialist.startTask("zmora-fe", …)` → `client.session.prompt({ body: { agent: "zmora-fe", parts } })`. OpenCode looks up `AgentConfig.model` for `zmora-fe` and applies it. No changes required in `dispatch.ts` or `sdk-specialist.ts`.

## 6. Error Handling & Notification

### 6.1 "Nothing to configure" classes

| Situation | Loader response | User-facing |
|---|---|---|
| No file exists | `{ agents: {}, loadErrors: [] }` | Info toast on first session: *"pantheon.json not found — using default models"* |
| File exists but no `agents.perun` | Return parsed sections | No toast (partial config is intentional) |
| File exists, `perun` configured, `zmora` not | Apply Perun's, leave Zmora on default | No toast |

The info toast fires **only when `agents` is empty after merging all sources** — partial configurations are treated as deliberate. (Parse errors trigger a separate warning toast — see §6.2 / §6.3.)

### 6.2 Error classes

| Error | Loader response | Log | User-facing |
|---|---|---|---|
| Malformed JSONC | Skip that file, record in `loadErrors` | `[pantheon] failed to parse <path>: <msg>` (warn) | Warning toast: *"pantheon.json parse error — check console"* |
| Top-level not an object | Skip that file | `[pantheon] <path>: top-level must be object` (warn) | Warning toast |
| `agents.<name>.model` fails regex `^[^/]+/[^/]+$` | Skip that agent only, keep rest | `[pantheon] <path>: invalid model "<value>" for agent "<name>"` (warn) | Warning toast |
| Unknown top-level key (e.g. `dispatch`, `logging`) | Ignore section, continue | `[pantheon] <path>: unknown section "<key>" — ignoring` (debug) | None |
| Unknown field under agent (e.g. `temperature`) | Ignore field, keep `model` | `[pantheon] <path>: unknown field "agents.<name>.<key>"` (debug) | None |

### 6.3 Notification mechanism

`coordinator/index.ts` registers an `event` hook that fires on the first `session.created` (we do **not** filter main vs subagent — globally one toast per process). The `client.tui.showToast` SDK signature requires the parameters wrapped in `body`:

```typescript
async event({ event }) {
  if (event.type !== "session.created") return
  if (toastShown) return
  toastShown = true
  const errors = getLoadErrors()
  try {
    if (errors.length > 0) {
      await client.tui.showToast({
        body: {
          variant: "warning",
          title: "Pantheon",
          message: "pantheon.json parse error — check console for details",
        },
      })
    } else if (pantheonConfigEmpty()) {
      await client.tui.showToast({
        body: {
          variant: "info",
          title: "Pantheon",
          message: "pantheon.json not found — using default models",
        },
      })
    }
  } catch {
    // best-effort: headless/non-TUI OpenCode invocations should not crash
  }
}
```

`toastShown` is a module-scope flag so subsequent sessions in the same process do not retrigger. The toast is fired on **any** first `session.created` (main or subagent) — for a one-shot informational message this is acceptable and avoids duplicating the main-session-detection heuristic already in `src/hooks/session-notification/`.

> **SDK signature reference:** `client.tui.showToast` is the `@opencode-ai/sdk` v1 client method. Its signature is `(options: { body: { title?, message, variant, duration? } })`. `message` and `variant` are required; `title` and `duration` are optional.

### 6.4 What does NOT crash the plugin
- Missing file
- Malformed JSON
- Invalid schema
- Toast failure

### 6.5 What may crash boot (acceptable)
- `~/.config/opencode/` is unreadable (`EACCES`) — surfaces as a standard plugin-load error.

## 7. Renaming `qa-tester` → `zmora`

Breaking change. Hard rename, no compatibility shim. Version bump `0.2.16` → `0.3.0`, new tag `v0.3.0`.

### 7.1 Touchpoints

Sourced from a project-wide `grep -rn "qa-tester"`. Anything that survives the rename here is a runtime or documentation bug.

**Source — functional code (must be in lockstep with the rename):**

| File | Change |
|---|---|
| `src/modules/qa/index.ts` | Registry keys: `qa-tester-${stack}` → `zmora-${stack}`. Description updated. |
| `src/modules/qa/prompt-builder.ts` | `frontmatter.name = "zmora-${stack}"`; description updated. Allowed-tools logic unchanged. |
| `src/modules/qa/allowed-tools.ts` | Update comments referencing the old name. |
| `src/modules/coordinator/sanitize.ts` | **Functional regex**: `VARIANT_SUFFIX_PATTERN = /\bqa-tester-(?:fe|be)\b/g` → `/\bzmora-(?:fe|be)\b/g`; replacement string `"qa-tester"` → `"zmora"`. `normalizeVariantSuffix` rewrites internal variant names in untrusted specialist output before it surfaces in reports — leaving the old regex in place silently breaks sanitization after the registry rename. |
| `src/modules/coordinator/dispatch.ts` | Update inline comments that reference `qa-tester-fe` / `qa-tester-be` (no functional change, but the comments document the variant convention and should stay accurate). |
| `src/modules/coordinator/index.ts` | Update the `dispatch_parallel` tool description string (currently mentions `qa-tester` → `qa-tester-fe` + `qa-tester-be` as the canonical logical-agent example). This string is user-facing in the OpenCode TUI tool list. |

**Source — prompts and command templates:**

| File | Change |
|---|---|
| `src/modules/qa/prompt-sections/core.md` (and overlays if they reference the name) | Replace user-facing "qa-tester" mentions with "Zmora"; technical variants → `zmora-fe`/`zmora-be`. |
| `src/agents/perun.md` | Workflow 1 routing references; "Available Specialists" table. FE/BE prefix routing logic unchanged — only target names change. |
| `src/commands/run-qa.md` | Replace agent name in dispatch instructions and `dispatch_parallel` label conventions. |
| `src/commands/create-qa-plan.md` | Verify and update agent-name references if any (grep currently finds none — guard against regressions). |

**Tests:**

| File | Change |
|---|---|
| `tests/modules/qa/plugin.test.ts` | Update fixtures and assertions. |
| `tests/modules/coordinator/sanitize.test.ts` | Update fixtures for the new regex / replacement string. |
| `tests/modules/coordinator/dispatch.test.ts` | Rename `qa-tester*` in assertions. |
| `tests/modules/coordinator/perun-qa-flow.test.ts` | Rename `qa-tester*` in assertions. |
| `tests/root-plugin.test.ts` | **Add** assertions for `dist/modules/pantheon-config/*.js` in the packaging check. Note: today this file does **not** reference `qa-tester` directly — this row is about the *new* paths, not a rename. |

**Documentation (root):**

| File | Change |
|---|---|
| `AGENTS.md` | Update `src/modules/qa/` row; add `src/modules/pantheon-config/` row. |
| `README.md` | Tables and prose. |
| `docs/configuring-agents.md` | **NEW** — see §8. |

**Documentation (legacy `docs/plugins/`):**

The `docs/plugins/` tree is slated for removal once harness migration completes (§8.4). Until then it is still in-source, still referenced by users, and still must be coherent with the rename. The grep counts make this non-trivial:

| File | Mentions | Change |
|---|---|---|
| `docs/plugins/qa.md` | many | Replace user-facing "qa-tester" mentions with "Zmora"; variants → `zmora-fe`/`zmora-be`. |
| `docs/plugins/coordinator.md` | 16 | Same — many mentions in Workflow 1 explanation, sample dispatch labels, and the "logical agents with variants" subsection. **High effort** — easy to miss spots. Use grep+replace then re-grep. |
| `docs/plugins/pantheon.md` | 1 | Single mention; update for consistency. |

### 7.2 What stays the same
- Slash commands: `/run-qa` and `/create-qa-plan` keep their names. The commands are user-facing contracts; only the *agent* name changes.
- Workflow 1 routing logic in Perun (FE/BE prefix → variant selection) is unchanged.
- `dispatch_parallel`'s logical-agent display-name exception (use `zmora` in the `agent` label, even though dispatch targets are `zmora-fe` / `zmora-be`) is the same convention already documented for `qa-tester`.

### 7.3 Versioning
- Bump all `package.json` files (root + every workspace) to `0.3.0`.
- Create git tag `v0.3.0` after merge.
- Update `.opencode/opencode.json` `plugin` reference to `#v0.3.0`.
- Update README installation example to `#v0.3.0`.

## 8. Documentation

### 8.1 `docs/configuring-agents.md` (NEW, user-facing)

The canonical reference users will read. Sections:

1. **Overview** — Pantheon harness allows per-agent model selection via `pantheon.json`. Lists which agents exist today (`perun`, `zmora`).
2. **Configuration file location** — user-global path, per-project walk-up, closest-wins. Diagrams of the merge order.
3. **Schema** — annotated JSONC examples (single-agent, multi-agent, user-global + project override).
4. **Available agents (today)** — table mapping `perun` → `"Perun - Coordinator"`, `zmora` → `zmora-fe` + `zmora-be` (one model applied to both variants).
5. **Default behavior when no config exists** — OpenCode default model used; one-time TUI toast.
6. **Restart requirement** — changes require OpenCode restart (no hot-reload in MVP).
7. **FAQ / troubleshooting** — invalid model string format, unknown agent key, JSON parse errors, where to find warning logs.

Estimated size: ~150 lines including code blocks.

### 8.2 `AGENTS.md` (UPDATE)
- Add a row for `src/modules/pantheon-config/` in the monorepo-layout table.
- Update the `src/modules/qa/` row to reflect the rename.
- Add a brief "Pantheon harness configuration" subsection linking to `docs/configuring-agents.md`.

### 8.3 `README.md` (UPDATE)
- Update "Available Commands & Agents" table for the rename.
- Add `docs/configuring-agents.md` to the documentation list.
- Update installation example to `#v0.3.0`.

### 8.4 Legacy
- `docs/plugins/*` is treated as legacy and will be removed once harness migration completes. We update `docs/plugins/qa.md` and `docs/plugins/pantheon.md` for consistency in this PR but do not add new plugins-tree documentation.

## 9. Testing Strategy

### 9.1 New tests

```
tests/modules/pantheon-config/paths.test.ts     (~5 cases)
  - userGlobalPath() expands to ~/.config/opencode/pantheon.json
  - walkUpProjectPaths(/a/b/c) returns ordered list of .opencode/pantheon.json paths
  - walk stops at os.homedir()
  - cwd outside $HOME → walk to filesystem root
  - deterministic ordering (closest first)

tests/modules/pantheon-config/loader.test.ts    (~12 cases)
  - no file anywhere → { agents: {}, loadErrors: [] }
  - only user-global → result equals user-global content
  - only project file → result equals project content
  - both present → merged, project wins per agent
  - multiple walk-up levels → closest wins
  - JSONC with comments and trailing commas parses correctly
  - malformed JSON → loadErrors contains path, file skipped, rest of sources OK
  - non-object top-level → loadErrors, file skipped
  - invalid model string → loadErrors, agent skipped, others kept
  - unknown top-level section → debug log, ignored
  - unknown agent field → debug log, ignored
  - cache: first call performs I/O, second returns same result with zero I/O (fs mock asserts)

tests/modules/pantheon-config/schema.test.ts    (~6 cases)
  - valid: full agents.perun.model
  - valid: empty object
  - valid: empty agents
  - invalid: model without "/" or with multiple "/"
  - invalid: agents not an object
  - invalid: model not a string
```

### 9.2 Modifications to existing tests

- `tests/modules/coordinator/*.test.ts` — add a test that `config.agent["Perun - Coordinator"].model` is set when `pantheon.json` provides `perun.model`, and absent otherwise. Use `vi.mock` or an fs fixture to inject config. Also rename every `qa-tester` → `zmora` in existing assertions (`sanitize.test.ts`, `dispatch.test.ts`, `perun-qa-flow.test.ts`). Update `sanitize.test.ts` fixtures for the new regex literal.
- `tests/modules/qa/plugin.test.ts` — add an analogous test for **both** `zmora-fe` and `zmora-be` (one model applied to both variants). Rename existing `qa-tester` assertions and fixtures.
- `tests/modules/coordinator/notify-on-empty-config.test.ts` (NEW) — verify toast fires once, faking `client.tui.showToast` (note: the call signature wraps args in `body`); second event does not retrigger.
- `tests/root-plugin.test.ts` — assert `dist/modules/pantheon-config/*.js` paths appear in `npm pack --dry-run` output (does **not** currently reference `qa-tester`, so no rename needed there).

### 9.3 New dependency

- `jsonc-parser` (latest stable) — added to root `package.json` `dependencies`.

### 9.4 Manual smoke test (before merge)
1. Create `~/.config/opencode/pantheon.json` with `{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" }, "zmora": { "model": "anthropic/claude-sonnet-4-6" }}}`.
2. Run `npm run build` and reload OpenCode against this repo.
3. Start a session with `@perun`, check the runtime model via OpenCode's session metadata.
4. Run `/run-qa` against a small plan, verify dispatched `zmora-fe` / `zmora-be` sessions use the configured model.
5. Delete the config, restart OpenCode, verify the info toast appears once.

### 9.5 CI quality gates
- `npm run check` (typecheck + test + build) green.
- `tests/root-plugin.test.ts` packaging assertions pass.
- `scripts/verify-dist-sync.mjs` updated to track `dist/modules/pantheon-config/*` (and the four `trackedDistPaths` consistency rule documented in AGENTS.md is honored).

## 10. Open Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `client.tui.showToast` may not be ready at the moment of the first `session.created` event in some OpenCode versions. | Wrapped in `try/catch`; failure is logged but never crashes. Acceptable degradation. |
| `jsonc-parser` adds a runtime dependency (small but non-zero). | 30 KB, zero deps, MIT, well-maintained (VS Code's parser). Worth it for JSONC ergonomics. |
| Renaming `qa-tester` → `zmora` is a breaking change. | Plugin is internal/early-stage; no external consumers. Bump major, document in changelog, update `.opencode/opencode.json` reference. |
| Sync `fs.readFileSync` in a hot path. | Plugin boot is one-shot at OpenCode start; multiple-MB JSONC parsing is not anticipated. Measured cost expected `<10ms` cold. |
| Walk-up could theoretically include a sensitive `.opencode/pantheon.json` from a parent directory the user didn't expect. | Document the walk-up rule prominently in `docs/configuring-agents.md`. Stop walking at `os.homedir()`. |
| User's `agent.<name>.model` in `opencode.json` silently overrides `pantheon.json`. | Document the precedence (§4.2.1) prominently in `docs/configuring-agents.md` FAQ. Not a bug — augmenting the existing OpenCode chain is the only sane shape. |
| `normalizeVariantSuffix` in `coordinator/sanitize.ts` carries a hard-coded `qa-tester` regex + replacement and must be updated in lockstep with the registry rename. If forgotten, sanitization silently no-ops on the new variant names and `zmora-fe`/`zmora-be` can leak into reports. | Listed explicitly in §7.1 functional-code table. Test in `sanitize.test.ts` is the safety net. |
| Module-scope cache in `loadPantheonConfig` complicates tests (a first test pollutes subsequent ones). | Loader module exports a `__resetCacheForTests()` symbol used by `beforeEach` in unit tests. Plan-level concern; called out here so the implementation surfaces it. |

## 11. Future Work (out of scope for this spec)

- `pantheon.json` schema extensions: `dispatch.maxParallel`, `logging.level`, `agents.<name>.temperature`, `agents.<name>.prompt` overrides.
- Per-dispatch model override (Perun chooses model per scenario complexity).
- Routing policy section (e.g. "scenarios with dependencies use a stronger model").
- Hot-reload via `fs.watch` on `pantheon.json`.
- Higher-tier deities for future major agents (Veles, Morana, Svarog).
- Migration: removing `docs/plugins/*` once harness migration completes.
