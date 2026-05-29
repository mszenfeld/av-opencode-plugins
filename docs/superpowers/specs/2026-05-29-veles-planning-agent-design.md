# Veles — Pantheon Planning Specialist (Design)

**Date:** 2026-05-29
**Status:** Approved — revised after multi-agent verification (2026-05-29); ready for implementation plan
**Author:** Marian Szenfeld (with Claude)

> **Verification note (2026-05-29):** This spec was reviewed against the real codebase by four independent reviewers + sequential analysis. Foundation confirmed sound (`mode:"all"` is a valid SDK union member; Triglav mirror, `pantheon-config` open-endedness, metadata auto-render, skill auto-discovery, nested `Perun→Veles→Triglav` dispatch, and the `/create-qa-plan` extraction all verified). The §3 guard mechanism, the background-dispatch path, the `isToolSubset` framing, the no-plan branch location, the consent-gate dialog state, the plugin-tool opt-in mechanism, the git tokens, and the Veles output contract were **corrected** below per the review findings.

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

> **Deliberate divergence from OMO:** in OMO, Prometheus is a `mode: primary` planner that the user invokes — Sisyphus does **not** auto-dispatch it. Pantheon's design has **Perun dispatch Veles** (the auto QA-plan path), which is the one place Veles does NOT mirror Prometheus. This is enabled by the caller-aware guard relaxation (§3) and is an intentional choice, not faithful mirroring. Everything else (planner identity, helper-dispatch graph, `.md`-only output) follows OMO.

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

**Two distinct tool-gating mechanisms — do not conflate them** (verified against `explore/index.ts` + `qa/index.ts:160-164`):

1. **Built-in tools** → the markdown `allowed-tools:` frontmatter, emitted into the prompt by `prompt.ts` (as `TRIGLAV_TOOLS` is for Triglav). This is what `allowed-tools.ts` / `VELES_TOOLS` carries.
2. **Plugin tools** (`dispatch_parallel`, `dispatch_background`, `poll_background`, `wait_background`) → the SDK `AgentConfig.tools?: { [key]: boolean }` map on the `config.agent["veles"]` literal (exactly how QA opts `zmora-setup` into `execute_recipe`). These are registered process-wide by `AppVerkCoordinatorPlugin`; **no new tool factory is needed** — only the `tools:{…:true}` opt-in. Listing them in `VELES_TOOLS`/frontmatter is a **no-op** for plugin tools, so keep them OUT of `VELES_TOOLS`.

**`allowed-tools.ts` — `VELES_TOOLS`** (built-in tools only):
- serena read-tools (semantic context: endpoints/models/components) — reuse the set from `explore/allowed-tools.ts`;
- `Read`, `Glob`, `Grep`;
- `Bash(gh:*)`, `Bash(git diff:*)`, `Bash(git log:*)`, `Bash(git blame:*)`, `Bash(git symbolic-ref:*)`, `Bash(sed:*)`, `Bash(command:*)`, `Bash(date:*)`, `Bash(mkdir:*)` — the read/inspect + plan-dir subset the `qa-plan-authoring` skill body actually invokes. **Plain `git diff` (not `git --no-pager diff`)** to match the tokens the current `/create-qa-plan` runs; the Bash allow-list is gated by exact-token match (no wildcard subsumption), so the skill body and these tokens must agree literally. `git symbolic-ref` + `sed` cover the `MAIN_BRANCH` resolver;
- `Write` (plan markdown only — constrained by prompt).
- `skill`, `question`.

**`index.ts` — `AppVerkPlanPlugin`** (mirrors `AppVerkExplorePlugin`):
- `registerAgentMetadata(velesSpecialistInfo)`;
- `config.agent["veles"] = { description, mode: "all", get prompt() { return buildVelesPrompt() }, tools: { dispatch_parallel: true, dispatch_background: true, poll_background: true, wait_background: true } }` — the `tools` map is the ONLY place the dispatch plugin-tools are enabled;
- inject `loadPantheonConfig().agents.veles?.model` after registration (validated by `MODEL_REGEX`);
- `buildVelesPrompt()` memoizes via a module-scope `let cached` (like `explore/prompt.ts`); the emitted frontmatter `mode` must be sourced from Veles's own metadata (`"all"`) so prompt and `config.agent` literal agree;
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

**Caller identity — corrected mechanism (the original "via `sessionAgentRegistry`/`resolveParentID`" was wrong).** `sessionAgentRegistry` maps `childSessionID→task.name` and is written ONLY for sessions spawned *as dispatch tasks* (`dispatch.ts:372`); **Perun's root session is never in it**, and `resolveParentID` is a local helper in `qa/index.ts`, not shared plumbing. Use one of the two signals that actually exist:

- **Preferred — caller mode by name:** the dispatch tool's `execute(args, ctx)` receives `ctx.agent` (`ToolContext.agent`, the caller's agent name). Look it up in the already-loaded agent registry (`loadAgentRegistry`, `coordinator/index.ts:151`) to get its `mode`. **Naming pitfall:** Perun is registered under the display name `"Perun - Coordinator"` (`coordinator/index.ts` / `perun.md:2`), **not** `"perun"` — any caller-name comparison must use the registered key, not a guessed slug. `DISPATCHABLE_ALL_AGENTS = {"veles"}` is safe because Veles's registered key is literally `veles`.
- **Fallback — is-root test:** a caller whose session has no `parentID` (`client.session.get(ctx.sessionID).parentID === undefined`) is the root primary (Perun); dispatched children always carry `parentID` (`sdk-specialist.ts:29,71`). This sidesteps the naming pitfall entirely and is sufficient for the rule "only a primary may dispatch an allowlisted `all`."

**Signature change (net-new, not existing plumbing):** `validateDispatchable(agentRegistry, name)` gains a third argument `callerMode` (or `callerIsPrimary`). The caller is resolved in each dispatch tool's `execute` handler and threaded down. **Both call sites must be updated:**
1. `dispatch.ts:173` (the `dispatch_parallel` path, in `dispatchParallel`);
2. `background.ts:39` (the `dispatch_background` path, in `startBackgroundTask`) — and its `execute` handler (`coordinator/index.ts:264-282`) must resolve the caller too. **The original spec omitted the background path entirely.**

**Belt-and-suspenders:** an optional dispatch-depth cap (reject beyond depth 2: Perun→Veles→helper) guards against an unforeseen nesting cycle. Depth is derived by walking the session ancestry via repeated `client.session.get(parentID)` (the same call the is-root test uses) — **not** via the agent registry.

**Cost-DoS note:** `DISPATCH_MAX_TASKS = 4` and `BACKGROUND_MAX_CONCURRENT = 4` are **per-call / per-parent**, not global. Nesting multiplies the worst-case concurrent child count (Perun→Veles→Triglav can fan 4×4); the depth-2 cap bounds this. §3 acknowledges the bound is per-parent.

**Strings to update for the relaxation (model/user-visible):** (a) the comment block above `validateDispatchable` (`dispatch.ts:50-53`); (b) the `dispatch_parallel` tool description that tells the model "`mode: all` agent … rejected" (`coordinator/index.ts:87`). Both currently assert the old invariant.

### 4. Shared skill `src/skills/qa/qa-plan-authoring/SKILL.md`

Extract the **authoring core** from `/create-qa-plan.md` (today's steps 1–7):

1. resolve diff source (PR / branch / last-N-commits / staged / default);
2. classify each changed file FE vs BE;
3. gather context (routers, serializers, models, components, stores, docs, OpenAPI, existing tests);
4. detect available tools (`curl`, `httpie`, `psql`, `sqlite3`, `mysql`, `playwright`);
5. generate the `## Setup` section (infer env vars / services / databases per the existing rules);
6. generate FE / BE scenarios (concrete element/endpoint names, ≥2 edge cases each);
7. save to `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md`.

The skill **loads `test-plan-format`** for the output structure (the env-var regex `^[A-Z_][A-Z0-9_]*$`, DSN-scheme requirement, and ≤50 cap live in `test-plan-format`, so they survive the extraction).

**`allowed-tools` frontmatter — single-line, comma-separated** (the parser `parseSkillFrontmatter` splits on commas line-by-line; a multi-line YAML list would silently truncate to the first line). Use the **common denominator** that both the `/create-qa-plan` command and Veles actually possess, with **literal git tokens matching what the skill body runs**:
`Bash(gh:*), Bash(git diff:*), Bash(git log:*), Bash(git symbolic-ref:*), Bash(sed:*), Bash(command:*), Bash(date:*), Bash(mkdir:*), Read, Write, Glob, Grep` — deliberately **no serena** and **no `todowrite`** (todowrite stays command-side, see §5). The "serena-first context gathering, Grep/Glob fallback" preference lives in **Veles's prompt**, not in the skill.

> **`isToolSubset` is NOT a runtime guard.** Verification found `isToolSubset` and the parsed `allowedTools` field are **dead code** in the production path — never called/read by `load-skill.ts` / `prompt-injector.ts`. A skill's `allowed-tools` is actually enforced by the **native `skill()` runtime** (fed by `config.skills.paths`), which gates the skill body's tool calls (incl. exact-token Bash matching) against the **live agent's** tools. So the common-denominator set is a **sound authoring discipline** — the skill body must only use tools both callers truly have — but it is NOT enforced by `isToolSubset` at load time. Do not state otherwise. (A dedicated static test MAY call `isToolSubset` directly on the parsed frontmatter; see §9.)

**Git-token caveat:** the current `/create-qa-plan` runs plain `git diff …` (not `git --no-pager …`) and resolves the main branch via `git symbolic-ref refs/remotes/origin/HEAD | sed …`. The skill body MUST emit exactly those token forms (or rewrite the resolver via `git rev-parse`/`gh`), because the native runtime matches Bash tokens literally with no wildcard subsumption.

What stays *out* of the skill: the "what to do after generation" step, which differs per caller — the command says *review + `/run-qa`*; Veles returns a structured summary to Perun. `todowrite` progress tasks also stay command-side (not in the skill's tool set).

The skill is auto-discovered by `buildSkillCatalog` (directory scan) and by the native `skill()` loader's `config.skills.paths` — no manual registration in either.

### 5. Refactor `/create-qa-plan.md` → thin command

The command stays the manual entry point with **unchanged user-facing behavior** (ends with "review the plan, then `/run-qa`"), but its workflow body is replaced by `skill(name: "qa-plan-authoring")`. The command retains only: frontmatter / `allowed-tools`, `$ARGUMENTS` parsing, the `todowrite` progress tasks (which stay command-side — `todowrite` is in the command's `allowed-tools` but deliberately not in the skill's tool set), and the closing "propose `/run-qa`" step. Single source of truth = the skill.

### 6. Veles prompt (`veles.md`)

- **Identity:** "You are Veles, the Pantheon planning specialist. You author plans/specs for the coordinator — you do not execute the planned work." Writes only plan markdown.
- **Helpers (dispatch):** Triglav now (serena-first exploration; dispatch in parallel for different angles, then synthesize). Oracle / Momus listed as **"(reserved)"** — documented but not wired.
- **Modes (extensible):**
  - **QA test plan** (the one wired mode): load `qa-plan-authoring`, follow it to produce + save the plan, then return the structured summary.
  - Reserved: implementation plan, refactor plan, etc. — listed as future modes.
- **Interview mode** (`question`): for ambiguous/custom requests; **skipped** when the input is a clear diff/scope (the QA path).
- **Output contract — a JSON object** (Perun's result parser prefers JSON — `perun.md:187`, Tool Usage Rules): `{ "status": "ok" | "error" | "timeout", "plan_path": string, "fe_count": number, "be_count": number, "setup_prereqs": string[], "topic": string }`. The `status` field is required because Perun's no-plan branch (§7) branches on `error`/`timeout`. This result is parsed by the **new Step-1 consent logic**, NOT by Perun's Step-6 finding parser — it must never be threaded through `assign_issue_ids`.
- **Constraints:** no source-code edits; `Write` only to plan files under `docs/`; nested dispatch only to read-only helpers; never dispatch self or Perun.

### 7. Perun integration — two files, corrected

**Where the no-plan branch actually lives (corrected).** The original spec assumed `perun.md` Step 1 aborts on no-plan. It does **not** — `perun.md:47` scans `docs/testing/plans/` and auto-picks the newest `.md`. The hard abort *"No test plans found … Run `/create-qa-plan` first"* is in the entry command `run-qa.md:30-32`, and `run-qa.md` **deliberately excludes** `dispatch_parallel`/`task` and forbids dispatching (`run-qa.md` "What You MUST NOT Do"). So:

**7a. `run-qa.md` (entry command) — change the empty-plan branch.** Instead of hard-aborting with "Run `/create-qa-plan` first", hand off to Perun with a no-plan signal carrying any scope the user gave, e.g. `@perun no QA plan found — author one for <scope/$ARGUMENTS> then run it`. Remove the contradictory "run `/create-qa-plan` first" guidance from `run-qa.md:32` (the user-supplied bad-path branch at `run-qa.md:34-36` stays). `run-qa.md` still does NOT dispatch — it only hands off.

**7b. `perun.md` Workflow 1, Step 1 — add no-plan detection after the `ls` scan.** When the scan returns nothing (or Perun receives the no-plan handoff):

1. `dispatch_parallel({ agent: "veles", summary: "<≤80 chars, e.g. 'author QA plan: <short topic>'>", tasks: [{ name: "veles", prompt: "Generate a QA test plan for <diff source>. <scope hint>" }] })`. The `summary` is hard-capped at 80 chars by the tool — truncate `<scope>`. `agent:"veles"` (5 chars) is within the 60-char cap; single task ⇒ no `×N`.
2. Parse Veles's **JSON** result (§6): `status`, `plan_path`, counts, `setup_prereqs`.
3. **Planning-consent gate** (see new dialog state below).

**New dialog state: "Planning-consent gate"** (parallel to the NEED_INFO dialog; required because existing resume semantics, `perun.md:370-402`, model only preflight + NEED_INFO and assume "Perun stores no files — the status snapshot is canonical"). This gate has **no wave/NEED_INFO snapshot**; its canonical cross-turn state is the **`plan_path` Veles returned**, which Perun carries verbatim in its own turn text. Add a third **verbatim** prompt template (Perun's prompts are verbatim-by-contract, `perun.md:283`):

```
🧭 No QA plan existed — Veles authored one:

  Plan: <plan_path>
  Scenarios: <fe_count> FE, <be_count> BE
  Setup prerequisites: <setup_prereqs joined, or "none">

Run QA on this plan now? Reply 'yes' to run, 'abort' to stop
(the plan is saved either way — you can review/edit it first).
```

Resume entry for this gate: on `yes` (and yes-equivalents per the existing intent map) → enter Workflow 1 at **Step 2** using `plan_path` (read → sanitize → preflight → dispatch). On `abort` → stop; plan stays saved. Ambiguous reply → re-ask once. This is **intra-Workflow-1** and does **not** emit a Composability proposal (those fire only after a completed run, `perun.md:466-479`); the normal post-run "Chcesz, żebym naprawił…" proposal still fires after the QA run completes.

**Edge cases:**
- Veles `status: ok` but `fe_count + be_count == 0` (no changes / no scenarios) → Perun informs the user, does not run, does not show the consent gate.
- Veles `status: error | timeout` → Perun surfaces it verbatim, does not run.
- Diff source for the auto path follows the same default as `/create-qa-plan` (open PR on current branch → branch diff fallback), plus any scope hint forwarded from `run-qa.md`.

Perun's `allowed-tools` already include `dispatch_parallel` (`perun.md:5`), so no Perun frontmatter change beyond the Veles row auto-appearing in its prompt tables.

### 8. Plumbing / config

- `pantheon.json` → `agents.veles.model` works without schema change (the `agents` map is open-ended; unknown agent keys are accepted, `model` is the only known field, validated by `MODEL_REGEX`).
- Build: `scripts/copy-root-assets.mjs` copies `["commands","agents","skills"]` **and** walks `src/modules/<name>/**/*.md`. So the new skill (`src/skills/qa/qa-plan-authoring/SKILL.md`) ships via the `skills` root, and **`veles.md` ships via the `src/modules/<name>` walk** — note Veles's prompt lives at `src/modules/plan/veles.md` (per §2), NOT under `src/agents/`. No per-skill/per-agent manifest or `package.json` `files[]` change is needed.
- **`dist` must be rebuilt and committed.** `scripts/verify-dist-sync.mjs` fails CI if `dist` is stale, so the implementer MUST run the build and commit the regenerated `dist/skills/qa/qa-plan-authoring/` + `dist/modules/plan/` artifacts. (No test asserts an exact skill/agent file list, and the packed-tarball top-level set test is unaffected — only `dist` contents change.)
- Add `AppVerkPlanPlugin` to `src/index.ts` `defaultPluginFactories`.

### 9. Testing

- **Metadata:** `veles.metadata` registration + idempotence; Veles appears in the sorted registry and renders in Perun's prompt. **Add a renderer test for an `all`-mode specialist row** specifically — no current specialist is `all`, so `buildSpecialistsTable` has never exercised that value.
- **Prompt + config:** `buildVelesPrompt()` returns the prompt with `mode: all` in frontmatter; config injection sets `mode: "all"`, the `tools:{dispatch_*:true}` opt-in map, the built-in `allowed-tools`, and the model from `pantheon.json` (mirror Triglav tests).
- **Guard (caller-aware), parallel path:** `validateDispatchable` with the new `callerMode` arg — Perun(primary)→Veles ✓, Veles(non-primary)→Veles ✗, *→Perun ✗, Veles→Triglav(subagent) ✓, non-allowlisted `all` target ✗; optional depth-cap test.
- **Guard (caller-aware), background path:** the SAME matrix against `startBackgroundTask`/`background.ts:39` (extend `tests/modules/coordinator/background.test.ts`) — the background call site is a separate code path and MUST be covered.
- **Caller resolution:** unit-test that the dispatch `execute` handler resolves caller mode from `ctx.agent`→registry (and/or the `parentID===undefined` is-root path), including the `"Perun - Coordinator"` (not `"perun"`) naming case.
- **Skill discovery:** discovered by `buildSkillCatalog`; no duplicate name; frontmatter is a single comma-separated `allowed-tools` line that parses.
- **Skill tool subset (static, NOT load-time):** a static assertion test that calls `isToolSubset(skillTools, commandTools)` and `isToolSubset(skillTools, velesTools)` directly on the parsed frontmatter sets. Note in the test that this is an authoring-discipline check, not a runtime guard (`isToolSubset` is not wired into any load path). Matching is exact-token, so the asserted sets must be token-identical.
- **Command:** `/create-qa-plan` still yields a valid plan after the thin refactor (skill body unchanged in substance); the skill body's Bash tokens match the granted `allowed-tools` (plain `git diff`, `git symbolic-ref`/`sed`).
- **Perun flow:** "no plan → dispatch Veles → consent gate → run" path (analogous to `perun-qa-flow.test.ts`), including: zero-scenario edge (no gate), `error`/`timeout` edge (surface, no run), and `abort` (plan saved, stop). Cover the `run-qa.md` empty-plan handoff no longer emitting "run `/create-qa-plan` first".

### 10. Out of scope (YAGNI)

- Oracle / Momus / Metis agents — only referenced as "(reserved)" in Veles's prompt.
- Non-QA planning modes — scaffolded in the prompt, not implemented.
- A hook enforcing the write-restriction (markdown-only) — prompt-enforced for now; a hook can be added later if drift appears.

## Open questions

None blocking. The write-restriction hook and the additional helper agents (Oracle/Momus) are deferred by explicit decision.
