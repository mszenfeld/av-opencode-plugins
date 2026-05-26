# Spec 1A — Pantheon Agent Metadata Renderer

**Date:** 2026-05-26
**Status:** Approved — ready for implementation planning
**Author:** Marian Szenfeld (+ Claude)

## Context

Pantheon (the Perun harness in `av-opencode-plugins`) is heavily modeled on
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (omo). This spec
ports one omo idea into Pantheon: **the orchestrator's prompt is partly generated
from per-subagent metadata.**

In omo, `src/agents/dynamic-agent-prompt-builder.ts` + `dynamic-agent-core-sections.ts`
build Sisyphus/Atlas prompt sections (Key Triggers, Tool & Agent Selection, Delegation
Table, and per-agent use/avoid guidance) from each subagent's `AgentPromptMetadata`
(defined in omo `src/agents/types.ts`). Adding a subagent never requires editing the
orchestrator prompt — the renderer reads metadata.

We port the *idea*, not omo's file layout. Notable differences confirmed against omo:

- omo's `AgentPromptMetadata` fields (`category`/`cost`/`keyTrigger`/`useWhen`/
  `avoidWhen`/`triggers`/`promptAlias`, plus `dedicatedSection` which we omit) and its
  enums (`AgentCategory` = exploration/specialist/advisor/utility, `AgentCost` =
  FREE/CHEAP/EXPENSIVE, `DelegationTrigger` = `{domain, trigger}`) are reused as-is.
- `SpecialistInfo` is **our own** wrapper type, not an omo type. omo carries `mode` on
  its agent factory (`AgentMode`) and its summary struct is just `{name, description}`.
  We bundle `{name, mode, description, metadata}` because, in Pantheon, name/mode/
  description are known at the point an agent is registered (see Architecture).
- omo's "Use/Avoid" is **not** a single named section — it is rendered inline per agent
  from `useWhen`/`avoidWhen`. We follow that: a per-agent block, not a global section.
- The exact omo heading is **"Tool & Agent Selection"** (ampersand), not "Tool/Agent".

### Pantheon's current reality (what the renderer must fit)

- `src/agents/` contains **only `perun.md`** (`mode: primary`). There is no per-subagent
  `.md` file there. The renderer must NOT assume a `src/agents/<agent>.md` per subagent.
- **Zmora** has no static `.md`: its prompt is built dynamically by `buildQATesterAgent()`
  (`src/modules/qa/prompt-builder.ts`) and registered as **three** physical variants —
  `zmora-fe`, `zmora-be`, `zmora-setup` (`VARIANTS` in `src/modules/qa/index.ts`). Perun's
  specialist table shows **one logical** `zmora` row.
- **`fix-auto`** lives in a **separate build unit**: `packages/code-review/`
  (`packages/code-review/src/index.ts` registers it; prompt at `agents/fix-auto.md`
  inside that package). It is consumed by `src/` only via its built `dist/`.

Perun's prompt today is a single static `src/agents/perun.md`, loaded via
`getPerunPrompt()` in `src/modules/coordinator/index.ts` (compute-once latch
`cachedPerunPrompt`, wired through a `get prompt()` getter on
`config.agent["Perun - Coordinator"]`). The "Available Specialists" table (`zmora`,
`fix-auto`) is hand-written prose.

### Architectural constraint — plugins→harness migration (recurring)

Pantheon is mid-migration from an old plugin-based architecture to a full harness. As a
legacy artifact, `packages/*` are independent build units: **dependency direction is
strictly `src/ → packages/` (via `dist/`); packages CANNOT import from `src/`** (verified:
no package→src imports, no tsconfig path mappings, no shared-types package). This boundary
shapes the design below (it is why `fix-auto` cannot use the same registration bridge as
`zmora`) and will recur for every cross-cutting concern until packages are migrated in.

This spec is the **first of three** in a sequence whose end goal is an exploration
agent ("Triglav") for Perun. The renderer is a prerequisite extracted so it can be
built, reviewed, and shipped independently of the agent itself.

- **Spec 1A (this document):** the metadata renderer infrastructure. No new agent.
- **Spec 1B (future):** Triglav, the explorer agent, consuming this infrastructure.
- **Spec 2 (future):** background (non-blocking) dispatch capability.

## Goal

Introduce metadata-driven rendering of Perun's prompt so that:

1. Each subagent's routing/delegation metadata (`AgentPromptMetadata`) is declared once,
   next to where that agent is registered, and contributed to a shared registry.
2. A pure renderer composes Perun's prompt from a template (`perun.md` with
   placeholders) + the agent registry.
3. Adding a future specialist (Triglav, Librarian, Oracle, …) requires only registering
   its metadata + a placeholder — no manual edits to Perun's prose.

Zmora **and** fix-auto are refactored into this system as part of this spec, so the
infrastructure has real clients (and the two existing specialist-table rows are
preserved with no regression) rather than being built speculatively.

## Non-goals

- The Triglav agent itself (Spec 1B).
- Background / non-blocking dispatch (Spec 2).
- Per-model prompt variants (omo has default.md / opus-4-7.md / gpt.md / gemini.md /
  kimi.md via `prompts-core`; Pantheon keeps one universal template — possible future spec).
- `<agent-identity>` override section (omo needs it for `mode: primary` identity;
  Perun's identity already comes from its frontmatter).
- Migrating `packages/*` into the harness, or letting `code-review` own its own metadata
  via a shared types package (a future migration step — see fix-auto handling below).
- Any change to QA tools, `dispatch_parallel`, skills under `packages/`, or the installer.

## Architecture

Metadata is **pushed** into a shared registry by whoever registers the agent — it is not
pulled by scanning files. This mirrors the existing `registerDispatchExtensions` bridge
(`src/modules/_shared/dispatch-extensions.ts`, ARCH-002), which already lets the QA module
feed data to the coordinator's `dispatch_parallel` **without** a `coordinator → qa` layer
inversion. We reuse that proven direction for metadata. Dependency direction stays one-way:
`coordinator` → `agent-registry`; modules → `agent-registry`; the registry depends on
nobody.

```
FACTORY TIME (src/index.ts runs all plugin factories via Promise.all,
              BEFORE any config hook fires):

  src/modules/qa/index.ts  (factory body)
     registerAgentMetadata(zmoraSpecialistInfo)        ─┐
  src/modules/agent-registry/index.ts                   │  push into
     registerAgentMetadata(fixAutoSpecialistInfo)       │  shared registry
       (explicit src-side entry — fix-auto lives in a   │  (module-level
        package and cannot import this bridge)         ─┘   singleton)
            │
            ▼
  agent-registry singleton: SpecialistInfo[]  (insertion-tracked,
                                               getter returns name-sorted copy)

RUNTIME (lazy, first time OpenCode reads Perun's prompt — registry already full):

  coordinator/index.ts :: getPerunPrompt()              (compute-once latch stays)
     1. template = loadModuleAsset(".../agents/perun.md")  // raw, with placeholders (one IO read)
     2. registry = getAgentMetadataRegistry()              // pure read of the singleton
     3. prompt   = buildPerunPrompt(template, registry)    // PURE: substitutes {SPECIALISTS_TABLE} etc.
     4. cachedPerunPrompt := prompt
            │
            ▼
  config hook: config.agent["Perun - Coordinator"] = { get prompt() { return getPerunPrompt() }, … }
            │
            ▼
  OpenCode loads Perun with the fully-rendered prompt
```

**Timing guarantee.** `src/index.ts` awaits all plugin factories (`Promise.all`) before
any `config` hook runs, and the coordinator's `get prompt()` is evaluated lazily by
OpenCode after config assembly. So every module's `registerAgentMetadata(...)` (called in
its factory body, exactly like `registerDispatchExtensions`) has executed before
`getPerunPrompt()` reads the registry. No ordering fragility.

Key properties:

- **One-way data flow** — modules push metadata → registry → builder → prompt → opencode.
  No `coordinator → qa` / `agent-registry → src/agents` inversion.
- **`buildPerunPrompt(template, registry)` is a pure function** `(string, SpecialistInfo[]) → string`
  — deterministic, no IO, no opencode SDK dependency, fully testable in isolation.
- **The one IO read stays in `getPerunPrompt()`** — `loadModuleAsset(perun.md)`, exactly as
  today. The purity claim is scoped to the builder, not to `getPerunPrompt()`.
- **Cache** — registry and template are static within the process, so the existing
  `cachedPerunPrompt` compute-once latch is retained; it now caches the rendered result.

### fix-auto: explicit src-side entry (chosen for 1A)

Because `fix-auto` lives in `packages/code-review` and packages cannot import the
`registerAgentMetadata` bridge from `src/` (migration constraint above), 1A keeps a small
explicit `SpecialistInfo` for `fix-auto` in `src/modules/agent-registry/fix-auto.metadata.ts`
and registers it from the agent-registry module itself. This is a localized exception to
the "module owns its metadata" rule, justified by the build boundary. It preserves the
fix-auto row with zero drift risk in practice (fix-auto's identity changes rarely). A
future migration step (out of scope) can let `code-review` own its metadata once a shared
types package exists or the package is absorbed into the harness.

### Section headers live in the builder, not the template

Each section's heading is part of the generated string (omo convention). When a
section is empty (e.g. an agent has no `keyTrigger`), the builder returns `""` and the
placeholder disappears with no orphaned heading. The template must therefore NOT carry
a static `### Key Triggers` heading above a placeholder.

## Components

### New files (in `src/modules/agent-registry/`)

| File | Responsibility |
|---|---|
| `agent-metadata.ts` | Types: `AgentPromptMetadata` (`category`/`cost`/`keyTrigger`/`useWhen`/`avoidWhen`/`triggers`/`promptAlias`), `AgentCategory` (`exploration`/`specialist`/`advisor`/`utility`), `AgentCost` (`FREE`/`CHEAP`/`EXPENSIVE`), `DelegationTrigger` (`{domain, trigger}`), and our wrapper `SpecialistInfo` (`{name, mode, description, metadata}`). Reuses omo `src/agents/types.ts` field/enum names; `SpecialistInfo` is Pantheon-specific. |
| `index.ts` | The registry. `registerAgentMetadata(info: SpecialistInfo): void` (push; throws `Error("Duplicate agent metadata: <name>")` on duplicate logical name — mirrors the `mergeTools` duplicate-tool throw in `src/index.ts`). `getAgentMetadataRegistry(): SpecialistInfo[]` (returns a name-sorted copy for deterministic order). **Name chosen to avoid collision** with the existing async `loadAgentRegistry()` in `coordinator/sdk-specialist.ts` (live SDK registry — a different concern). Registers the `fix-auto` entry on load. Re-exports types. |
| `perun-prompt-builder.ts` | The renderer. Five pure functions, each returns a markdown string or `""`: `buildSpecialistsTable`, `buildKeyTriggersSection`, `buildUseAvoidSection(agentName)`, `buildDelegationTable`, `buildPerunPrompt(template, registry)`. |
| `fix-auto.metadata.ts` | Explicit src-side `SpecialistInfo` for `fix-auto` (`name: "fix-auto"`, `mode: "subagent"`, description from the current perun.md row, `category: "utility"`, `triggers: []` in 1A — delegation-table content is deferred to 1B so `{DELEGATION_TABLE}` renders empty for now; see "Section headers live in the builder"). See "fix-auto: explicit src-side entry" above. |

### Module-contributed metadata

| Location | Change |
|---|---|
| `src/modules/qa/index.ts` | In the factory body (next to the existing `registerDispatchExtensions(...)` call), `registerAgentMetadata(zmoraSpecialistInfo)` — **one logical `zmora` entry** despite the three physical `zmora-fe/be/setup` variants. `category: "specialist"`, no `keyTrigger` (Zmora is dispatched from a parsed QA plan, not phase-0 routing), `triggers: []` in 1A (Zmora is dispatched from a parsed plan, not via the delegation table; delegation content is deferred to 1B). No `useWhen`/`avoidWhen` — Zmora is not a peer "fire-liberally" tool. `name`/`mode`/`description` taken from the same values the module already uses when registering the variants. |

### Refactored files

| File | Change |
|---|---|
| `src/modules/coordinator/index.ts` | `getPerunPrompt()` loads `perun.md` as a template, calls `buildPerunPrompt(template, getAgentMetadataRegistry())`, returns the rendered prompt. The compute-once latch (`cachedPerunPrompt`) and the `get prompt()` getter stay. New import: coordinator → agent-registry. Does NOT touch the existing async `loadAgentRegistry` re-export. |
| `src/agents/perun.md` | Introduce omo-style single-curly placeholders (regex-friendly): `{SPECIALISTS_TABLE}`, `{KEY_TRIGGERS}`, `{DELEGATION_TABLE}`, and per-agent `{USE_AVOID:<agent-name>}` (e.g. `{USE_AVOID:triglav}` lands in 1B). In 1A only `{SPECIALISTS_TABLE}` has content (rendering both `zmora` and `fix-auto` rows); the rest render to `""` until an agent supplies the data. The current hand-written specialist table is removed in favor of `{SPECIALISTS_TABLE}`. |

## Error handling

This is an internal system with **no untrusted input** — metadata and template are
authored by us, not by the user. We validate only at genuine boundaries and trust
internal code (compile-time TS where it suffices).

| Situation | Behavior | Caught by |
|---|---|---|
| Malformed metadata shape | No runtime validation — `AgentPromptMetadata`/`SpecialistInfo` are TS types, errors are compile-time. No Zod/schema validator. | `tsc` / build |
| Duplicate logical agent name | `registerAgentMetadata()` throws `Error("Duplicate agent metadata: <name>")` — fail-fast at factory time (mirrors `mergeTools` duplicate-tool throw in `src/index.ts`). | Runtime startup + unit test |
| Missing placeholder in `perun.md` | Section simply not injected (builder has nowhere to put it). Dev-error, caught by test, not runtime. | `perun-prompt-integration.test.ts` |
| Unknown placeholder in `perun.md` (typo) | Builder substitutes only known placeholders; unknown stays literally in the prompt. | Test guard: rendered prompt contains no `/\{[A-Z_][A-Za-z0-9_:-]*\}/` (note: char class includes `a-z` so lowercase per-agent targets like `{USE_AVOID:triglav}` are caught). |
| `{USE_AVOID:<name>}` with empty / unknown agent target | Builder throws `Error("Unknown agent in placeholder: <name>")` for a target not in the registry; empty target is a compile-time-impossible / test-caught dev error. Mirrors the duplicate-name fail-fast. | Unit test |
| Empty section (agent without `keyTrigger`, etc.) | Builder returns `""`, placeholder disappears with no heading. Intended. | Unit test |

**Primary regression risk — Zmora + fix-auto.** Refactoring `getPerunPrompt()` touches code
the production QA flow depends on, and replaces the hand-written specialist table.
Mitigation:

- **Committed fixture, captured now.** Snapshot the current `getPerunPrompt()` output to a
  committed fixture file **before** the refactor. After the refactor (with
  `{SPECIALISTS_TABLE}` rendered from the `zmora` + `fix-auto` metadata), the parsed
  specialist rows (name, mode, purpose) must equal the rows parsed from the fixture — both
  rows present, no dropped `fix-auto`. Intentional formatting deltas are reviewed.
- No new untrusted-input surface → we do NOT add `neutralizeUntrustedOutput` here (that
  primitive is for specialist output in dispatch, not for our static metadata).

## Testing

TDD: the renderer is a set of pure functions, so tests are written first.

1. **Unit — `tests/modules/agent-registry/perun-prompt-builder.test.ts`** (core, written first):
   - `buildSpecialistsTable`: 0 agents → `""`; 1 → one row; N → name-sorted deterministic order.
   - `buildKeyTriggersSection`: agent with `keyTrigger` → bullet; without → skipped;
     all without → `""` (no orphaned heading).
   - `buildUseAvoidSection("zmora")`: Zmora without `useWhen`/`avoidWhen` → `""`.
   - `buildDelegationTable`: expands `triggers[]` into `Domain → agent` rows.
   - `buildPerunPrompt`: substitutes known placeholders; unknown placeholder stays literal;
     `{USE_AVOID:<unknown>}` throws; lowercase-named placeholder (`{USE_AVOID:triglav}` with a
     synthetic registered `triglav`) is substituted (regression for the regex char-class fix).
2. **Registry — `tests/modules/agent-registry/agent-registry.test.ts`**: `registerAgentMetadata`
   adds; duplicate logical name throws; `getAgentMetadataRegistry()` returns a name-sorted copy.
   Determinism asserted against **≥2 entries** (real set already has `zmora` + `fix-auto`, so this
   is meaningful, not a tautology).
3. **Integration — `tests/modules/agent-registry/perun-prompt-integration.test.ts`**:
   - Snapshot (or fragment assertions) of the full rendered Perun prompt for the current
     registry (`zmora` + `fix-auto`).
   - Placeholder guard: no unsubstituted `{...}` remains (using the `a-z`-inclusive regex).
   - Every placeholder declared in the builder actually appears in `perun.md` (template↔code sync).
4. **Anti-drift — `tests/modules/agent-registry/metadata-coverage.test.ts`**: every agent
   registered into OpenCode config with `mode: subagent` (the `zmora-*` variants → logical
   `zmora`; `fix-auto`) is covered by a `SpecialistInfo` in the registry. Exceptions on an
   explicit allow-list (`triglav` until 1B lands). Note: this checks *registered agents*, not
   `src/agents/*.md` files (there are none for subagents).
5. **Anti-regression Zmora + fix-auto**: the committed before-refactor fixture (above); after,
   parsed specialist rows must match — both `zmora` and `fix-auto` rows present.

**Coverage:** pure functions → realistically ~100% on `perun-prompt-builder.ts`; hold to
the repo's existing convention (developer skills cite 80%+; note `vitest.config.ts` does
not enforce a hard gate today). Conventions (vitest, `tests/…` layout) follow the existing
repo setup — no new test framework.

**Not tested:** the opencode SDK config hook (framework integration); model routing
(out of scope).

`scripts/verify-dist-sync.mjs` already exists; new files flow into `dist/` like
existing code with no separate change.

## Future work (context only — separate specs)

### Spec 1B — Triglav (explorer)
- `src/agents/triglav.md` (prompt: `<analysis>` intent + `<results>`/`<files>`/`<answer>`/`<next_steps>`,
  absolute paths, read-only, "launch 3+ tools simultaneously" — omo Explore pattern, confirmed in
  omo `src/agents/explore.ts`).
- `triglav` metadata registered via `registerAgentMetadata` (`category: "exploration"`,
  `cost: "FREE"`, `keyTrigger`, `useWhen`/`avoidWhen`).
- Hard dependency on serena MCP: `allowed-tools` with `serena_*`, guard in the `config`
  hook, installer registers serena MCP.
- **Blocking** dispatch (like Zmora, via `dispatch_parallel`).
- Consumes the 1A builders — does NOT touch `perun-prompt-builder.ts`, only registers metadata
  and adds a `{USE_AVOID:triglav}` placeholder (the first real consumer of the per-agent
  use/avoid path and the lowercase-target regex fix).
- To be settled in the 1B brainstorm: exact output format, `useWhen`/`avoidWhen` wording,
  whether QA / code-review workflow gets a "pre-explore" step.

### Spec 2 — Background dispatch
- `dispatch_background` / `poll_background` / `wait_background` tools. **Note:** in omo the
  live task state is held **in-memory** in a `TaskStateManager` (Maps), not file-backed; the
  committed `.opencode/background-tasks.json` is a fixture/snapshot, not a hook-written store.
  Pantheon's Spec 2 should decide its own persistence strategy (in-memory vs file) explicitly
  rather than assuming omo persists to that path.
- Perun prompt section: "when to fire in background vs blocking".
- Triglav becomes the first client of background mode (switch from blocking).

**Dependency order:** 1A → 1B (1B needs the renderer) → 2 (2 improves 1B but isn't
required for it — Triglav works in blocking mode from 1B).
