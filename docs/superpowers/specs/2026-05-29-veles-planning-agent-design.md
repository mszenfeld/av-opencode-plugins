# Veles — Pantheon Planning Specialist (Design)

**Date:** 2026-05-29
**Status:** Approved — ready for implementation plan
**Author:** Marian Szenfeld (with Claude)

## Context

Pantheon is the OpenCode harness modeled on [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (OMO). Today the coordinator **Perun** runs QA test plans (`/run-qa`) by dispatching `zmora` variants per scenario. Plans are authored separately and manually via the `/create-qa-plan` command. When `/run-qa` finds no plan, it currently aborts with "Run `/create-qa-plan` first".

We want to close that gap by introducing a dedicated **planning agent** that Perun can summon to author a QA plan on demand — and, more broadly, a general-purpose planner in the spirit of OMO's Prometheus.

### OMO reference (verified in source)

- **Prometheus** is OMO's strategic planner. `mode: primary`, interview-mode (talks to the user), and it **dispatches read-only helper subagents itself**: `task(subagent_type="explore" | "librarian" | "oracle")`, plus **Metis** (gap analysis) and **Momus** (plan critic). It may write **only `.md`** (hook-enforced); plans land in `.omo/plans/`.
- `explore`, `librarian`, `oracle`, `momus`, `metis` are all `mode: subagent`.
- **Nested dispatch is allowed in OMO** — e.g. Metis (a subagent) itself calls `call_omo_agent(subagent_type="explore")`. OMO is a *graph* of agents, not a single orchestrator with leaf subagents.

### Mapping to Pantheon

| OMO | Pantheon |
|---|---|
| Sisyphus (orchestrator, primary) | **Perun** |
| Prometheus (planner, primary, dispatches helpers) | **Veles** (this design) |
| explore (subagent) | **Triglav** (exists) |
| oracle / momus / metis (subagents) | future Veles helpers (out of scope now) |

### Decisions made during brainstorming

1. **Scope:** general planner (Prometheus analog), with **QA test-plan generation as the first wired mode**; prompt is extensible for future modes (no rework needed to add them). YAGNI on the other modes.
2. **DRY:** the QA-plan authoring workflow is **extracted into a shared skill** (`qa-plan-authoring`) consumed by both the `/create-qa-plan` command and Veles — single source of truth, no drift.
3. **Auto-gen flow:** generate → summarize → **consent gate** → run (no silent auto-run).
4. **Name:** Veles (chosen deliberately despite the Perun↔Veles mythological rivalry — the wisdom/strategy association wins).
5. **Mode:** `all` + a **narrow, caller-aware relaxation** of the anti-recursion guard so Perun can dispatch Veles while keeping every other invariant intact.
6. **Tools:** Veles gets serena read-tools (semantic context), plan-writing `Write`, and dispatch tools so it can orchestrate Triglav now and Oracle/Momus later.

## Hard constraint from the codebase

`src/modules/coordinator/dispatch.ts` — `validateDispatchable` validates **only the dispatch target** (`task.name` must be `subagent`); it does **not** restrict the caller. The "only Perun dispatches" property comes purely from `allowed-tools` (only Perun's frontmatter lists `dispatch_parallel`). Two consequences:

- **Granting Veles dispatch tools lets it dispatch Triglav** (target is a `subagent`, so it passes). Nested `Perun → Veles → Triglav` is technically supported (OMO does the equivalent).
- `validateDispatchable` rejects both `primary` and `all` targets. So **a `primary`/`all` Veles cannot be dispatched by Perun** without changing the guard — hence the caller-aware relaxation in §3.

## Design

### 1. Role of Veles

Veles is a **general planning specialist**, `mode: "all"`:

- **as primary** — user invokes via `@veles` or switches to it; interview-capable for custom/ambiguous planning requests;
- **as subagent** — Perun dispatches it (auto-generation of a QA plan when `/run-qa` finds none);
- **orchestrates read-only helpers** — Triglav now; Oracle/Momus reserved for later;
- **writes only plan markdown** (analogous to Prometheus's `.md`-only constraint; prompt-enforced now, optional hook later).

### 2. New module `src/modules/plan/`

Mirrors `src/modules/explore/` (Triglav):

```
src/modules/plan/
  veles.metadata.ts   # VELES_AGENT_KEY="veles"; SpecialistInfo
  veles.md            # agent prompt
  prompt.ts           # buildVelesPrompt() (+ serena degradation toast like Triglav)
  allowed-tools.ts    # VELES_TOOLS
  index.ts            # AppVerkPlanPlugin
```

**`veles.metadata.ts`** — `SpecialistInfo`:
- `name: "veles"`, `mode: "all"`, `description` (planner that authors plans for the coordinator; does not execute work).
- `metadata`: `category: "specialist"`, `cost: "EXPENSIVE"` (reads diff + context and generates — not a cheap read like Triglav), `keyTrigger` (e.g. *"`/run-qa` invoked with no plan present → dispatch `veles` to author one before attempting QA"*), `useWhen` / `avoidWhen`, `triggers` (domain: "Planning", trigger: "Author a QA test plan / work plan from a diff or request").

**`allowed-tools.ts` — `VELES_TOOLS`:**
- serena read-tools (semantic context: endpoints/models/components) — reuse the set from `explore/allowed-tools.ts`;
- `Read`, `Glob`, `Grep`;
- `Bash(gh:*)`, `Bash(git --no-pager log:*)`, `Bash(git --no-pager diff:*)`, `Bash(git --no-pager blame:*)`, `Bash(command:*)`, `Bash(date:*)`, `Bash(mkdir:*)` (the read/inspect + plan-dir subset needed by `qa-plan-authoring`);
- `Write` (plan markdown only — constrained by prompt);
- `skill`, `question`;
- `dispatch_parallel`, `dispatch_background`, `poll_background`, `wait_background` (to orchestrate Triglav now, Oracle/Momus later).

**`index.ts` — `AppVerkPlanPlugin`** (mirrors `AppVerkExplorePlugin`):
- `registerAgentMetadata(velesSpecialistInfo)`;
- `config.agent["veles"] = { description, mode: "all", get prompt() { return buildVelesPrompt() }, tools: { dispatch_parallel: true, ... } }`;
- inject `loadPantheonConfig().agents.veles?.model` after registration (validated by `MODEL_REGEX`);
- reuse `isSerenaAvailable` + one-time degraded-mode warning toast on `session.created`.

Register `AppVerkPlanPlugin` in `src/index.ts` `defaultPluginFactories`. Veles then auto-renders in Perun's `SPECIALISTS_TABLE` / `DELEGATION_TABLE` / `KEY_TRIGGERS` via the existing placeholder machinery.

### 3. Caller-aware guard relaxation (`coordinator/dispatch.ts`)

Introduce an allowlist `DISPATCHABLE_ALL_AGENTS = new Set(["veles"])` and make `validateDispatchable` aware of the **caller's mode**:

| Target | Caller | Verdict |
|---|---|---|
| `subagent` (e.g. Triglav) | anyone | ✅ (unchanged) |
| `all` ∈ allowlist (Veles) | **primary** (Perun) | ✅ (new) |
| `all` (Veles) | non-primary (e.g. Veles itself) | ❌ — blocks self / nested recursion |
| `primary` (Perun) | anyone | ❌ (unchanged) |

Net effect: **Perun→Veles ✓, Veles→Triglav ✓, Veles→Veles ✗, *→Perun ✗.**

- **Caller identity** is resolved at dispatch time from the session that invoked the dispatch tool, via the existing `sessionAgentRegistry` / `resolveParentID` plumbing in the coordinator. The coordinator's `dispatch_parallel` tool handler passes the caller's resolved agent mode (or a `callerIsPrimary` boolean) into `validateDispatchable`.
- **Belt-and-suspenders:** an optional dispatch-depth cap (reject beyond depth 2: Perun→Veles→helper) guards against any unforeseen nesting cycle. Depth is derivable from the session ancestry chain.
- The change is additive and preserves the existing security narrative; the comment block above `validateDispatchable` is updated to document the allowlist + caller-aware rule as the single source of truth.

### 4. Shared skill `src/skills/qa/qa-plan-authoring/SKILL.md`

Extract the **authoring core** from `/create-qa-plan.md` (today's steps 1–7):

1. resolve diff source (PR / branch / last-N-commits / staged / default);
2. classify each changed file FE vs BE;
3. gather context (routers, serializers, models, components, stores, docs, OpenAPI, existing tests);
4. detect available tools (`curl`, `httpie`, `psql`, `sqlite3`, `mysql`, `playwright`);
5. generate the `## Setup` section (infer env vars / services / databases per the existing rules);
6. generate FE / BE scenarios (concrete element/endpoint names, ≥2 edge cases each);
7. save to `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md`.

The skill **loads `test-plan-format`** for the output structure. Its `allowed-tools` frontmatter is the **common denominator** (`Bash(gh:*)`, `Bash(git …:*)`, `Bash(command:*)`, `Bash(date:*)`, `Bash(mkdir:*)`, `Read`, `Write`, `Glob`, `Grep`) — deliberately **no serena**, so `isToolSubset` passes when the skill is loaded by both the `/create-qa-plan` command (no serena) and Veles. The "serena-first context gathering, Grep/Glob fallback" preference lives in **Veles's prompt**, not in the skill.

What stays *out* of the skill: the "what to do after generation" step, which differs per caller — the command says *review + `/run-qa`*; Veles returns a structured summary to Perun.

The skill is auto-discovered by `buildSkillCatalog` (directory scan) — no manual registration.

### 5. Refactor `/create-qa-plan.md` → thin command

The command stays the manual entry point with **unchanged user-facing behavior** (ends with "review the plan, then `/run-qa`"), but its workflow body is replaced by `skill(name: "qa-plan-authoring")`. The command retains only: frontmatter / `allowed-tools`, `$ARGUMENTS` parsing, and the closing "propose `/run-qa`" step. Single source of truth = the skill.

### 6. Veles prompt (`veles.md`)

- **Identity:** "You are Veles, the Pantheon planning specialist. You author plans/specs for the coordinator — you do not execute the planned work." Writes only plan markdown.
- **Helpers (dispatch):** Triglav now (serena-first exploration; dispatch in parallel for different angles, then synthesize). Oracle / Momus listed as **"(reserved)"** — documented but not wired.
- **Modes (extensible):**
  - **QA test plan** (the one wired mode): load `qa-plan-authoring`, follow it to produce + save the plan, then return the structured summary.
  - Reserved: implementation plan, refactor plan, etc. — listed as future modes.
- **Interview mode** (`question`): for ambiguous/custom requests; **skipped** when the input is a clear diff/scope (the QA path).
- **Output contract** (machine-parseable block Perun reads): `plan_path`, `fe_count`, `be_count`, `setup_prereqs` (the `## Setup` items), `topic`.
- **Constraints:** no source-code edits; `Write` only to plan files under `docs/`; nested dispatch only to read-only helpers; never dispatch self or Perun.

### 7. Perun integration (`perun.md`, Workflow 1, Step 1)

When invoked with no plan path **and** no plan found in `docs/testing/plans/`, instead of aborting:

1. `dispatch_parallel({ agent: "veles", summary: "generate QA plan: <scope>", tasks: [{ name: "veles", prompt: "Generate a QA test plan for <diff source>. <scope hint>" }] })`.
2. Parse Veles's structured summary (`plan_path`, counts, `setup_prereqs`).
3. **Consent gate:** display the summary + "Run QA on this plan? (yes / abort)" and wait for the user's next turn. On `yes` → continue Step 2 with `plan_path` (read → sanitize → preflight → dispatch). On `abort` → stop; the plan remains saved for manual review.

**Edge cases:**
- Veles reports no changes / zero scenarios → Perun informs the user, does not run.
- Veles returns `status: error` / `timeout` → Perun surfaces it verbatim, does not run.
- The diff source for the auto path follows the same default as `/create-qa-plan` (open PR on current branch → branch diff fallback), plus any scope hint the user gave.

Perun's `allowed-tools` already include `dispatch_parallel`, so no frontmatter change beyond the Veles row appearing automatically. The consent gate reuses the existing resume intent-recognition (yes/abort) conventions.

### 8. Plumbing / config

- `pantheon.json` → `agents.veles.model` works without schema change (the `agents` map is open-ended; unknown agent keys are accepted, `model` is the only known field, validated by `MODEL_REGEX`).
- Build: `scripts/copy-root-assets.mjs` already copies `src/skills` and `src/agents` (so `veles.md` + the new skill ship); `scripts/verify-dist-sync.mjs` covers `dist/skills` and `dist/agents`.
- Add `AppVerkPlanPlugin` to `src/index.ts` `defaultPluginFactories`.

### 9. Testing

- **Metadata:** `veles.metadata` registration + idempotence; Veles appears in the sorted registry and renders in Perun's prompt (extend `perun-prompt-builder` tests).
- **Prompt + config:** `buildVelesPrompt()` returns the prompt; config injection sets `mode: "all"`, the tool set, and the model from `pantheon.json` (mirror Triglav tests).
- **Guard (caller-aware):** `validateDispatchable` — Perun→Veles ✓, Veles→Veles ✗, *→Perun ✗, Veles→Triglav ✓, non-allowlisted `all` target ✗; optional depth-cap test.
- **Skill:** discovered by `buildSkillCatalog`; no duplicate name; `allowed-tools` is a subset of both the command's and Veles's tool sets (`isToolSubset`).
- **Command:** `/create-qa-plan` still yields a valid plan after the thin refactor (skill body unchanged in substance).
- **Perun flow:** "no plan → dispatch Veles → consent gate → run" path (analogous to `perun-qa-flow.test.ts`), including the edge cases.

### 10. Out of scope (YAGNI)

- Oracle / Momus / Metis agents — only referenced as "(reserved)" in Veles's prompt.
- Non-QA planning modes — scaffolded in the prompt, not implemented.
- A hook enforcing the write-restriction (markdown-only) — prompt-enforced for now; a hook can be added later if drift appears.

## Open questions

None blocking. The write-restriction hook and the additional helper agents (Oracle/Momus) are deferred by explicit decision.
