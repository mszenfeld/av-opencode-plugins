# Model Evaluation Playbook — Design

**Date:** 2026-05-28
**Status:** Approved (rev 2 after MoA review)
**Author:** Marian Szenfeld (+ Claude)

> **Revision history:** rev 1 (`5cadb76`) → rev 2 incorporates 18 findings from a
> mixture-of-agents review covering executability gaps (free-port picking,
> server readiness probe, ad-hoc script skeleton), hidden risks (cost,
> orphaned servers, report path collisions), missing handling (`info.error`,
> determinism notes, model-ID drift), and several MINOR/NIT polishes.

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
   silent (no `info.error`). Empty turn + 0 chars from a fresh model on the
   first call is the silent-unauth signal. Treat as "skip with a note." Note
   that key *presence* in `auth.json` is not the same as a *valid* token; the
   only definitive check is a probe call.
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
9. **Every candidate × iteration is a real billable LLM turn.** Three models
   × two iterations against opus-class candidates on a large codebase can
   silently burn double-digit dollars and risk rate-limit hits. Keep
   candidate lists short (≤ 4) and iterations low (default 2); warn before
   running on paid providers.
10. **Match scenario difficulty to the model gap.** If every candidate scores
    100 % the scenario does not help — it does not discriminate. Deliberately
    include queries that stress a weakness (find-references on poorly-named
    code, multi-file synthesis, output-format compliance), and keep at least
    one "easy" baseline to detect environmental issues.

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
- **Cross-link** `docs/exploration.md` and the playbook so users discover
  one from the other.
- **Pointer in agent memory** that the playbook exists (so future Claude
  sessions discover it). The memory entry contains only doc paths — never
  per-run details, never private codebase paths.

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
user-specified path (default `/tmp/eval-YYYY-MM-DD-HHMMSS-<agent>.md` — the
HHMMSS suffix prevents collisions on same-day re-runs) and never committed to
this repository.

A `.gitignore` rule covers user-local scenario files inadvertently dropped
under `docs/eval/scenarios/`:

```
# Local (private) evaluation scenarios — never commit
docs/eval/scenarios/**/local-*.md
docs/eval/scenarios/**/private/
```

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
  this repo — the script must be run from a directory where the SDK
  resolves), and authed providers in `~/.local/share/opencode/auth.json` for
  every candidate model. No other dependencies — no framework, no CI, no
  external services.
- **Cost and quota** — each candidate × iteration is a real billable LLM
  turn. A typical run (3–4 models × 2 iterations × 60–150 s) can cost
  meaningful money on opus-class candidates and hit rate limits on
  subscriptions. Before running with paid providers, surface an estimate to
  the user and ask for confirmation. Keep candidate lists short (≤ 4) and
  default iterations low (2). Free/subscription-included models (e.g.
  `opencode/deepseek-v4-flash-free`) are unconstrained but may still hit
  per-minute throttles.
- **Inputs** — five named inputs the user provides per run:
  1. Agent under test (e.g. `triglav`).
  2. Scenario file path (absolute) — either a shipped one or a user-local one.
  3. Candidate models — **user-supplied list** of `<providerID>/<modelID>`
     strings (e.g. `opencode/claude-haiku-4-5`, `opencode-go/deepseek-v4-flash`).
     No defaults; no auto-discovery. Re-check the catalog with `opencode
     models` first — IDs drift between releases.
  4. Iterations per model (default 2 — catches variance like the haiku
     degeneration observed in session).
  5. Report destination — absolute path; default
     `/tmp/eval-YYYY-MM-DD-HHMMSS-<agent>.md`. The HHMMSS suffix prevents
     overwrites on same-day re-runs; refuse to overwrite an existing path
     without explicit confirmation.

### Procedure (seven steps)

1. **Pre-flight.** Read the scenario `.md`. Extract: Query, Expected coverage,
   Quality signals, Target codebase. Verify the target path exists.
   For each candidate model:
   - **Static check** — `jq -r 'keys[]' ~/.local/share/opencode/auth.json`
     should list the provider; `opencode models | grep <modelID>` should
     show the model. If either is missing, drop the candidate with an
     explicit note in the report ("provider not authed", "model not in
     catalog").
   - **Dynamic check (recommended)** — provider key presence in `auth.json`
     is *not* the same as a valid token. Either do a single 1-token probe
     call up-front, or treat the first benchmark turn that returns in < 5 s
     with 0 characters and 0 tool calls as the **silent-unauth signature**
     (per lesson 3) and skip the model.
   - Record `opencode models` and `opencode --version` (and the
     `@opencode-ai/sdk` package version) into the report header so a
     future re-run can verify ID-drift.
   Once the server is up (step 2), confirm the agent under test is registered
   via `client.app.agents()` and the returned list contains the agent name.

2. **Spin up isolated server.** Start a dedicated headless OpenCode server
   in the target directory:

   ```bash
   PORT=$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});')
   sh -c "cd <target> && opencode serve --port $PORT --hostname 127.0.0.1" \
     > /tmp/oc_eval_server_$PORT.log 2>&1 &
   SERVER_PID=$!
   ```

   Then poll for readiness (cap at ~10 s):

   ```bash
   for i in $(seq 1 50); do
     curl -sf "http://127.0.0.1:$PORT/app" >/dev/null && break
     sleep 0.2
   done
   ```

   The port-selection helper picks an ephemeral free port (avoids collision
   with the user's active TUI on 22227/37373 etc.); the log filename is
   port-suffixed so parallel runs do not clobber. **Never** point the SDK at
   the user's active TUI server — always spawn a dedicated one.

3. **Run the benchmark.** From within this repo (so `@opencode-ai/sdk`
   resolves), write an ad-hoc Node script to `/tmp/oc_eval_$PORT.mjs`. The
   script registers a `SIGINT`/`SIGTERM` trap that kills `SERVER_PID` and
   deletes any sessions it created, so a crash or `Ctrl-C` does not leak the
   server. Minimal reference skeleton (extend with candidate loop, iteration
   loop, JSON output to the report path):

   ```javascript
   import { createOpencodeClient } from "@opencode-ai/sdk"
   const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${PORT}` })
   const created = await client.session.create({ body: { title: "eval" } })
   const id = created.data?.id
   await client.session.promptAsync({
     path: { id },
     body: {
       agent: AGENT,
       model: { providerID, modelID },
       parts: [{ type: "text", text: QUERY }],
     },
   })
   const t0 = Date.now()
   let outcome = "timeout"
   while (Date.now() - t0 < TIMEOUT_MS) {
     await new Promise((r) => setTimeout(r, 1500))
     const msgs = (await client.session.messages({ path: { id } })).data ?? []
     const last = msgs.at(-1)
     if (last?.info?.error) { outcome = "error"; break }
     if (last?.info?.role === "assistant" && last.info?.time?.completed) {
       outcome = "done"
       break
     }
   }
   // ... capture full text, tool calls, errors, latency, then session.delete
   ```

   Outcome decision tree (per iteration):
   - `last.info.time.completed` truthy → **done**.
   - `last.info.error` populated → **error** (record the error string).
   - No assistant message after `TIMEOUT_MS` (default 240 s; raise to 600 s
     for very large codebases) → **timeout**.
   - Last message is non-assistant after the wait → **missing-assistant**
     (treat as error; provider rejected the prompt).
   - Empty assistant turn (< 5 s, 0 chars, 0 tool calls) → **silent-unauth**
     (per lesson 3) — skip remaining iterations for this candidate and
     record in the report.

   **Determinism note.** Temperature is provider-default (Pantheon does not
   pin it for these agents). Iteration-to-iteration variance reflects
   sampling, not just model capability — name this in the report's Caveats.
   Capture `sessionID`, the final `messageID`, and per-iteration timestamps
   so a future investigator can locate the exact turn in OpenCode state.

4. **Score per model.** For each completed iteration, assess against the
   scenario's sections:
   - **Coverage** — how many `## Expected coverage` items are present
     (case-insensitive substring match against the final text).
   - **Structural compliance** — the agent's required output skeleton (e.g.
     a closing `<results>` block for Triglav).
   - **Depth signal** — answer length in chars; flag values below the
     scenario's degeneration floor. Floors are author judgement against
     observed degenerate runs (Triglav: ~2000 chars; not a formula).
   - **Citations** — count of cited file paths; `file:line` pairs are a
     quality bonus. Spot-check that cited paths actually exist (`ls`).
   - **Tool profile** — total tool calls; serena vs grep/glob/read split.
     Flag a correct answer that used ~0 exploration tools (Delegation Trust
     Rule risk).
   - **Variance (if N > 1)** — compare iterations of the same model.
     "Unstable" means any of: differing coverage hit sets, answer-length
     delta > 2×, conflicting outcome (done in run 1, degeneration in
     run 2). Flag explicitly in per-model details.

   Each model receives a **Verdict** drawn from a fixed vocabulary so reports
   stay searchable:
   - `recommend` — high coverage, format-compliant, no degeneration; the
     preferred pick.
   - `acceptable` — meets the bar but with caveats (slower, less thorough);
     reasonable fallback.
   - `degenerate` — degenerated on ≥ 1 iteration (early stop, missing
     `<results>`, sub-floor depth) even if other iterations were fine.
   - `unreliable` — high variance, conflicting outcomes across iterations.
   - `not-tested` — dropped during pre-flight (unauthed provider, missing
     model ID, silent-unauth signature).

5. **Anchor run (recommended).** When introducing a new candidate, also run
   one trusted model (e.g. `opencode/claude-haiku-4-5`) once as a baseline.
   If the anchor degenerates, annotate the report — the environment is
   suspect, not the new candidates. Skip the anchor when comparing only
   well-characterised models.

6. **Write the report.** Generate markdown at the user-specified destination
   (default `/tmp/eval-YYYY-MM-DD-HHMMSS-<agent>.md`; refuse to overwrite an
   existing file without explicit user confirmation). Structure:

   - **Header** — scenario file, target codebase (path + git SHA if a git
     repo), iterations per model, `opencode --version`, `@opencode-ai/sdk`
     version, `opencode models` snapshot date, environment notes (anchor
     model used if any), timestamp of the run.
   - **Summary table** — one row per model: Verdict (vocabulary above),
     Outcome (done / timeout / error / silent-unauth), Avg latency,
     Coverage (e.g. 8/10), Structural OK (✓/✗), Depth (avg chars or
     min/max), Tool profile (serena/grep/read counts).
   - **Per-model details** — coverage hits/misses, citations count, the
     `sessionID` and final `messageID` per iteration, an excerpt (~200
     chars; truncate at whitespace and append `…`) of the best run's
     answer, observed variance across iterations, individual Verdict line
     with reasoning.
   - **Caveats** — single-run nondeterminism (variance attributed to
     sampling at provider-default temperature), token-match generosity,
     dropped models (with reason), any observed instability, environment
     anomalies (anchor degeneration etc.), model-ID drift hits.
   - **Recommendation** — 2–4 sentences of reasoning. End with a single
     `PICK:` line naming the chosen `<providerID>/<modelID>`, or
     `PICK: none — see Caveats` if no clear winner emerged. Include a
     ranked alternates list (top 3) when several models are close.
   - **Applying the recommendation** — short subsection reminding the
     reader that the pick is applied by editing `pantheon.json`:

     ```jsonc
     { "agents": { "<agent>": { "model": "<providerID>/<modelID>" } } }
     ```

     Reference `docs/configuring-agents.md` for file location and
     precedence rules.

7. **Cleanup.**
   - Kill the server: `kill $SERVER_PID 2>/dev/null; sleep 0.5; kill -9
     $SERVER_PID 2>/dev/null || true`. As a recovery fallback for crashed
     runs, `pgrep -f "opencode serve --port"` lists any orphaned servers.
   - Sweep any sessions the script created (`session.list` → `session.delete`
     for sessions matching the eval-run title prefix), so subsequent evals
     do not see stale sessions.
   - Remove the temp script (`/tmp/oc_eval_$PORT.mjs`) and the server log
     (`/tmp/oc_eval_server_$PORT.log`). Both are private content because
     they reference the target codebase path; treat them like reports —
     never commit, never reference outside the local filesystem.
   - Run `git status --short` **in the target directory regardless of
     whether it is this repo or another** — Triglav is read-only and any
     change is unexpected; surface a non-empty status in the report's
     Caveats. The serena LSP server writes to `.serena/cache/` during
     indexing; that path is expected and gitignored — treat it as
     whitelisted noise rather than a finding.
   - **Never commit a report that references a private codebase.** The
     default report path is `/tmp/`, so this is the obvious default.

### Lessons learned (embedded in the playbook)

The ten lessons enumerated in [Context](#context) are written verbatim into
the playbook so future sessions can read them as a foreword to the procedure.
The spec is the source of truth — the playbook is a copy; on revision, keep
them in sync (or generate one from the other). Each lesson cites the
empirical observation that justified it.

### Adapting a scenario for your own codebase

The playbook links to a dedicated **README** at
`docs/eval/scenarios/triglav/README.md` for this guidance (canonical
location), then summarises:

1. Copy a shipped scenario as a template into a directory outside this repo
   (e.g. `~/.config/pantheon/eval/my-scenario.md`) or under a gitignored
   path (`docs/eval/scenarios/<agent>/local-<name>.md`).
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
  low-information "everyone passes" tests (see lesson 10).
- **Cross-agent shape note.** Triglav is a Q&A agent — Query in, synthesis
  out — so `## Quality signals` evaluates the answer text. Zmora *executes*
  scenarios — Query becomes the verbatim QA-scenario block, `## Expected
  coverage` lists the expected pass/fail verdict and critical assertions,
  and `## Quality signals` focuses on tool calls (did it actually drive the
  browser / hit the API?). Perun *orchestrates* — Query is a multi-step
  request, coverage names the expected dispatch waves and synthesis points.
  The section shape is stable; the semantics differ per agent.

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

A companion `docs/eval/scenarios/triglav/README.md` is the **canonical**
location for the "Adapting a scenario for your own codebase" guidance; the
playbook links to it rather than restating, so the two documents do not
drift.

Additional scenarios (other angles for Triglav, or first scenarios for
Zmora/Perun) are deferred. They are added when a real failure mode justifies
a dedicated test.

## Reports

Reports are markdown, written to the path the user specifies (default
`/tmp/eval-YYYY-MM-DD-HHMMSS-<agent>.md`). Their structure follows the
bullets in playbook step 6: header → summary table → per-model details →
caveats → recommendation → applying the recommendation.

Reports include forensic identifiers (`sessionID`, final `messageID`,
timestamps per iteration) so a future investigator can locate the exact
turn in OpenCode state. They also include the SDK + CLI versions and the
date of the `opencode models` snapshot so re-runs can detect catalog drift.

The repo does not ship example reports. Examples for private codebases would
leak; an example for this public repo would shortly go stale against
benchmark variance. The playbook's per-step description is the spec for what
a report should contain; Claude generates the actual content per run.

## Privacy and safety constraints

The repo is public. The design enforces four rules:

1. **Shipped scenarios target only this repo** (`av-opencode-plugins`).
   No path references, no symbol references, no excerpts from any other
   codebase appear in scenarios committed here.
2. **Reports are never committed to this repo.** The default destination is
   `/tmp/`. Even when the report is about this repo, the user must opt in
   explicitly to commit it — and only if it contains no excerpts from
   anything else.
3. **Local scenarios are gitignored.** A `.gitignore` rule covers
   `docs/eval/scenarios/**/local-*.md` and `docs/eval/scenarios/**/private/`
   so a user who copies a shipped scenario for their own codebase cannot
   accidentally `git add` it back. Scenarios authored outside the repo
   tree (e.g. under `~/.config/pantheon/eval/`) are recommended for full
   isolation.
4. **The playbook actively reminds Claude** of these rules at step 7
   (Cleanup) and at the report-destination default. Future sessions reading
   the playbook will see the constraint even if they have no other context.

Server logs (`/tmp/oc_eval_server_$PORT.log`) and the ad-hoc script
(`/tmp/oc_eval_$PORT.mjs`) also embed the target codebase path; treat them
as private content (Cleanup step 7 deletes them).

## Implementation checklist (for writing-plans)

1. Create `docs/eval/` directory.
2. Write `docs/eval/playbook.md` — Requirements, Cost-and-quota note, When to
   use, Inputs, the seven-step procedure with concrete commands (port pick,
   readiness probe, script skeleton, outcome decision tree, verdict
   vocabulary), embedded ten Lessons learned, Adapting guide that links to
   the scenario README.
3. Write `docs/eval/scenarios/triglav/prompt-pipeline-render.md` per the
   section structure agreed in this design.
4. Write `docs/eval/scenarios/triglav/README.md` — what's here + the
   canonical "Adapting" guide (the playbook links here rather than
   duplicating it).
5. Add `.gitignore` rules for local scenarios:
   `docs/eval/scenarios/**/local-*.md` and `docs/eval/scenarios/**/private/`.
6. Cross-link from `docs/exploration.md` ("Model selection" section) to the
   playbook, so the model-config doc and the eval doc reference each other.
7. Update memory: add a pointer entry that the playbook + scenarios
   convention exists, **referencing only doc paths** (`docs/eval/playbook.md`,
   `docs/eval/scenarios/triglav/`) — never per-run details, never private
   codebase paths.
8. No code changes. No `npm run` script. No build artefacts. Verify
   `npm run verify-dist` still passes (markdown-only changes — should not
   touch `dist/`).

## Self-review notes (rev 2)

- Scope is single-spec-sized: 4 small docs to author + a `.gitignore` rule +
  a cross-link + a memory entry; no code.
- Internal consistency: layout (Architecture) matches Implementation
  checklist; scenario convention matches the shipped scenario content;
  verdict vocabulary in Step 4 matches the summary-table column referenced
  in Step 6; the seven-step procedure's outcome decision tree is consistent
  with the verdict vocabulary (silent-unauth → not-tested,
  missing-assistant/error → error verdict candidate, etc.).
- No "TBD" or vague requirements. Every step has a concrete output or
  command.
- Ambiguity guard: the user-supplied model list is named explicitly twice
  (Inputs and Non-goals); the verdict vocabulary is enumerated as a fixed
  set; the default report path includes HHMMSS to prevent silent collisions.
- Rev-1 → rev-2 changes (18 findings): all incorporated. The summary at the
  top of the file lists the categories. The non-redaction lessons (#9, #10)
  are added to Context's empirical-lessons list as new items.
