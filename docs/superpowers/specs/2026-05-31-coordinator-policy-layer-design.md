# Coordinator Policy Layer — Design

**Date:** 2026-05-31
**Status:** Draft for review — revised after a 4-lens mixture-of-agents review
(runtime correctness, architecture/build-boundary, adversarial, spec quality).

**Goal:** Raise Perun's "strict orchestrator" role from **advisory prose** to a
**code-enforced workflow rail** — a small **reusable, agent-keyed policy layer** that
closes the coordinator's git/bash and skill channels, and emits a telemetry signal
when the rail is hit. This is **defense-in-depth + reusable substrate + an evaluation
signal**, consistent with the existing security-model doctrine in
`docs/plugins/coordinator.md` ("code-enforced rules are the boundary; LLM-requested
rules are defense-in-depth, not the last line of defense"). It is **not** a security
sandbox and — see *What this does NOT fix* — it is **not** the fix for the delegation
behaviour that triggered it.

---

## Background — why this exists

A manual test asked Perun (the coordinator) to "review the changes on this branch
and test them manually." Instead of delegating (Veles to plan, Zmora to execute),
Perun ran `git status`/`log`/`diff`/`show`/`branch -r`, read source files, and
loaded the `be-testing` skill (a Zmora skill) — all **forbidden by its own prompt**.

Root cause, confirmed in code — two compounding facts:

1. **The role boundary is advisory, not enforced.** Perun's `allowed-tools`
   frontmatter (`src/agents/perun.md:5`, git deliberately absent) is only embedded
   in the system prompt as text. Its agent registration
   (`src/modules/coordinator/index.ts:346–366`) has **no `tools` field**, so
   OpenCode lets it call anything. The only bash hook (`src/modules/commit/bash-policy.ts`)
   blocks just `git commit`/`git push` and is self-documented as "a workflow rail,
   NOT a security boundary." (Build is **not** stale — `dist/agents/perun.md` ==
   `src/agents/perun.md`; `mode: primary` governs recursion, not tools.)
2. **A weak model was on the role.** The session ran Perun on **Kimi K2.6**. With
   an unenforced rail, the whole "delegate, don't execute" discipline depends on the
   model voluntarily obeying prose — which a weaker model does not.

**Aggravator:** the skill-registry injects "you MUST load applicable skills" into
**every** agent's system prompt (`packages/skill-registry/src/index.ts:54`,
`experimental.chat.system.transform`), and the skill-loading tools are globally
available — actively pulling a compliant generalist toward self-execution.

**Key insight:** the two fixes we chose (A = bash rail, C = skill exposure) reduce to
the **same** missing capability — *"which agent is calling right now?"* — which the
hooks do **not** provide (`tool.execute.before` input is `{ tool, sessionID, callID }`;
`experimental.chat.system.transform` is `{ sessionID?, model }` — neither carries an
`agent` field). So both levers need a **session → coordinator?** resolver.

---

## What this does NOT fix (read before scoping)

The review made two limits explicit; the spec states them so the plan does not
over-promise:

- **It does not make Perun delegate.** Blocking `git` closes a channel; it does not
  put the model on the delegation rail. "Review the changes … test them manually"
  matches **no** Workflow-1 trigger (`docs/plugins/coordinator.md` — "No intent
  detection; workflow selection is driven by literal cues"); the no-plan→Veles branch
  only fires *once already inside* a QA run. Making free-form requests route to the
  right workflow is the job of the **deferred intent gate** and of **model selection**
  (operator's choice, out of this spec). This layer is what the intent gate will sit
  **on top of**, not a substitute for it.
- **It does not stop read-only "digging."** Perun legitimately keeps `Read`, `Grep`,
  `Glob`, `ls` (it must read the plan file and scan `docs/testing/plans/`). A model
  blocked from `git log` can still `Read`/`Grep` source. So A closes the **git/bash**
  channel only — one of several exploration vectors. Path-scoping `Read`/`Grep`/`Glob`
  is **out of scope** (brittle, conflicts with legitimate plan-reading) and listed as
  a possible future tightening.

What it **does** deliver: a code-enforced git/bash + skill rail for the coordinator
(defense-in-depth, raising prompt-injection escalation cost for any model), a reusable
agent-keyed substrate for the future intent gate, and the **eval signal** (F) that
would have auto-flagged the Kimi behaviour.

---

## Scope

**In scope:** **A** (coordinator bash rail), **C** (coordinator skill exposure),
**E** (build A+C as one reusable, agent-keyed layer), **F** (violation telemetry that
the eval can read), **G** (instructive rejections).

**Deferred (unchanged, by decision):** OMO-style **intent gate**; **model-floor
warning**; **setting Perun's model** in `pantheon.json` (operator's choice — explicitly
left out of this spec); changing the external **superpowers** SessionStart framing
(neutralised indirectly by C *iff* the native `skill` tool proves gateable — see B2).

---

## Architecture

### 1. Agent identity at runtime — a STATELESS resolver (revised)

> **Revision:** the prior draft keyed this on the QA `SessionAgentRegistry`. The
> review found that fatal: (i) a dispatched child is registered **only after its
> whole turn completes** (`dispatch.ts:408` runs after the blocking `startTask`/
> `session.prompt`, `sdk-specialist.ts:38`), so a specialist's mid-turn `git` would
> resolve to "unknown" and be wrongly blocked on the **common** path; (ii) the
> registry is a **QA-owned per-plugin instance**, not process-global, and
> `packages/skill-registry` cannot share its populated state across the bundle
> boundary; (iii) Veles is `mode:"all"` and **user-switchable** — run as primary it
> is parentless, so a naive "unknown ⇒ coordinator" rule mis-polices it.

Use a **stateless** `isCoordinatorSession(sessionID, client)` resolver that both build
units import (no shared mutable map):

- A **dispatched child** has a `parentID` (`client.session.get(sessionID).parentID`
  is set — the same call `src/modules/qa/index.ts:56` `resolveParentID` already
  makes). A child is **never** the coordinator → pass through.
- The **coordinator** is the **parentless** session **running the Perun agent**
  (`name === "Perun - Coordinator"`). Parentless-but-not-Perun (e.g. Veles run as
  primary) is **not** the coordinator → pass through.

**Open question (resolve in plan step 1):** confirm the session object exposes its
agent identity (so we can assert `agent === Perun`, not merely "parentless").
`resolveParentID` proves `parentID` is reachable; the agent field needs verification.
- **If agent identity is reachable:** positive identification, robust, handles
  Veles-as-primary correctly.
- **If not:** fall back to "parentless ⇒ coordinator" and **register dispatched
  children before `session.prompt`** (a small reorder in `sdk-specialist.ts` /
  `dispatch.ts`) so children are positively excluded; **document Veles-as-primary as a
  known mis-policing** until agent identity is obtainable.

**Fail direction is per-lever (not global):**
- **Bash rail (A):** fail **OPEN** on identity uncertainty — never block a possible
  specialist. A is defense-in-depth, and a wrongly-blocked specialist breaks the
  harness's core flows; a coordinator call that slips through is still discouraged by
  prose and logged.
- **Injection suppression (C-lever-2):** fail **CLOSED** (suppress) when `sessionID`
  is absent (the `Agent.generate` path passes none) — suppression is harmless there.

### 2. Where the resolver lives (packages↔src boundary)

The resolver is consumed by **`src/modules/*`** (bash rail) and
**`packages/skill-registry`** (injection suppression). Per the migration rule,
packages cannot import `src/`. Because the resolver is now **stateless** (it does its
own `client.session.get`, holds no map), placement is clean: a tiny **shared package**
both build units depend on (src→pkg and pkg→pkg form a diamond, no cycle). This
sidesteps the QA-ownership and cross-bundle-shared-state problems entirely.

**Open question (resolve in plan step 1):** exact home — a new minimal shared package
vs. an existing one. The current `src/modules/_shared` location is **not** importable
by packages, so it is ruled out.

### 3. A — bash rail (coordinator); defense-in-depth, not a sandbox

A `tool.execute.before` handler for `tool === "bash"`:

1. Resolve the caller (§1). If **not** the coordinator → pass through (the global
   `git commit`/`git push` block in `bash-policy.ts` still applies to everyone).
2. If the coordinator: parse the command and **allow only** the programs the
   coordinator declares — `mkdir`, `ls`, `./scripts/qa-preflight.sh`; reject the rest
   by **throwing** an instructive `Error` (G). Throw-to-block is confirmed: the
   runtime awaits `tool.execute.before` before `tool.execute`, and the existing commit
   gate blocks exactly this way (`src/modules/commit/index.ts:75,79`).

**Single source of truth (E):** derive the allowed programs from Perun's
`allowed-tools` frontmatter by parsing the `Bash(<prog>:*)` patterns, so prose and
enforcement cannot drift. Caveats from review: this is **net-new** parsing (the
existing `perun-tools-sync.test.ts` only substring-checks tool *names*); the parser
must handle the **path-form** program `./scripts/qa-preflight.sh` (not a bare token),
and must define handling of **compound commands** (`a && b`, `;`, `bash -c "…"`) — at
minimum reject compounds for the coordinator.

*(Why not `tools: { bash: false }`? The `tools` dict is per-named-tool boolean — it
cannot express "allow `mkdir`, deny `git`". The sub-command allowlist needs
command-string inspection, hence the hook.)*

**Known bypasses (intentional — same class as `bash-policy.ts`):** this rail is
defense-in-depth, not a sandbox. It does **not** cover: MCP tools (the handler scopes
to `tool === "bash"` only — `serena_*`/`playwright_*` are separate tool names); a
specialist running a script that the coordinator `Write`s; or network access via the
allowed `./scripts/qa-preflight.sh` (it `curl`s the service descriptors fed to it).
**Follow-up:** `src/agents/perun.md:32` claims an MCP runtime gate that does **not**
exist — correct that prose (or bring MCP tool names under this handler) as part of the
work.

### 4. C — skill exposure (coordinator)

Two complementary levers:

1. **Gate the skill-loading tools** via a per-agent `tools` dict on Perun's config.
   The `tools` dict is a **partial override** (confirmed: Zmora/Veles list only a few
   keys and keep the rest), so `tools: { skill: false, load_appverk_skill: false }`
   disables **only** those — no enumeration of Perun's full set.
   - `load_appverk_skill` (the repo loader, `packages/skill-registry/src/index.ts:36`)
     is **reliably gateable**.
   - **B2 — `skill` (the native tool, which superpowers also rides) gating is
     UNVERIFIED on the installed runtime.** The v1 `PermissionConfig` (installed:
     `@opencode-ai/*` 1.15.x) has **no** `skill` key; v2 does. **Plan step 1 must
     empirically confirm** `tools: { skill: false }` actually prevents a `skill(...)`
     call on the pinned runtime. If it does not, C-lever-1 is **not** the hard
     backstop for the native tool — fall back to C-lever-2 + accept that the native
     `skill` tool stays callable until the runtime is upgraded.
2. **Suppress the global skill-activation injection** for the coordinator session: in
   `experimental.chat.system.transform`, skip pushing `activationRules` when the
   resolver (§1, via `sessionID`) identifies the coordinator — and, per §1, **fail
   closed** (suppress) when `sessionID` is absent.

**D2 — confirmed safe (review finding in our favour):** Perun's prompt and both
workflows contain **zero** skill references; the injected `activationRules` are a
coding-standards table irrelevant to orchestration. Hard-disabling skill loading for
the coordinator therefore breaks nothing.

### 5. F — violation telemetry that the eval can actually read (revised)

> **Revision:** a bare `console.log` is invisible to the eval — the playbook captures
> signals via the SDK (incl. `last.info.error`), not app/server logs.

On a coordinator rail rejection (bash or skill):

1. **Carry the structured payload in the thrown `Error` message**
   (`{ agent, tool, command|skill, reason }`) so it surfaces in `last.info.error`,
   which the playbook **does** capture — and to the model (G).
2. **Add a landing zone:** create `docs/eval/scenarios/perun/` (none exists today —
   only `triglav/` and `veles/`) with a scenario whose `## Quality signals` count
   coordinator rail-rejections. This is the measurable "how often does model X on the
   coordinator role try to escape its role" signal that would have auto-flagged Kimi.

Scope (F-lite): the Error-borne payload + the scenario now; no metrics pipeline.

### 6. G — instructive rejections

Rejection text redirects to the correct action, e.g.: *"The coordinator may not run
`git`. Dispatch **Veles** (planning) or **Triglav** (exploration) to inspect the
repository instead."* **Honest scope:** this is a *nudge* — it reliably helps capable
models re-plan; a weak model may still loop or stall (which is exactly what F records).
G is not a behaviour guarantee.

---

## Open questions (sharpened — all resolved in plan step 1)

1. **Resolver:** is a session's **agent identity** reachable from `client.session.get`
   (enabling positive `agent === Perun`), or do we fall back to parentless +
   register-children-before-prompt (and document Veles-as-primary)? (§1)
2. **B2:** does `tools: { skill: false }` actually block the **native** `skill` tool on
   the installed opencode 1.15.x runtime? (§4)
3. **Placement:** exact shared-package home for the stateless resolver. (§2)

---

## Testing approach

- **Resolver:** child session (`parentID` set) → not coordinator; parentless Perun →
  coordinator; parentless non-Perun (Veles-as-primary) → not coordinator; `sessionID`
  absent → coordinator-for-suppression only.
- **A:** coordinator `mkdir`/`ls`/`qa-preflight.sh` pass; coordinator `git …`, `curl`,
  `cat .env`, and compound `mkdir x && git log` rejected; specialist `git` passes
  through; allowlist read from frontmatter (editing the frontmatter changes
  enforcement — the drift test); path-form program parsed correctly.
- **C-lever-1:** coordinator cannot invoke `load_appverk_skill`; **and** the runtime
  check for the native `skill` tool (B2) — gated test, marked pending if the runtime
  does not honour it.
- **C-lever-2:** `activationRules` not injected for the coordinator session, still
  injected for specialists, suppressed when `sessionID` is absent. (Depends on §2.)
- **E:** the layer keys on agent identity — a second (mock) agent gets its own policy,
  proving it is not a Perun-only hack.
- **F:** a rejection produces exactly one structured payload in the Error/`info.error`;
  the `perun` eval scenario can read it.
- **G:** the rejection message names the redirect (Veles/Triglav).

---

## Out of scope / non-goals

- **Delegation behaviour** for free-form requests — deferred intent gate + model
  selection (the latter explicitly an operator choice, not this spec).
- **Path-scoping** `Read`/`Grep`/`Glob` for the coordinator (possible future
  tightening; brittle, conflicts with plan-reading).
- No change to specialist tool policies beyond what already exists.
- No new dispatch/routing logic (that is the deferred intent gate).
