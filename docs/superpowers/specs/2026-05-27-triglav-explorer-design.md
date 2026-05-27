# Spec 1B — Triglav (Exploration Agent)

**Date:** 2026-05-27
**Status:** Approved — ready for implementation planning
**Author:** Marian Szenfeld (+ Claude)

## Context

Pantheon (the Perun harness in `av-opencode-plugins`) is modeled on
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (omo). This is the
**second of three** specs in the explorer sequence:

- **Spec 1A (done):** the agent-metadata renderer. Perun's prompt is generated from
  per-agent `SpecialistInfo` pushed into a registry; `getPerunPrompt()` renders
  `perun.md` (a template with `{SPECIALISTS_TABLE}`/`{KEY_TRIGGERS}`/`{DELEGATION_TABLE}`
  and per-agent `{USE_AVOID:<name>}` placeholders) via the pure `buildPerunPrompt`.
  In 1A only `{SPECIALISTS_TABLE}` had content (zmora, fix-auto); the other sections
  rendered to `""`.
- **Spec 1B (this document):** Triglav, a read-only codebase exploration agent that
  consumes the 1A infrastructure and becomes the first client of the
  `{KEY_TRIGGERS}` / `{DELEGATION_TABLE}` / `{USE_AVOID:triglav}` sections.
- **Spec 2 (future):** background (non-blocking) dispatch. Triglav becomes its first
  client (switch from blocking).

Triglav ("three-headed") is named for the explorer pattern of firing 3+ search tools
in parallel. It is the Pantheon analogue of omo's `Explore` agent.

### What we copied from omo (verified against `dev` branch)

omo treats `Explore` as an **on-demand, "fire-liberally peer tool"** — dispatched
conditionally by intent, NOT as a mandatory pre-implementation phase. Its only proactive
pre-exploration is pushed into a planning-advisor (Metis), which Pantheon does not have.
So Triglav is **ad-hoc** in 1B (see Non-goals). We also port omo's Explore prompt
techniques (see "Agent prompt") and its metadata shape (`category: "exploration"`,
`cost: "FREE"`, `useWhen`/`avoidWhen` framed so the orchestrator skips trivial lookups).

### Current Pantheon facts this design fits

- Agents are registered by a module's `config` hook into `config.agent[name]` with a
  frontmatter `allowed-tools` string (the **runtime security boundary** — an agent
  physically cannot invoke a tool outside its allow-list). The QA module registers the
  three `zmora-*` variants; the coordinator registers Perun; `packages/code-review`
  registers `fix-auto`.
- Plugin factories run via `Promise.all` in `src/index.ts` **before** any `config` hook,
  so metadata pushed in a factory body is present when `getPerunPrompt()` renders lazily.
- `dispatch_parallel` (Perun's only dispatch path) is hard-capped at 4 tasks, validates
  each task against the live agent registry (rejects unknown / `mode: primary` agents),
  applies `neutralizeUntrustedOutput` + truncation to every result, and is **blocking**.

## Goal

Add **Triglav**, a read-only exploration specialist Perun can dispatch (blocking, via
`dispatch_parallel`) to map codebase structure, find definitions/references/patterns, and
return a synthesized answer. Triglav:

1. Prefers **serena MCP** (semantic LSP) tools, with **Grep/Glob/Read fallback** when
   serena is unavailable or a serena call fails.
2. Is **read-only** (enforced by `allowed-tools` + prompt).
3. Outputs **omo-style blocks** (`<analysis>` + `<results>` wrapping
   `<files>`/`<answer>`/`<next_steps>`) for Perun to parse and optionally surface.
4. Registers its `SpecialistInfo` via the 1A bridge, activating Perun's
   `{KEY_TRIGGERS}`, `{DELEGATION_TABLE}`, and `{USE_AVOID:triglav}` sections.

## Non-goals

- **No mandatory "pre-explore" step** in Perun's QA (Workflow 1) or Fix (Workflow 2)
  flows. Triglav is ad-hoc / fire-liberally, matching omo. Explicit pre-explore
  integration is a possible later spec, deferred until we observe Triglav in practice.
- **No background / non-blocking dispatch** (Spec 2). Triglav is blocking in 1B.
- **No external/web/docs exploration** (that would be a "Librarian" analogue — future).
  Triglav explores the **local codebase only**.
- **No change to `buildPerunPrompt` / the 1A builders** — they already support
  `keyTrigger`/`useWhen`/`avoidWhen`/`triggers` and the `{USE_AVOID:<name>}` form
  (exercised by 1A unit tests with synthetic agents). 1B only registers metadata and adds
  one placeholder to `perun.md`.
- **No installer work** — serena installation/registration is out of scope; 1B handles
  serena *absence* gracefully at runtime (see Error handling).
- **No per-model prompt variants** — one universal `triglav.md`.

## Architecture

A new module `src/modules/explore/`, symmetric to `src/modules/qa/`:

```
src/modules/explore/
  index.ts            # AppVerkExplorePlugin (Plugin). config hook:
                      #   - registers config.agent["triglav"] (prompt from triglav.md,
                      #     allowed-tools from TRIGLAV_TOOLS, mode: subagent)
                      #   - one-time serena-absence warning toast
                      # factory body: registerAgentMetadata(triglavSpecialistInfo)
  triglav.metadata.ts # triglavSpecialistInfo: SpecialistInfo (from agent-registry)
  allowed-tools.ts    # TRIGLAV_TOOLS: read-only serena_* + Read/Glob/Grep + read-only Bash
  serena-detect.ts    # isSerenaAvailable(config): boolean — pure, testable in isolation
  triglav.md          # static agent prompt (frontmatter + body), loaded via loadModuleAsset
```

Data flow (mirrors 1A's registration timing guarantee):

```
FACTORY TIME (Promise.all in src/index.ts, before any config hook):
  explore/index.ts factory body → registerAgentMetadata(triglavSpecialistInfo)
            │
            ▼
  agent-registry singleton now holds: fix-auto, triglav, zmora

CONFIG HOOK TIME:
  explore/index.ts config hook:
     config.agent["triglav"] = { description, mode: "subagent",
                                 get prompt() { return <triglav.md, cached> },
                                 ... }              // allowed-tools via frontmatter in triglav.md
     if (!isSerenaAvailable(config)) showToast(warning)   // one-time

  coordinator/index.ts config hook (runs later):
     getPerunPrompt() → buildPerunPrompt(perun.md, getAgentMetadataRegistry())
       → {SPECIALISTS_TABLE} gains a triglav row
       → {KEY_TRIGGERS} / {DELEGATION_TABLE} now non-empty (triglav supplies them)
       → {USE_AVOID:triglav} renders triglav's use/avoid section
```

**Prompt delivery:** a single static `triglav.md` (one agent, no variants — unlike Zmora's
dynamic variant builder). Frontmatter: `name: triglav`, `mode: subagent`,
`allowed-tools: <TRIGLAV_TOOLS joined>`. Loaded once via `loadModuleAsset` + cached
(same pattern as Perun/QA assets).

**Dependency direction:** `explore → agent-registry` (for `SpecialistInfo` +
`registerAgentMetadata`). No reverse edges. Coordinator and QA modules are untouched
except that Perun's rendered prompt automatically gains Triglav's content.

**Wiring:** add `AppVerkExplorePlugin` to `defaultPluginFactories` in `src/index.ts`.

### `allowed-tools` (the security boundary)

`TRIGLAV_TOOLS` (read-only):

- **serena (semantic LSP, read-only subset):** `serena_find_symbol`,
  `serena_find_referencing_symbols`, `serena_get_symbols_overview`,
  `serena_search_for_pattern`, `serena_find_file`, `serena_list_dir`, `serena_read_file`.
  (Plus `serena_find_declaration` / `serena_find_implementations` /
  `serena_get_diagnostics_for_file` if present in the installed serena build — the plan
  pins the exact list against the available tool names.)
- **fallback search:** `Read`, `Glob`, `Grep`.
- **read-only Bash:** `Bash(grep:*)`, `Bash(cat:./*)`, `Bash(head:./*)`, `Bash(tail:./*)`,
  `Bash(rg:*)`, `Bash(git log:*)`, `Bash(git blame:*)`.

Explicitly EXCLUDED (must never appear): `Write`, `Edit`, any `serena_*` write/edit tool
(`serena_create_text_file`, `serena_replace_symbol_body`, `serena_insert_*`,
`serena_rename_symbol`, `serena_replace_content`, `serena_safe_delete_symbol`,
`serena_write_memory`, `serena_execute_shell_command`, `serena_activate_project`),
`dispatch_parallel` (no recursive dispatch), `Task`.

## Components

### Agent prompt (`triglav.md`)

Frontmatter (above) + body, porting omo Explore's load-bearing techniques (each is
deliberate and pinned by an anti-regression test, mirroring omo's `explore-tool-strategy.test`):

1. **Identity:** "You are **Triglav**, a read-only codebase exploration specialist. You map
   structure, find definitions/references/patterns, and return a concise synthesis — you
   do not perform work or modify files." (Role-as-capability framing; "contextual grep".)
2. **Mandatory pre-search `<analysis>`:** before ANY search, emit `<analysis>` with three
   fields — **Literal Request / Actual Need / Success Looks Like**. Forces intent
   decomposition + a self-defined done-criterion.
3. **Hard parallelism floor:** "In your **first action**, fire **3+ tools simultaneously**.
   Go sequential **only** when an input genuinely depends on a prior result." Cross-validate
   findings across tools.
4. **Intent→tool decision table, serena-first:** definitions/references/symbols →
   `serena_find_symbol` / `serena_find_referencing_symbols` / `serena_get_symbols_overview`;
   structural patterns → `serena_search_for_pattern`; raw strings/comments → `Grep`;
   filename/extension → `Glob`; history/who-changed → `Bash(git log/blame)`. Reach for
   serena LSP first; Grep/Glob are **peer fallbacks for a different job**, not failure modes.
5. **serena-failure fallback:** "If a `serena_*` call errors (server unavailable), do NOT
   retry it — switch to `Grep`/`Glob`/`Read` and continue."
6. **Read-only as capability fact:** "You cannot create, modify, or delete files; report
   findings as message text, never write files." (Backed by `allowed-tools`.)
7. **Output discipline:** always end with the **exact** `<results>` skeleton below; in
   `<answer>` **explain the mechanism**, never paste whole files; all paths **absolute**
   (start with `/`); **no emojis** — keep output machine-parseable.
8. **FAILED checklist (negative self-audit):** "Your response has FAILED if: any path is
   relative; you missed obvious matches; the caller must still ask 'but where exactly?';
   you answered only the literal question; or there is no `<results>` block."
9. **Stop condition + completeness:** "Done = the caller can proceed **without a follow-up
   question**. Find **ALL** relevant matches, not just the first."

Output skeleton:

```
<analysis>
Literal Request: …
Actual Need: …
Success Looks Like: …
</analysis>
<results>
  <files>
  /abs/path/foo.ts:42 — what is here and why it matters
  </files>
  <answer>
  Direct synthesis answering the exploration question (explain the mechanism).
  </answer>
  <next_steps>
  Suggested follow-ups / where to look next (or "Ready to proceed — no follow-up needed").
  </next_steps>
</results>
```

### Metadata (`triglav.metadata.ts`)

```
triglavSpecialistInfo: SpecialistInfo = {
  name: "triglav",
  mode: "subagent",
  description: "Read-only codebase explorer: maps structure, finds definitions/references/patterns via serena LSP (Grep/Glob fallback). Returns a synthesized answer, not edits.",
  metadata: {
    category: "exploration",
    cost: "FREE",
    keyTrigger: "2+ modules / unfamiliar area involved → fire `triglav` before planning",
    useWhen: ["Multiple search angles needed", "Unfamiliar module structure", "Cross-layer pattern discovery", "User asks where/how something works in the codebase"],
    avoidWhen: ["You already know the exact file/location", "A single keyword/grep suffices", "The target was just shown in this conversation"],
    triggers: [{ domain: "Code exploration", trigger: "Find definitions, references, structure, and patterns in the local codebase" }],
  },
}
```

### `perun.md` edit (the only template change in 1B)

Add a `{USE_AVOID:triglav}` placeholder (e.g. under the Available Specialists block, after
`{DELEGATION_TABLE}`). The 1A builder renders it from Triglav's `useWhen`/`avoidWhen`. Also
add a short static note to "Tool Usage Rules":

- Fire `triglav` *liberally* (cost FREE) for exploratory questions / unfamiliar areas; up
  to **4 in parallel** via `dispatch_parallel` for different search angles (cap 4, **blocking**
  — Perun waits for the result).
- **Delegation Trust Rule:** once you dispatch `triglav` for a search, do NOT redo that same
  search yourself.
- Do NOT fire `triglav` for a location you already know (see its Avoid-when list).

No change to Perun's frontmatter: `dispatch_parallel` is already allowed and its
anti-recursion preflight accepts `triglav` (`mode: subagent`).

### `serena-detect.ts`

`isSerenaAvailable(config): boolean` — a pure function that inspects the resolved OpenCode
config for a registered `serena` MCP server entry. No IO; takes the config object the hook
already receives. (The plan pins the exact config field by inspecting the OpenCode config
shape; conceptually it checks the MCP server map for a `serena` key.)

## Error handling

No untrusted input is introduced beyond what `dispatch_parallel` already neutralizes for
every specialist result. Internal code is trusted (compile-time TS).

| Situation | Behavior | Caught by |
|---|---|---|
| serena MCP absent at startup | Register `triglav` anyway; emit a **one-time** warning toast + `console.error` ("Triglav registered but serena MCP not found — exploration runs in degraded mode; install serena for semantic search"). Mirrors the coordinator's `toastShown` latch. | `serena-detect` unit test + toast test |
| `serena_*` call fails mid-session | Prompt rule: do NOT retry; switch to `Grep`/`Glob`/`Read`. Degraded mode still returns useful results. | prompt phrase-pin test |
| Triglav attempts a write/edit tool | Rejected by the runtime `allowed-tools` gate (tool not in list). Defense in depth: prompt's read-only capability statement. | `allowed-tools` test (no write/edit/serena-write present) |
| `triglav` task returns error/timeout from `dispatch_parallel` | Perun handles it like any specialist result (existing machinery; `neutralizeUntrustedOutput` + truncation already applied). No new handling. | existing dispatch tests |
| Malformed metadata | Compile-time TS (`SpecialistInfo`); `registerAgentMetadata` is idempotent on identical re-registration and throws only on a genuine name conflict (1A behavior). | `tsc` / 1A registry tests |

**serena absence is a warning, not a hard failure** (user decision: "register + warn"). This
softens 1A's stated "hard dependency" to a strong preference with graceful degradation —
recorded here intentionally so a future installer spec can decide whether to harden it.

## Testing

TDD. New tests under `tests/modules/explore/`, plus extensions to two existing 1A tests.

1. **`serena-detect.test.ts`** — `isSerenaAvailable` returns true when a `serena` MCP entry
   is present in the config, false when absent / config has no MCP map.
2. **`allowed-tools.test.ts`** (security boundary) — `TRIGLAV_TOOLS` includes the read-only
   serena subset + `Read`/`Glob`/`Grep` + read-only Bash; and asserts it contains **none** of
   the forbidden tools (`Write`, `Edit`, any `serena_*` write/edit, `serena_execute_shell_command`,
   `dispatch_parallel`, `Task`). A regex/denylist assertion so a future careless edit fails loudly.
3. **`triglav-prompt.test.ts`** (anti-regression phrase-pin, mirrors omo) — `triglav.md`
   contains the load-bearing phrases: `3+`, "first action", "Read-only" (capability statement),
   "absolute" (path rule), the `<results>`/`<files>`/`<answer>`/`<next_steps>` skeleton, the
   FAILED checklist, and the serena→Grep/Glob fallback rule. Frontmatter has `mode: subagent`
   and `allowed-tools` equal to `TRIGLAV_TOOLS`.
4. **`plugin.test.ts`** (module registration) — constructing `AppVerkExplorePlugin` and running
   its `config` hook sets `config.agent["triglav"]` with `mode: "subagent"` and the
   `allowed-tools` string; and the factory has registered `triglavSpecialistInfo` (assert via
   `getAgentMetadataRegistry()` after `clearAgentMetadataRegistry()`).
5. **`serena-toast.test.ts`** — when `isSerenaAvailable` is false, the config hook attempts the
   warning toast exactly once (best-effort; headless failure must not throw). When serena is
   present, no toast.
6. **Extend `tests/modules/agent-registry/perun-prompt-integration.test.ts`** — with `triglav`
   in the registry, the rendered Perun prompt contains: a `triglav` specialists-table row, a
   Key-Triggers bullet (from `keyTrigger`), a Delegation-Table row (from `triggers`), and a
   `Use \`triglav\` when:` section (from `{USE_AVOID:triglav}` in `perun.md`); and still no
   unsubstituted `{...}` placeholder.
7. **Update `tests/modules/agent-registry/metadata-coverage.test.ts`** — remove `triglav` from
   the anti-drift allow-list (it now MUST have metadata) and assert the registry covers
   `triglav` (alongside `zmora`, `fix-auto`). Construct the explore plugin so its registration
   participates.
8. **`tests/root-plugin.test.ts` (+ cross-plugin if it asserts the plugin set)** — update for
   the added `AppVerkExplorePlugin` so the plugin count / merge expectations stay correct.
9. Full `npm run check` + `npm run verify-dist`; commit regenerated `dist/`.

**Not tested:** the live serena MCP itself (framework integration); model routing; whether
Perun *chooses* to dispatch Triglav (prompt-driven behavior, not deterministic).

## Future work (context only — separate specs)

- **Spec 2 — background dispatch.** Triglav becomes the first non-blocking client
  (`dispatch_background` / `poll` / `wait`). Note omo holds background task state in-memory in
  a `TaskStateManager`, not file-backed via hook — Pantheon will decide its own persistence.
- **Pre-explore workflow integration** — if practice shows value, add an explicit exploration
  step to Perun's QA/Fix workflows (deferred per the ad-hoc decision above).
- **Hardening serena** — a future installer spec may turn the warning into a hard gate.
- **Librarian analogue** — external docs/library exploration (omo's `Librarian`), out of scope.
