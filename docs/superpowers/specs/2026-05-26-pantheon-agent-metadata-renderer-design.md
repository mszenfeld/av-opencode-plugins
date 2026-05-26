# Spec 1A — Pantheon Agent Metadata Renderer

**Date:** 2026-05-26
**Status:** Approved — ready for implementation planning
**Author:** Marian Szenfeld (+ Claude)

## Context

Pantheon (the Perun harness in `av-opencode-plugins`) is heavily modeled on
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (omo). This spec
ports one omo pattern into Pantheon: **the orchestrator's prompt is partly generated
from per-subagent metadata.**

In omo, `src/agents/dynamic-agent-prompt-builder.ts` + `dynamic-agent-core-sections.ts`
build Sisyphus/Atlas prompt sections (Key Triggers, Tool/Agent Selection, Delegation
Table, Use/Avoid) from each subagent's `AgentPromptMetadata`. Adding a subagent never
requires editing the orchestrator prompt — the renderer reads metadata.

Pantheon today has a single static `src/agents/perun.md` loaded verbatim via
`getPerunPrompt()` in `src/modules/coordinator/index.ts`. There is exactly one
specialist (`zmora`, with internal variants `zmora-fe`/`zmora-be`) plus `fix-auto`.

This spec is the **first of three** in a sequence whose end goal is an exploration
agent ("Triglav") for Perun. The renderer is a prerequisite extracted so it can be
built, reviewed, and shipped independently of the agent itself.

- **Spec 1A (this document):** the metadata renderer infrastructure. No new agent.
- **Spec 1B (future):** Triglav, the explorer agent, consuming this infrastructure.
- **Spec 2 (future):** background (non-blocking) dispatch capability.

## Goal

Introduce metadata-driven rendering of Perun's prompt so that:

1. Each subagent declares `AgentPromptMetadata` in a `*.metadata.ts` file next to its
   `*.md` prompt.
2. A pure renderer composes Perun's prompt from a template (`perun.md` with
   placeholders) + the agent registry.
3. Adding a future specialist (Triglav, Librarian, Oracle, …) requires only a new
   `*.metadata.ts` + a placeholder — no manual edits to Perun's prose.

Zmora is refactored into this system as part of this spec, so the infrastructure has
a real client and is not built speculatively for a single future consumer.

## Non-goals

- The Triglav agent itself (Spec 1B).
- Background / non-blocking dispatch (Spec 2).
- Per-model prompt variants (omo has opus-4-7.md / gpt.md / gemini.md / kimi.md via
  `prompts-core`; Pantheon keeps one universal template — possible future spec).
- `<agent-identity>` override section (omo needs it for `mode: primary` identity;
  Perun's identity already comes from its frontmatter).
- Any change to QA tools, `dispatch_parallel`, skills under `packages/`, or the
  installer.

## Architecture

The renderer is a standalone module. Dependency direction is one-way:
`coordinator` → `agent-registry`. The coordinator calls the builder when assembling
Perun's prompt; the registry never depends on the coordinator.

```
BUILD-TIME (static):
  src/agents/zmora.metadata.ts   ─┐
  src/agents/triglav.metadata.ts ─┤  (added in 1B)
  …                              ─┘
            │  (static import)
            ▼
  src/modules/agent-registry/index.ts
     loadAgentRegistry() → SpecialistInfo[]      (deterministic order, no IO)

RUNTIME (once, at plugin start / config hook):
  coordinator/index.ts :: getPerunPrompt()
     1. template = loadModuleAsset("…/agents/perun.md")   // raw, with placeholders
     2. registry = loadAgentRegistry()
     3. prompt   = buildPerunPrompt(template, registry)   // substitutes {SPECIALISTS_TABLE} etc.
     4. cache := prompt                                    // cached once (static inputs)
            │
            ▼
  config hook: config.agent["Perun - Coordinator"].prompt = getPerunPrompt()
            │
            ▼
  OpenCode loads Perun with the fully-rendered prompt
```

Key properties:

- **One-way data flow** — metadata (build-time, static) → registry → builder → prompt → opencode.
- **No runtime IO in rendering** — `loadAgentRegistry()` is static TS imports, not a
  directory scan. The only IO is `loadModuleAsset` for the template (already the case today).
- **`buildPerunPrompt` is a pure function** `(template, registry) → string` — deterministic,
  testable in isolation, no opencode SDK dependency.
- **Cache** — inputs are static within the process, so the current
  `cachedPerunPrompt` (compute-once) pattern stays; it now caches the rendered result
  instead of the raw file.

### Section headers live in the builder, not the template

Each section's heading is part of the generated string (omo convention). When a
section is empty (e.g. an agent has no `keyTrigger`), the builder returns `""` and the
placeholder disappears with no orphaned heading. The template must therefore NOT carry
a static `### Key Triggers` heading above a placeholder.

## Components

### New files (in `src/modules/agent-registry/`)

| File | Responsibility |
|---|---|
| `agent-metadata.ts` | Types: `AgentPromptMetadata` (`category`/`cost`/`keyTrigger`/`useWhen`/`avoidWhen`/`triggers`/`promptAlias`), `AgentCategory` (`exploration`/`specialist`/`advisor`/`utility`), `AgentCost` (`FREE`/`CHEAP`/`EXPENSIVE`), `DelegationTrigger` (`{domain, trigger}`), `SpecialistInfo` (`{name, mode, description, metadata}`). 1:1 with omo `src/agents/types.ts` minus the model guards. |
| `index.ts` | `loadAgentRegistry(): SpecialistInfo[]` — collects static metadata of all subagents via static imports of `*.metadata.ts`. No dynamic file scan. Re-exports types. |
| `perun-prompt-builder.ts` | The full renderer. Five functions, each returns a markdown string or `""`: `buildSpecialistsTable`, `buildKeyTriggersSection`, `buildUseAvoidSection(agentName)`, `buildDelegationTable`, `buildPerunPrompt(template, registry)`. |

### New per-agent metadata

| File | Responsibility |
|---|---|
| `src/agents/zmora.metadata.ts` | Exports `zmoraMetadata: AgentPromptMetadata`. Logical name `zmora` (the `zmora-fe`/`zmora-be` variants are an implementation detail; metadata has one entry). `category: "specialist"`, no `keyTrigger` (Zmora is dispatched from a parsed QA plan, not phase-0 routing), `triggers: [{domain: "QA execution", trigger: "Execute FE/BE scenarios from a parsed plan"}]`. No `useWhen`/`avoidWhen` — Zmora is not a peer "fire-liberally" tool, so those sections stay empty for it. |

### Refactored files

| File | Change |
|---|---|
| `src/modules/coordinator/index.ts` | `getPerunPrompt()` loads `perun.md` as a template, calls `buildPerunPrompt(template, loadAgentRegistry())`, returns the rendered prompt. Cache key is effectively static (template + registry both static in-process), so the compute-once latch stays. Import direction: coordinator → agent-registry. |
| `src/agents/perun.md` | Introduce omo-style single-curly placeholders (regex-friendly): `{SPECIALISTS_TABLE}`, `{KEY_TRIGGERS}`, `{DELEGATION_TABLE}`, and per-agent `{USE_AVOID:<agent-name>}` (e.g. `{USE_AVOID:triglav}` lands in 1B). In 1A only `{SPECIALISTS_TABLE}` has content; the rest render to `""` until an agent supplies the data. |

## Error handling

This is an internal system with **no untrusted input** — metadata and template are
authored by us, not by the user. We validate only at genuine boundaries and trust
internal code (compile-time TS where it suffices).

| Situation | Behavior | Caught by |
|---|---|---|
| Malformed metadata shape | No runtime validation — `AgentPromptMetadata` is a TS type, errors are compile-time. No Zod/schema validator. | `tsc` / build |
| Duplicate agent name in registry | `loadAgentRegistry()` throws `Error("Duplicate agent metadata: <name>")` — fail-fast at startup (mirrors `mergeTools` duplicate-tool throw in `index.ts`). | Runtime startup + unit test |
| Missing placeholder in `perun.md` | Section simply not injected (builder has nowhere to put it). Dev-error, caught by test, not runtime. | `perun-prompt-integration.test.ts` |
| Unknown placeholder in `perun.md` (typo) | Builder substitutes only known placeholders; unknown stays literally in the prompt. | Test guard: rendered prompt contains no `/\{[A-Z_][A-Z0-9_:-]*\}/` |
| Empty section (agent without `keyTrigger`, etc.) | Builder returns `""`, placeholder disappears with no heading. Intended. | Unit test |

**Primary regression risk — Zmora.** Refactoring `getPerunPrompt()` touches code the
production QA flow depends on. Mitigation:

- **Before/after snapshot** of `getPerunPrompt()` output. After the refactor (with
  `{SPECIALISTS_TABLE}` rendered from Zmora's metadata), the specialist content
  (zmora/fix-auto, mode, purpose) must match; intentional formatting deltas are
  reviewed.
- No new untrusted-input surface → we do NOT add `neutralizeUntrustedOutput` here
  (that primitive is for specialist output in dispatch, not for our static metadata).

## Testing

TDD: the renderer is a set of pure functions, so tests are written first.

1. **Unit — `tests/modules/agent-registry/perun-prompt-builder.test.ts`** (core, written first):
   - `buildSpecialistsTable`: 0 agents → `""`; 1 → one row; N → deterministic order.
   - `buildKeyTriggersSection`: agent with `keyTrigger` → bullet; without → skipped;
     all without → `""` (no orphaned heading).
   - `buildUseAvoidSection("zmora")`: Zmora without `useWhen`/`avoidWhen` → `""`.
   - `buildDelegationTable`: expands `triggers[]` into `Domain → agent` rows.
   - `buildPerunPrompt`: substitutes known placeholders; unknown placeholder stays literal.
2. **Registry — `tests/modules/agent-registry/agent-registry.test.ts`**: collects
   registered agents; duplicate name throws; stable order.
3. **Integration — `tests/modules/agent-registry/perun-prompt-integration.test.ts`**:
   - Snapshot (or fragment assertions) of the full rendered Perun prompt for the current
     registry (Zmora).
   - Placeholder guard: no unsubstituted `{...}` remains.
   - Every placeholder declared in the builder actually appears in `perun.md` (template↔code sync).
4. **Anti-drift — `tests/agents/metadata-coverage.test.ts`**: every `src/agents/*.md`
   with `mode: subagent` has a paired `*.metadata.ts`; exceptions on an explicit
   allow-list (`perun`; `triglav` until 1B lands).
5. **Anti-regression Zmora**: baseline snapshot of `getPerunPrompt()` before the
   refactor; after, specialist content must match.

**Coverage:** pure functions → realistically ~100% on `perun-prompt-builder.ts`; hold to
the repo's existing threshold (developer skills cite 80%+). Conventions (vitest,
`tests/…` layout) follow the existing repo setup — no new test framework.

**Not tested:** the opencode SDK config hook (framework integration); model routing
(out of scope).

`scripts/verify-dist-sync.mjs` already exists; new files flow into `dist/` like
existing code with no separate change.

## Future work (context only — separate specs)

### Spec 1B — Triglav (explorer)
- `src/agents/triglav.md` (prompt: `<analysis>` intent + `<results>`/`<files>`/`<answer>`/`<next_steps>`,
  absolute paths, read-only, fire 3+ tools in parallel — omo Explore pattern).
- `src/agents/triglav.metadata.ts` (`category: "exploration"`, `cost: "FREE"`,
  `keyTrigger`, `useWhen`/`avoidWhen`).
- Hard dependency on serena MCP: `allowed-tools` with `serena_*`, guard in the `config`
  hook, installer registers serena MCP.
- **Blocking** dispatch (like Zmora, via `dispatch_parallel`).
- Consumes the 1A builders — does NOT touch `perun-prompt-builder.ts`, only adds metadata
  and a `{USE_AVOID:triglav}` placeholder.
- To be settled in the 1B brainstorm: exact output format, `useWhen`/`avoidWhen` wording,
  whether QA / code-review workflow gets a "pre-explore" step.

### Spec 2 — Background dispatch
- `dispatch_background` / `poll_background` / `wait_background` tools, task state persisted
  in `.pantheon/background-tasks.json` (analog to omo `.opencode/background-tasks.json`),
  updated via the `event` hook.
- Perun prompt section: "when to fire in background vs blocking".
- Triglav becomes the first client of background mode (switch from blocking).

**Dependency order:** 1A → 1B (1B needs the renderer) → 2 (2 improves 1B but isn't
required for it — Triglav works in blocking mode from 1B).
