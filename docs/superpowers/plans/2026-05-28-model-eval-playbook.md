# Model Evaluation Playbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author the manual model-evaluation runbook + one public-safe Triglav scenario + scenario-authoring README, plus a `.gitignore` rule, an `exploration.md` cross-link, and an agentmemory pointer. No code.

**Architecture:** Three new markdown docs under `docs/eval/`, minor edits to two existing files, and one memory entry. Reports never live in this repo. Layout enforces privacy: shipped scenarios target only this public repo; `.gitignore` protects accidental commits of `local-*` private scenarios.

**Tech Stack:** Markdown only. `npm run verify-dist` for sanity (markdown changes must not touch `dist/`).

**Spec:** `docs/superpowers/specs/2026-05-28-model-eval-playbook-design.md` (rev 2, commit `33898b7`).

**Commit note:** the pre-commit hook blocks direct `git commit` unless `AV_COMMIT_SKILL=1` is in the command. Every commit step includes it. Never push. Never add Co-Authored-By.

---

## Task 1: Create `docs/eval/playbook.md`

**Files:**
- Create: `docs/eval/playbook.md`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p docs/eval/scenarios/triglav
```

- [ ] **Step 2: Write the playbook**

Write the following content verbatim to `docs/eval/playbook.md`:

````markdown
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
````

- [ ] **Step 3: Verify the file was written**

```bash
wc -l docs/eval/playbook.md
```

Expected: roughly 300+ lines.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add docs/eval/playbook.md && git commit -m "docs(eval): add model evaluation playbook"
```

---

## Task 2: Create the shipped Triglav scenario

**Files:**
- Create: `docs/eval/scenarios/triglav/prompt-pipeline-render.md`

- [ ] **Step 1: Write the scenario file**

Write the following content verbatim to
`docs/eval/scenarios/triglav/prompt-pipeline-render.md`:

````markdown
# Triglav: Perun prompt-pipeline render

**Agent:** triglav
**Target codebase:** this repo (`av-opencode-plugins`)

## Query

How is Perun's system prompt assembled from agent metadata? List the exact
files and functions involved and explain the placeholder rendering flow.
Cite file paths.

## Expected coverage

A correct, thorough answer should mention:

- `getPerunPrompt` (in `src/modules/coordinator/index.ts`) — the cached entry
  point
- `buildPerunPrompt` (in `src/modules/agent-registry/perun-prompt-builder.ts`) —
  the renderer
- `getAgentMetadataRegistry` / `registerAgentMetadata` — registry surface
- The four placeholders rendered into `src/agents/perun.md`:
  - `{SPECIALISTS_TABLE}`
  - `{KEY_TRIGGERS}`
  - `{DELEGATION_TABLE}`
  - `{USE_AVOID:<agent>}`
- The metadata-contributing files:
  `src/modules/explore/triglav.metadata.ts`,
  `src/modules/qa/zmora.metadata.ts`,
  `src/modules/agent-registry/fix-auto.metadata.ts`
- The cache: `cachedPerunPrompt` (template loaded + rendered once per
  process)

## Quality signals

- **Format compliance** — the answer should end with a `<results>` block per
  Triglav's prompt skeleton (the prompt template enforces this; failure to
  comply is a strong instruction-following signal).
- **Min depth** — answers under ~2000 chars usually indicate degeneration
  (model emitted only the `<analysis>` preamble and stopped). Real coverage
  of this scenario needs more than that.
- **Citations** — file paths required; `file:line` pairs are a quality
  bonus.
- **Tool usage** — Triglav is designed to drive serena's LSP tools, but on a
  well-named TypeScript codebase Grep/Glob can substitute. A correct answer
  with **zero** exploration tool calls is a red flag (model answered from
  priors — risky under Perun's Delegation Trust Rule).
- **Hallucination check** — every cited file path / symbol should be
  verifiable in the repo. Reject answers that invent paths.

## What this discriminates

Multi-file synthesis across `src/modules/agent-registry/`,
`src/modules/coordinator/`, `src/modules/explore/`, `src/modules/qa/`, and
`src/agents/perun.md`. Good detector for:

- Models that ignore tools and answer from priors (observed:
  `github-copilot/gpt-5.4-mini` used 0–1 tool calls and produced ~2.6k-char
  skeletal answers in our benchmarks).
- Models that produce only the `<analysis>` preamble and stop without
  `<results>` (observed: occasional `opencode/claude-haiku-4-5`
  degenerations at ~800 chars, ~10 s of work — short-circuit failure mode).
- Models with weak instruction-following for the Triglav output skeleton.
- Models too slow to be useful at the high fan-out Triglav runs at
  (observed: `opencode-go/qwen3.5-plus` completes correctly but at roughly
  3× the latency of the other contenders).

This scenario is self-contained and works against the public repo straight
from `git clone` — no external project, no secrets, no MCP setup beyond
serena (optional; Triglav falls back to Grep/Glob if serena is absent).
````

- [ ] **Step 2: Verify the file was written**

```bash
ls -la docs/eval/scenarios/triglav/prompt-pipeline-render.md
```

Expected: file exists, ~3-4 KB.

- [ ] **Step 3: Commit**

```bash
AV_COMMIT_SKILL=1 git add docs/eval/scenarios/triglav/prompt-pipeline-render.md && git commit -m "docs(eval): add Triglav prompt-pipeline-render scenario"
```

---

## Task 3: Create the scenario authoring README

**Files:**
- Create: `docs/eval/scenarios/triglav/README.md`

- [ ] **Step 1: Write the README**

Write the following content verbatim to
`docs/eval/scenarios/triglav/README.md`:

````markdown
# Triglav evaluation scenarios

Public-safe scenarios that target this repository (`av-opencode-plugins`)
and work out-of-the-box after `git clone`. Used by
[`docs/eval/playbook.md`](../../playbook.md) to compare candidate models for
the Triglav agent.

## What's here

- `prompt-pipeline-render.md` — Multi-file synthesis: how Perun's prompt is
  assembled from per-agent metadata via the placeholder renderer.

(More scenarios may land as we identify failure modes worth a dedicated
test.)

## Writing your own scenario for a private codebase

Do **not** commit scenarios that reference projects outside this repo. Two
safe options:

- Keep your scenario **outside the repo tree** (e.g.
  `~/.config/pantheon/eval/my-scenario.md`) and pass the absolute path to
  the playbook.
- Or keep it **inside the repo tree under a gitignored path**:
  `docs/eval/scenarios/<agent>/local-<name>.md` — the `local-*.md` prefix
  and a `private/` subdirectory under any scenarios folder are both covered
  by `.gitignore`, so they cannot accidentally be `git add`ed.

Workflow:

1. Copy a shipped scenario from this directory as a template.
2. Save the copy at one of the two safe locations above.
3. Edit the following sections:
   - `**Target codebase:**` — absolute path to your repo.
   - `## Query` — your question.
   - `## Expected coverage` — symbols and files Claude can verify by
     inspecting your codebase. Have Claude help generate this list.
   - `## Quality signals` — discriminators that matter for your codebase
     (e.g. a poorly-named codebase may legitimately need serena LSP usage
     as a stronger signal).
   - `## What this discriminates` — the failure modes you want to catch.
4. Run [`docs/eval/playbook.md`](../../playbook.md) with the local path;
   the report goes to `/tmp/` by default.

## Scenario file convention

Section headers are a soft schema — the playbook reads them naturally, no
parser involved:

- `# <Agent>: <short title>` (h1)
- `**Agent:**` / `**Target codebase:**` metadata lines
- `## Query` — verbatim prompt sent to the agent
- `## Expected coverage` — bullet list of symbols / files / phrases the
  answer should mention
- `## Quality signals` — qualitative criteria for grading
  (format / depth / citations / tool usage / hallucination check)
- `## What this discriminates` — failure modes this scenario detects

A scenario is only useful if it can FAIL meaningfully. Always name the
discriminating failure modes in `## What this discriminates` before
shipping a new scenario — if you cannot, the scenario is not yet ready.

## Cross-agent shape note

This README is Triglav-specific, but the convention extends to other agents
in this repo's `docs/eval/scenarios/<agent>/` directories. The section
headers stay the same; the semantics differ:

- **Triglav** (Q&A) — Query in, synthesis out. `## Quality signals`
  evaluates the answer text.
- **Zmora** (execution) — Query is the verbatim QA-scenario block;
  `## Expected coverage` lists the expected pass/fail verdict and critical
  assertions; `## Quality signals` focuses on tool calls (did it actually
  drive the browser / hit the API?).
- **Perun** (orchestration) — Query is a multi-step request; `## Expected
  coverage` names the expected dispatch waves and synthesis points.

The section shape is stable; per-agent quality signals differ.
````

- [ ] **Step 2: Verify the file was written**

```bash
wc -l docs/eval/scenarios/triglav/README.md
```

Expected: ~60 lines.

- [ ] **Step 3: Commit**

```bash
AV_COMMIT_SKILL=1 git add docs/eval/scenarios/triglav/README.md && git commit -m "docs(eval): add scenario authoring README for Triglav"
```

---

## Task 4: Add `.gitignore` rules for local scenarios

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Inspect current `.gitignore` tail**

```bash
tail -10 .gitignore
```

Note the existing trailing entries to ensure the new block lands at the end
without disturbing earlier rules.

- [ ] **Step 2: Append the rules**

Use the `Edit` tool to append the following block at the end of `.gitignore`
(replace the literal string `<LAST_EXISTING_LINE>` placeholder below by
matching the actual last non-blank line of the file). The block format:

```
<LAST_EXISTING_LINE>

# Local (private) evaluation scenarios — never commit
# Authored copies for non-public codebases live here; the playbook at
# docs/eval/playbook.md treats them as one of two safe locations.
docs/eval/scenarios/**/local-*.md
docs/eval/scenarios/**/private/
```

Concretely, append-via-shell that does not require knowing the last line:

```bash
cat >> .gitignore <<'EOF'

# Local (private) evaluation scenarios — never commit
# Authored copies for non-public codebases live here; the playbook at
# docs/eval/playbook.md treats them as one of two safe locations.
docs/eval/scenarios/**/local-*.md
docs/eval/scenarios/**/private/
EOF
```

- [ ] **Step 3: Verify the new rules are in place**

```bash
tail -6 .gitignore
```

Expected: the 4-line block above (1 comment + 1 comment + 2 path rules)
appears at the tail.

- [ ] **Step 4: Verify the rules actually ignore a touch-file**

```bash
mkdir -p docs/eval/scenarios/triglav
touch docs/eval/scenarios/triglav/local-test.md
git check-ignore -v docs/eval/scenarios/triglav/local-test.md
rm docs/eval/scenarios/triglav/local-test.md
```

Expected: `git check-ignore -v` prints the matching `.gitignore` rule;
non-zero exit would mean the pattern did not match.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add .gitignore && git commit -m "chore(gitignore): protect local eval scenarios from accidental commit"
```

---

## Task 5: Cross-link from `docs/exploration.md`

**Files:**
- Modify: `docs/exploration.md` (the "Model selection" section)

- [ ] **Step 1: Locate the anchor line**

```bash
grep -n "See \[\`configuring-agents.md\`\]" docs/exploration.md
```

Expected: one match, in the "Model selection" section, on a line that
introduces the schema link. This is the line we extend.

- [ ] **Step 2: Edit `docs/exploration.md`**

Use the `Edit` tool with:

- `old_string`:

```
Triglav is model-configurable via `pantheon.json` (same mechanism as `perun` and `zmora`). See [`configuring-agents.md`](configuring-agents.md) for the file's location, precedence rules, and full schema. The key:
```

- `new_string`:

```
Triglav is model-configurable via `pantheon.json` (same mechanism as `perun` and `zmora`). See [`configuring-agents.md`](configuring-agents.md) for the file's location, precedence rules, and full schema, and [`eval/playbook.md`](eval/playbook.md) for the manual procedure to compare candidate models for an agent. The key:
```

- [ ] **Step 3: Verify the change**

```bash
grep -n "eval/playbook.md" docs/exploration.md
```

Expected: one match in the "Model selection" section.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add docs/exploration.md && git commit -m "docs(exploration): cross-link to model-eval playbook"
```

---

## Task 6: Create memory entry + update `MEMORY.md`

**Files:**
- Create: `/Users/mef1st0/.claude/projects/-Users-mef1st0-Projects-AppVerk-av-opencode-plugins/memory/eval_playbook.md`
- Modify: `/Users/mef1st0/.claude/projects/-Users-mef1st0-Projects-AppVerk-av-opencode-plugins/memory/MEMORY.md`

This memory entry exists so a fresh Claude session, on noticing model-eval
work in a future request, knows the runbook exists. **Per spec privacy
rules: the memory entry must reference docs paths only — never per-run
details, never private codebase paths.**

- [ ] **Step 1: Write the memory file**

Write the following content verbatim to
`/Users/mef1st0/.claude/projects/-Users-mef1st0-Projects-AppVerk-av-opencode-plugins/memory/eval_playbook.md`:

```markdown
---
name: eval-playbook
description: "Pantheon has a manual model-evaluation runbook at docs/eval/playbook.md; per-agent scenarios live under docs/eval/scenarios/<agent>/. Use when comparing models for an agent."
metadata:
  type: project
---

When the user asks "which model is best for `<agent>`" or wants to compare
model candidates for a Pantheon agent, the procedure is documented at
[[eval-playbook]] target `docs/eval/playbook.md` (rev 2 spec:
`docs/superpowers/specs/2026-05-28-model-eval-playbook-design.md`).

Shipped scenarios target only this public repo (`av-opencode-plugins`) and
live under `docs/eval/scenarios/<agent>/`. As of writing only Triglav has
one: `docs/eval/scenarios/triglav/prompt-pipeline-render.md`. Scenarios for
private codebases must NOT be committed here — they are gitignored
(`local-*.md`, `private/`) or kept outside the repo.

Reports are never committed to this repo. Default destination is
`/tmp/eval-YYYY-MM-DD-HHMMSS-<agent>.md`. The playbook's Step 7 cleanup
deletes the ad-hoc script and server log too — both are private content
because they embed the target codebase path.
```

- [ ] **Step 2: Add a one-line pointer in `MEMORY.md`**

Use the `Edit` tool on
`/Users/mef1st0/.claude/projects/-Users-mef1st0-Projects-AppVerk-av-opencode-plugins/memory/MEMORY.md`
with:

- `old_string`:

```
- [Explorer roadmap progress](pantheon_spec1a_done_next_1b.md) — Spec 1A + 1B + 2 (background dispatch) ALL done on feature/explore (unmerged, kept as-is); next step is merge/PR.
```

- `new_string`:

```
- [Explorer roadmap progress](pantheon_spec1a_done_next_1b.md) — Spec 1A + 1B + 2 (background dispatch) ALL done on feature/explore (unmerged, kept as-is); next step is merge/PR.
- [Eval playbook](eval_playbook.md) — manual model-eval runbook at docs/eval/playbook.md + per-agent scenarios under docs/eval/scenarios/; reports never in repo.
```

- [ ] **Step 3: Verify both files**

```bash
ls -la /Users/mef1st0/.claude/projects/-Users-mef1st0-Projects-AppVerk-av-opencode-plugins/memory/eval_playbook.md
grep -n "Eval playbook" /Users/mef1st0/.claude/projects/-Users-mef1st0-Projects-AppVerk-av-opencode-plugins/memory/MEMORY.md
```

Expected: file exists; the new MEMORY.md line is present.

- [ ] **Step 4: No git commit**

These memory files live OUTSIDE the project repo (under `~/.claude/`).
They are not tracked by this repo's git and require no commit step here.

---

## Task 7: Final verification + branch-state snapshot

**Files:** none (verification only).

- [ ] **Step 1: Confirm `dist/` is unaffected**

```bash
npm run verify-dist
```

Expected: `✅ dist/ is in sync with src/`. Markdown-only changes must not
touch the build output; a failure here means a Task accidentally edited
something under `src/` or `dist/`.

- [ ] **Step 2: Inspect the resulting branch state**

```bash
git status --short
git log --oneline -8
```

Expected: working tree clean (apart from any pre-existing untracked files
unrelated to this plan); the last six commits on the branch are
Tasks 1–6 (Task 7 produces no commit) in order.

- [ ] **Step 3: Verify the cross-link resolves**

```bash
test -f docs/eval/playbook.md && echo "playbook OK"
test -f docs/eval/scenarios/triglav/prompt-pipeline-render.md && echo "scenario OK"
test -f docs/eval/scenarios/triglav/README.md && echo "README OK"
grep -q "eval/playbook.md" docs/exploration.md && echo "exploration cross-link OK"
grep -q "Local (private) evaluation scenarios" .gitignore && echo "gitignore OK"
```

Expected: five `OK` lines.

---

## Self-Review

**Spec coverage** — every Implementation-checklist item in the spec
(`docs/superpowers/specs/2026-05-28-model-eval-playbook-design.md`,
"Implementation checklist (for writing-plans)") maps to a task:

1. Create `docs/eval/` directory → Task 1 Step 1.
2. Write `docs/eval/playbook.md` (Requirements, Cost-and-quota, When to
   use, Inputs, 7-step procedure with concrete commands, 10 Lessons,
   Adapting link) → Task 1.
3. Write `docs/eval/scenarios/triglav/prompt-pipeline-render.md` → Task 2.
4. Write `docs/eval/scenarios/triglav/README.md` (canonical "Adapting"
   guide) → Task 3.
5. Add `.gitignore` rules → Task 4.
6. Cross-link from `docs/exploration.md` → Task 5.
7. Update memory with a pointer entry (docs paths only) → Task 6.
8. Verify `npm run verify-dist` still passes → Task 7.

**Placeholder scan** — the plan contains the literal final content for
every file it creates. No "TBD", "TODO", "fill in later", or "similar to
Task N — repeat the code" references. The `<LAST_EXISTING_LINE>` token in
Task 4 Step 2 is illustrative only; the actual command used is the
`cat >> .gitignore <<EOF` heredoc in the same step, which requires no
existing-line knowledge.

**Type consistency** — there is no code in this plan, hence no method
signatures to keep consistent. The Verdict vocabulary
(`recommend` / `acceptable` / `degenerate` / `unreliable` / `not-tested`)
referenced in the playbook (Task 1) matches the spec (Step 4 of the spec's
procedure). The outcome decision tree values
(`done` / `error` / `timeout` / `missing-assistant` / `silent-unauth`)
referenced in the playbook (Task 1 Step 3) match the spec (Step 3 of the
spec's procedure). Section names of the scenario convention
(`## Query`, `## Expected coverage`, `## Quality signals`,
`## What this discriminates`) used in the playbook (Task 1), the shipped
scenario (Task 2), and the README (Task 3) are byte-identical across all
three files.
