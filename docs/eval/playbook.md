# Pantheon Model Evaluation Playbook

Manual procedure for evaluating which model best fits a given Pantheon agent
(`triglav`, `zmora`, `perun`). No CI, no automation, no framework — Claude Code
runs this interactively when asked. The artefact you are reading IS the tool.

The spec that justifies every choice below lives at
[`docs/superpowers/specs/2026-05-28-model-eval-playbook-design.md`](../superpowers/specs/2026-05-28-model-eval-playbook-design.md).

## When to use this playbook

- Picking the model for an agent (initial selection or after a release).
- Re-checking a configured model after a model-family refresh.
- Sanity-checking that a recently-changed agent prompt still works on its
  configured model.

## Requirements

- **`opencode` CLI** in PATH — used for `opencode serve` (headless server) and
  `opencode models` (catalog lookup during pre-flight).
- **`@opencode-ai/sdk`** resolvable from the directory the ad-hoc Node script
  runs in. Typically the repo Claude is currently working in (this repo has
  the SDK as a dependency, so running the script from this repo's root works
  out-of-the-box).
- **Authed providers** in `~/.local/share/opencode/auth.json` for every
  candidate model. Step 1 verifies (both statically and dynamically).

No other dependencies — no framework, no CI, no external services.

## Cost and quota

Each candidate × iteration is a real billable LLM turn. A typical run
(3–4 models × 2 iterations × 60–150 s answers) can cost meaningful money on
opus-class candidates and hit rate limits on subscriptions. Before running
with paid providers, surface an estimate to the user and ask for confirmation.

Defaults that keep cost low: candidate lists ≤ 4 models, iterations ≤ 2.
Free / subscription-included models (e.g. `opencode/deepseek-v4-flash-free`)
are unconstrained financially but may still hit per-minute throttles.

## Inputs

The user supplies five inputs per run:

1. **Agent under test** — e.g. `triglav`.
2. **Scenario file path** (absolute) — either a shipped one in
   `docs/eval/scenarios/<agent>/` or a user-local one.
3. **Candidate models** — **user-supplied list** of `<providerID>/<modelID>`
   strings (e.g. `opencode/claude-haiku-4-5`, `opencode-go/deepseek-v4-flash`).
   No defaults; no auto-discovery. Re-check the catalog with `opencode models`
   first — IDs drift between releases.
4. **Iterations per model** — default 2 (catches variance like the haiku
   degeneration observed in the session that produced this playbook).
5. **Report destination** — absolute path; default
   `/tmp/eval-YYYY-MM-DD-HHMMSS-<agent>.md`. The HHMMSS suffix prevents
   overwrites on same-day re-runs. Refuse to overwrite an existing file
   without explicit confirmation.

## Procedure

### Step 1 — Pre-flight

Read the scenario file. Extract: `## Query`, `## Expected coverage`,
`## Quality signals`, and the `**Target codebase:**` metadata. Verify the
target path exists.

For each candidate model:

- **Static check** — `jq -r 'keys[]' ~/.local/share/opencode/auth.json`
  should list the provider; `opencode models | grep <modelID>` should show
  the model. If either is missing, drop the candidate with an explicit note
  in the report (`not-tested: provider not authed` or
  `not-tested: model not in catalog`).
- **Dynamic check (recommended)** — provider key presence in `auth.json` is
  not the same as a valid token. Either do a single 1-token probe call
  up-front, or treat the first benchmark turn that returns in < 5 s with
  0 characters and 0 tool calls as the **silent-unauth signature** (see
  Lesson 3) and skip the candidate.

Record `opencode --version`, the `@opencode-ai/sdk` version
(`node -e 'console.log(require("@opencode-ai/sdk/package.json").version)'`),
and a snapshot date for `opencode models` into the report header so a
future re-run can detect catalog drift.

After the server is up (Step 2), confirm the agent under test is registered
via `client.app.agents()` and the returned list contains the agent name.

### Step 2 — Spin up isolated server

Pick an ephemeral free port (avoids collision with the user's active TUI
servers, e.g. 22227 / 37373):

```bash
PORT=$(node -e 'const s=require("net").createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});')
```

Start the dedicated headless OpenCode server in the target directory and
capture its PID:

```bash
sh -c "cd <target> && opencode serve --port $PORT --hostname 127.0.0.1" \
  > /tmp/oc_eval_server_$PORT.log 2>&1 &
SERVER_PID=$!
```

Poll for readiness (cap at ~10 s):

```bash
for i in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/app" >/dev/null && break
  sleep 0.2
done
```

**Never** point the SDK at the user's active TUI server — always spawn a
dedicated one on an ephemeral port. The log filename is port-suffixed so
parallel runs do not clobber.

### Step 3 — Run the benchmark

From within a directory where `@opencode-ai/sdk` resolves (typically this
repo's root), write an ad-hoc Node script to `/tmp/oc_eval_$PORT.mjs`. The
script MUST register `SIGINT` / `SIGTERM` handlers that kill `SERVER_PID`
and delete any sessions it created, so a crash or `Ctrl-C` does not leak
the server.

Minimal reference skeleton — extend with candidate loop, iteration loop,
JSON capture for the report:

```javascript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${PORT}` })

// SIGINT / SIGTERM cleanup: kill the spawned server and exit.
const cleanup = () => {
  try { process.kill(SERVER_PID) } catch {}
  process.exit(130)
}
process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)

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
let error
while (Date.now() - t0 < TIMEOUT_MS) {
  await new Promise((r) => setTimeout(r, 1500))
  const msgs = (await client.session.messages({ path: { id } })).data ?? []
  const last = msgs.at(-1)
  if (last?.info?.error) {
    outcome = "error"
    error = String(last.info.error).slice(0, 200)
    break
  }
  if (
    last?.info?.role === "assistant" &&
    last.info?.time?.completed
  ) {
    outcome = "done"
    break
  }
}

// Capture final assistant text, tool call names, latency, sessionID,
// messageID, then session.delete(...).
```

**Outcome decision tree** (per iteration — what the loop above branches on
plus two derived cases evaluated after capture):

- `last.info.time.completed` truthy → **done**.
- `last.info.error` populated → **error** (record the error string).
- No assistant message after `TIMEOUT_MS` (default 240 s; raise to 600 s for
  very large codebases) → **timeout**.
- Last message is non-assistant after the wait → **missing-assistant**
  (treat as error; provider rejected the prompt).
- Empty assistant turn (< 5 s, 0 chars, 0 tool calls) → **silent-unauth**
  (per Lesson 3) — skip remaining iterations for this candidate and record
  in the report.

**Determinism note.** Temperature is provider-default (Pantheon does not
pin it for these agents). Iteration-to-iteration variance reflects sampling,
not just model capability — name this in the report's Caveats. Capture
`sessionID`, the final `messageID`, and per-iteration timestamps so a
future investigator can locate the exact turn in OpenCode state.

### Step 4 — Score per model (Claude judgement)

For each completed iteration, assess against the scenario's sections:

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
  delta > 2×, conflicting outcome (done in run 1, degeneration in run 2).
  Flag explicitly in per-model details.

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

### Step 5 — Anchor run (recommended)

When introducing a new candidate, also run one trusted model (e.g.
`opencode/claude-haiku-4-5`) once as a baseline. If the anchor degenerates,
annotate the report — the environment is suspect, not the new candidates.
Skip the anchor when comparing only well-characterised models.

### Step 6 — Write the report

Generate markdown at the user-specified destination (default
`/tmp/eval-YYYY-MM-DD-HHMMSS-<agent>.md`; refuse to overwrite an existing
file without explicit user confirmation). Structure:

**Header** — scenario file, target codebase (path + git SHA if a git repo),
iterations per model, `opencode --version`, `@opencode-ai/sdk` version,
`opencode models` snapshot date, environment notes (anchor model used if
any), timestamp of the run.

**Summary table** — one row per model:

| Model | Verdict | Outcome | Avg latency | Coverage | Structural | Depth (avg) | Tool profile |
|-------|---------|---------|-------------|----------|------------|-------------|--------------|

Outcome values: `done` / `timeout` / `error` / `silent-unauth`. Verdict
values: as enumerated in Step 4.

**Per-model details** — coverage hits/misses, citations count, `sessionID`
and final `messageID` per iteration, an excerpt (~200 chars; truncate at
whitespace and append `…`) of the best run's answer, observed variance
across iterations, individual Verdict line with one-sentence reasoning.

**Caveats** — single-run nondeterminism (variance attributed to sampling
at provider-default temperature), token-match generosity, dropped models
(with reason), any observed instability, environment anomalies (anchor
degeneration etc.), model-ID drift hits.

**Recommendation** — 2–4 sentences of reasoning. End with a single
`PICK:` line naming the chosen `<providerID>/<modelID>`, or
`PICK: none — see Caveats` if no clear winner emerged. Include a ranked
alternates list (top 3) when several models are close.

**Applying the recommendation** — short subsection reminding the reader
that the pick is applied by editing `pantheon.json`:

```jsonc
{ "agents": { "<agent>": { "model": "<providerID>/<modelID>" } } }
```

Reference [`docs/configuring-agents.md`](../configuring-agents.md) for file
location and precedence rules.

### Step 7 — Cleanup

- Kill the server:

  ```bash
  kill $SERVER_PID 2>/dev/null
  sleep 0.5
  kill -9 $SERVER_PID 2>/dev/null || true
  ```

  As a recovery fallback for crashed runs, `pgrep -f "opencode serve --port"`
  lists any orphaned servers.

- Sweep any sessions the script created (`session.list` →
  `session.delete` for sessions matching the eval-run title prefix), so
  subsequent evals do not see stale sessions.

- Remove the temp script (`/tmp/oc_eval_$PORT.mjs`) and the server log
  (`/tmp/oc_eval_server_$PORT.log`). Both reference the target codebase
  path; treat them like reports — never commit, never reference outside the
  local filesystem.

- Run `git status --short` **in the target directory regardless of whether
  it is this repo or another** — Triglav is read-only and any change is
  unexpected; surface a non-empty status in the report's Caveats. The
  serena LSP server writes to `.serena/cache/` during indexing; that path
  is expected and gitignored — treat it as whitelisted noise rather than a
  finding.

- **Never commit a report that references a private codebase.** The default
  report path is `/tmp/`, so this is the obvious default.

## Lessons learned

These ten lessons came from the session in which we picked Triglav's model
by ad-hoc benchmark. Read them before every run — they are why the
procedure looks the way it does.

1. **`promptAsync` is the right primitive** — `session.prompt` blocks for
   the full LLM turn; `session.promptAsync` returns ~immediately and the
   child session progresses autonomously.
2. **Completion signal is `info.time.completed`**, not `finish_reason`.
   Intermediate `tool-calls` pauses set a truthy `finish_reason` mid-turn.
3. **Check auth before testing a provider.** `openai/*` models complete in
   ~4.5 s with 0 chars when the `openai` provider is unauthed; the failure
   is silent (no `info.error`). Empty turn + 0 chars from a fresh model on
   the first call is the silent-unauth signal. Treat as "skip with a note".
   Note that key *presence* in `auth.json` is not the same as a *valid*
   token; the only definitive check is a probe call.
4. **Anchor with a known-good model** when introducing new candidates. A
   degenerate anchor signals a cold serena cache or other environmental
   issue, not a model defect.
5. **"Stuck" often means "slow"** — `opencode-go/qwen3.5-plus` appeared to
   hang at our initial 150 s timeout; at 240 s it completed in ~145 s.
   Raise the cap before declaring a model broken.
6. **Token matching is too generous on its own.** Pair it with structural
   checks (output skeleton present? answer length above a degeneration
   floor? any tool calls at all?) or you will rate degenerate answers the
   same as thorough ones.
7. **Read the full answers.** Quality often hides in length, citations, and
   subtle architectural caveats that token-match cannot see.
8. **Private-repo isolation** — reports often contain absolute paths and
   excerpts of the target codebase. Never commit reports that reference
   anything outside this public repo.
9. **Every candidate × iteration is a real billable LLM turn.** Three
   models × two iterations against opus-class candidates on a large
   codebase can silently burn double-digit dollars and risk rate-limit
   hits. Keep candidate lists short (≤ 4) and iterations low (default 2);
   warn before running on paid providers.
10. **Match scenario difficulty to the model gap.** If every candidate
    scores 100 % the scenario does not help — it does not discriminate.
    Deliberately include queries that stress a weakness (find-references
    on poorly-named code, multi-file synthesis, output-format compliance),
    and keep at least one "easy" baseline to detect environmental issues.

## Adapting a scenario for your own codebase

See the canonical guide at
[`scenarios/triglav/README.md`](scenarios/triglav/README.md). In summary:

1. Copy a shipped scenario as a template into a directory outside this repo
   (e.g. `~/.config/pantheon/eval/my-scenario.md`) or under a gitignored
   path inside the repo (`docs/eval/scenarios/<agent>/local-<name>.md` —
   covered by `.gitignore`).
2. Edit `**Target codebase:**`, `## Query`, `## Expected coverage` (inspect
   your codebase to verify; have Claude help build the list), `## Quality
   signals`, and `## What this discriminates`.
3. Run this playbook with the local scenario path. The report goes to
   `/tmp/` by default. Do not commit either the scenario or the report to
   a public repository.
