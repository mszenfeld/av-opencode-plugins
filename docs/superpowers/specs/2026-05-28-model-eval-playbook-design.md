# Model Evaluation Playbook — Design

**Date:** 2026-05-28
**Status:** Approved — ready for implementation planning
**Author:** Marian Szenfeld (+ Claude)

## Context

Pantheon agents (`triglav`, `zmora`, `perun`) are model-configurable via
`pantheon.json`. Choosing the right model per agent is a real, recurring decision:

- New model releases land (haiku/sonnet/opus refreshes, opencode-zen catalog
  changes) and we want to re-check which is best for a given agent.
- The agents differ structurally in what they need from a model: Triglav is a
  high-fan-out read-only scout where latency/cost dominate; Zmora executes
  scenarios where tool use and instruction-following matter; Perun orchestrates
  where reasoning depth matters. There is no one-size-fits-all "best model."
- Token-match accuracy alone does not discriminate well — in our session four
  models scored 9–10/10 on the same trace query while qualitatively producing
  very different outputs (one degenerated to 791 chars without exploring; one
  produced 16k chars with line-precise citations; one ignored serena entirely).

### What we learned while picking a model for Triglav

Over a long session we ran ad-hoc benchmark scripts (`opencode serve` + the
`@opencode-ai/sdk` client driving `session.promptAsync` with a per-message
`model` override against the `triglav` agent). The pattern was sound but
disposable — each script lived in `/tmp/` and was deleted after use. We want
to preserve the *procedure* and the *lessons learned*, not the scripts.

Key empirical lessons that belong in any future evaluation:

1. **`promptAsync` is the right primitive** — `session.prompt` blocks for the
   full LLM turn; `session.promptAsync` returns ~immediately and the child
   session progresses autonomously.
2. **Completion signal is `info.time.completed`**, not `finish_reason`.
   Intermediate `tool-calls` pauses set a truthy `finish_reason` mid-turn.
3. **Check auth before testing a provider** — `openai/*` models complete in
   ~4.5 s with 0 chars when the `openai` provider is unauthed; the failure is
   silent (no `info.error`). Treat empty turn + unauthed provider as
   "skip with a note."
4. **Anchor with a known-good model** — when introducing new candidates, also
   run one trusted model (e.g. `opencode/claude-haiku-4-5`) as an environment
   sanity check. A degenerate anchor signals a cold serena cache or other
   environmental issue, not a model defect.
5. **"Stuck" often means "slow"** — qwen3.5-plus appeared to hang at our
   initial 150 s timeout; at 240 s it completed in ~145 s. Raise the cap
   before declaring a model broken.
6. **Token matching is too generous on its own.** Pair it with structural
   checks (output skeleton present? answer length above a degeneration floor?
   any tool calls at all?) or you will rate degenerate answers the same as
   thorough ones.
7. **Read the full answers.** Quality often hides in length, citations, and
   subtle architectural caveats that token-match cannot see.
8. **Private-repo isolation** — reports often contain absolute paths and
   excerpts of the target codebase. Never commit reports that reference
   anything outside this public repo.

### What we are NOT building

The brainstorm explicitly rejected a TypeScript framework with a scenario
parser, scoring engine, and CLI runner. The reasoning:

- Claude Code already runs evaluations interactively. A framework would just
  be infrastructure Claude has to ignore in order to make the same contextual
  decisions (which models to test, what query to ask, how to interpret
  ambiguous results).
- Any framework drifts against the SDK and against the agent prompts; the
  procedure does not.
- The procedure is the artifact worth preserving, not the code.

## Goals and non-goals

### Goals

- Capture the **procedure** for evaluating which model best fits a given
  Pantheon agent, as a doc Claude (or a human) can follow.
- Ship at least one **public-safe scenario** for Triglav so the procedure can
  be exercised from a fresh `git clone` without external resources.
- Establish a **scenario file convention** that extends naturally to other
  agents (Zmora, Perun) and to user-local private codebases.
- Preserve the **empirical lessons** from the session that produced the
  decision to ship Triglav model-configurability.

### Non-goals

- **No CI/regression mode.** This is a manual tool. There are no threshold
  assertions, no `npm run` integration into the check suite, no failing
  builds. (A future spec may add this; out of scope here.)
- **No framework / parser / CLI tool.** No TypeScript module, no executable,
  no JSON schema enforced at parse time.
- **No automated model discovery.** The user supplies the candidate model
  list explicitly (no defaults; no scraping of `opencode models`).
- **No shipped reports.** Reports live outside this repo's history.
- **No coverage of agents other than Triglav at ship time.** The convention
  must accommodate Zmora/Perun, but the only concrete scenario shipped on
  day one targets Triglav.

## Architecture

Three artifacts, all markdown, all human-readable:

```
docs/eval/
├── playbook.md                          # the procedure (generic; any codebase)
└── scenarios/
    └── triglav/
        ├── README.md                    # how to use these + write your own
        └── prompt-pipeline-render.md    # public-safe scenario (this repo)
```

Reports are **not** part of the repo layout. They are generated to a
user-specified path (default `/tmp/eval-YYYY-MM-DD-<agent>.md`) and never
committed to this repository.

Other agent directories (`scenarios/zmora/`, `scenarios/perun/`) are not
created on day one — they appear when a public-safe scenario for that agent
is contributed. Empty placeholder directories add noise; the absence is the
signal.

## The playbook (`docs/eval/playbook.md`)

### Top-of-file framing

- **When to use this playbook** — picking a model for an agent; re-checking
  after a model release; sanity-checking that a recently-changed agent prompt
  still works on its configured model.
- **Requirements** — local `opencode` CLI in PATH (`opencode serve` for the
  headless server, `opencode models` for the catalog), `@opencode-ai/sdk` in
  `node_modules/` of the repo Claude writes the ad-hoc script from (typically
  this repo), and authed providers in `~/.local/share/opencode/auth.json`
  for every candidate model. No other dependencies — no framework, no CI, no
  external services.
- **Inputs** — five named inputs the user provides per run:
  1. Agent under test (e.g. `triglav`).
  2. Scenario file path (absolute) — either a shipped one or a user-local one.
  3. Candidate models — **user-supplied list** of `<providerID>/<modelID>`
     strings (e.g. `opencode/claude-haiku-4-5`, `opencode-go/deepseek-v4-flash`).
     No defaults; no auto-discovery.
  4. Iterations per model (default 2 — catches variance like the haiku
     degeneration observed in session).
  5. Report destination — absolute path; default `/tmp/eval-YYYY-MM-DD-<agent>.md`.

### Procedure (seven steps)

1. **Pre-flight.** Read the scenario `.md`. Extract: Query, Expected coverage,
   Quality signals, Target codebase. Verify the target path exists. Verify each
   candidate model is authed (`jq -r 'keys[]' ~/.local/share/opencode/auth.json`
   for providers, `opencode models | grep <modelID>` for the model itself).
   Drop unauthed candidates with an explicit note in the report. Verify the
   agent under test is registered once the server is up.

2. **Spin up isolated server.** Start a dedicated headless OpenCode server in
   the target directory: `sh -c 'cd <target> && opencode serve --port <free>
   --hostname 127.0.0.1' > /tmp/oc_eval_server.log 2>&1 &`. Wait until
   listening. Capture the PID for cleanup. **Never** point the SDK at the
   user's active TUI server — use a freshly-spawned server on its own port
   so the user's session is untouched.

3. **Run the benchmark.** From within this repo (so `@opencode-ai/sdk`
   resolves), write an ad-hoc Node script in `/tmp/`. For each candidate
   model × N iterations:
   - `session.create({ body: { title: 'eval' } })` — fresh session per run.
   - `session.promptAsync({ path: { id }, body: { agent, model: { providerID,
     modelID }, parts: [{ type: 'text', text: QUERY }] } })`.
   - Poll `session.messages({ path: { id } })` every ~1.5 s. Treat the run as
     complete when the last assistant message's `info.time.completed` is
     truthy. Cap timeout at 240 s by default; raise for very large codebases.
   - Capture: full final assistant text, the list of tool call names, the
     end-by reason (done / timeout / error), latency.
   - `session.delete({ path: { id } })`.

4. **Score per model.** For each completed run, assess against the scenario's
   sections:
   - **Coverage** — how many `## Expected coverage` items are present (case-
     insensitive substring match against the final text).
   - **Structural compliance** — the agent's required output skeleton (e.g.
     a closing `<results>` block for Triglav).
   - **Depth signal** — answer length in chars; flag values below the
     scenario's degeneration floor (Triglav: ~2000 chars).
   - **Citations** — count of cited file paths; `file:line` pairs are a
     quality bonus. Spot-check that cited paths actually exist.
   - **Tool profile** — total tool calls; serena vs grep/glob/read split.
     Flag a correct answer that used ~0 exploration tools (Delegation Trust
     Rule risk).
   - **Variance** — if N > 1, compare runs of the same model; flag
     instability.

5. **Anchor run (recommended).** When introducing a new candidate, also run
   one trusted model (e.g. `opencode/claude-haiku-4-5`) once as a baseline.
   If the anchor degenerates, annotate the report — the environment is
   suspect, not the new candidates. Skip the anchor when comparing only
   well-characterised models.

6. **Write the report.** Generate markdown at the user-specified destination.
   Structure:
   - **Header** — scenario file, target codebase (path + git SHA if a git
     repo), iterations per model, environment notes.
   - **Summary table** — one row per model: Completed, Avg latency, Coverage,
     Structural OK, Depth, Tool profile, Verdict.
   - **Per-model details** — coverage hits/misses, citations, an excerpt
     (~200 chars) of the answer, observed variance across iterations,
     individual verdict.
   - **Caveats** — single-run nondeterminism, token-match generosity,
     dropped models (with reason), any observed instability, environment
     anomalies (anchor degeneration, etc.).
   - **Recommendation** — concrete pick with reasoning, ranked alternatives.

7. **Cleanup.** Kill the server (`kill <pid>`). Remove any temp scripts. If
   the target codebase is **not** this repo, run `git status --short` in the
   target — Triglav is read-only and any change is unexpected; surface it in
   the report. **Never commit a report that references a private codebase.**
   Default the report path to `/tmp/` so this is the obvious default.

### Lessons learned (embedded in the playbook)

The eight lessons enumerated in [Context](#context) are written verbatim into
the playbook so future sessions can read them as a foreword to the procedure.
Each lesson cites the empirical observation that justified it.

### Adapting a scenario for your own codebase

The playbook closes with a short guide for the common case of evaluating
against a private codebase outside this repo:

1. Copy a shipped scenario as a template into a directory outside this repo
   (e.g. `~/.config/pantheon/eval/my-scenario.md`).
2. Edit `**Target codebase:**`, `## Query`, `## Expected coverage` (inspect
   your codebase to verify; have Claude help build the list), `## Quality
   signals`, and `## What this discriminates`.
3. Run the playbook with the local path. The report goes to `/tmp/` by
   default. Do not commit either the scenario or the report to a public
   repository.

## Scenario file convention

A scenario is a single markdown file with the following section convention
(soft schema — Claude reads it, no parser involved):

```markdown
# <Agent>: <short title>

**Agent:** <agent name>
**Target codebase:** <description; e.g. "this repo (av-opencode-plugins)" or absolute path>

## Query
(verbatim text the agent receives)

## Expected coverage
- bullet 1 (symbol / file / phrase with brief context)
- bullet 2
- ...

## Quality signals
- format compliance: ...
- min depth: ...
- citations: ...
- tool usage: ...
- hallucination check: ...

## What this discriminates
Prose. Spell out the failure modes this scenario detects so future authors
understand whether to extend, replace, or add a sibling scenario.
```

Notes on the convention:

- `## Expected coverage` is a bullet list, not a literal `expected_tokens:
  [...]` array. The free-form bullets let authors add inline context ("or
  equivalent term", "the cached entry point", etc.) and let Claude handle
  paraphrases naturally during scoring.
- `## Quality signals` is prose, not numeric thresholds. Claude computes the
  underlying numbers (length, citation count, tool counts) and applies
  judgement; sharp thresholds would create false positives on borderline
  answers.
- `## What this discriminates` is mandatory for a good scenario. Forcing the
  author to name the failure modes the scenario detects prevents
  low-information "everyone passes" tests.

## Shipped scenario (day one)

A single file: `docs/eval/scenarios/triglav/prompt-pipeline-render.md`.

It asks Triglav to trace how Perun's system prompt is assembled from agent
metadata in this repo. The expected coverage references the agent-registry
renderer (`getPerunPrompt`, `buildPerunPrompt`, `getAgentMetadataRegistry`,
`registerAgentMetadata`), the four placeholders (`{SPECIALISTS_TABLE}`,
`{KEY_TRIGGERS}`, `{DELEGATION_TABLE}`, `{USE_AVOID:<agent>}`), and the
three metadata-contributing files (`triglav.metadata.ts`,
`zmora.metadata.ts`, `fix-auto.metadata.ts`).

This scenario was used throughout the session to compare Triglav model
candidates. It empirically discriminated:

- `github-copilot/gpt-5.4-mini` — used 0–1 tool calls and produced thin
  (~2.6 k char) skeletal answers; flagged by the tool-usage signal.
- `opencode/claude-haiku-4-5` — produced thorough answers most of the time
  (15 k chars, heavy serena use) but occasionally degenerated to ~800 chars
  without exploring; flagged by the depth signal.
- `opencode-go/qwen3.5-plus` — completed correctly but at ~3× the latency
  of the other contenders.
- `opencode/deepseek-v4-flash-free`, `opencode-go/deepseek-v4-flash` —
  consistently strong; serena vs Grep/Glob split varied.

A companion `docs/eval/scenarios/triglav/README.md` explains what is in
the directory and how to author local scenarios for private codebases.

Additional scenarios (other angles for Triglav, or first scenarios for
Zmora/Perun) are deferred. They are added when a real failure mode justifies
a dedicated test.

## Reports

Reports are markdown, written to the path the user specifies (default
`/tmp/eval-YYYY-MM-DD-<agent>.md`). Their structure follows the bullets in
playbook step 6: header → summary table → per-model details → caveats →
recommendation.

The repo does not ship example reports. Examples for private codebases would
leak; an example for this public repo would shortly go stale against
benchmark variance. The playbook's per-step description is the spec for what
a report should contain; Claude generates the actual content per run.

## Privacy and safety constraints

The repo is public. The design enforces three rules:

1. **Shipped scenarios target only this repo** (`av-opencode-plugins`).
   No path references, no symbol references, no excerpts from any other
   codebase appear in scenarios committed here.
2. **Reports are never committed to this repo.** The default destination is
   `/tmp/`. Even when the report is about this repo, the user must opt in
   explicitly to commit it — and only if it contains no excerpts from
   anything else.
3. **The playbook actively reminds Claude** of these rules at step 7
   (Cleanup). Future sessions reading the playbook will see the constraint
   even if they have no other context.

## Implementation checklist (for writing-plans)

1. Create `docs/eval/` directory.
2. Write `docs/eval/playbook.md` — Requirements, When to use, Inputs,
   the seven-step procedure, embedded Lessons learned, Adapting guide.
3. Write `docs/eval/scenarios/triglav/prompt-pipeline-render.md` per the
   section structure agreed in this design.
4. Write `docs/eval/scenarios/triglav/README.md` — what's here + how to
   author local scenarios for private codebases.
5. No code changes. No `npm run` script. No build artefacts. Verify
   `npm run verify-dist` still passes (markdown-only changes — should not
   touch `dist/`).
6. Cross-link from `docs/exploration.md` ("Model selection" section) to the
   playbook, so the model-config doc and the eval doc reference each other.
7. Update memory: add a pointer entry that the playbook + scenarios convention
   exists, so future sessions discover them.

## Self-review notes

- Scope is single-spec-sized: ~3 small docs to author, no code.
- Internal consistency: layout (Architecture section) matches the
  Implementation checklist; the scenario convention (Scenario file
  convention section) matches the shipped scenario content (Shipped scenario
  section).
- No "TBD" or vague requirements. Every step has a concrete output.
- Ambiguity guard: the user-supplied model list is named explicitly twice
  (Inputs and Non-goals → "No automated model discovery") so it does not get
  reinvented as "auto-discover from `opencode models`" during implementation.
