# QA Preflight + `NEED_INFO` — Design

**Date:** 2026-05-25
**Status:** Draft (pending review)
**Scope:** Perun coordinator + Zmora QA subagents — `/run-qa` flow only.

## Problem

During `/run-qa`, Perun asked the user for `.env` access (to extract login credentials needed by Zmora). User declined. Perun dispatched Zmora anyway. Zmora-FE/BE failed all scenarios with 401-class errors because no credentials reached them. The user wasted a 5-minute dispatch wave and got a useless report.

Two underlying defects:

1. **No upfront contract for prerequisites.** Test plans declare scenarios but not what those scenarios *need* (env vars, services, databases). Perun improvises — which today means trying to read `.env`.
2. **No abort gate between "setup broken" and "dispatch starts".** Once `dispatch_parallel` runs, all tasks in the wave run to completion or timeout. There is no in-band channel for Zmora to say "I'm missing X" and have Perun pause.

## Constraints (from codebase)

| Constraint | Source | Implication |
|---|---|---|
| OpenCode SDK exposes no TUI input primitive — only `showToast` | `src/modules/coordinator/index.ts:268` | No synchronous mid-dispatch user prompt is possible. |
| The `question` tool is a Claude-side thought channel, not a user input channel | `src/agents/perun.md:5`, session-notification hook | "Asking the user" can only happen by Perun responding in chat and waiting for the next turn. |
| `dispatch_parallel` blocks until every task in a wave finishes | `src/modules/coordinator/dispatch.ts:100-129` | Mid-wave interrupt not implementable. Need-info must arrive as a per-task exit status. |
| Sanitization already blocks Zmora from reading `.env` etc. | `src/agents/perun.md:41` | Sanitization is about scenario steps, not about Perun's own reads. Perun must stop reading `.env` voluntarily. |
| Perun is a primary agent; conversation history is its state | OpenCode runtime | Multi-turn resume needs no persistence layer — Perun reconstructs from chat. |
| OpenCode inherits process env from the shell that launched it | POSIX | Env vars set or `source .env`'d **after** OpenCode started are invisible to preflight. User must set env vars in the same shell that launches OpenCode, then start (or restart) OpenCode. |

## Decision

Adopt a **hybrid**: structured `## Setup` declaration in plans + Perun preflight before dispatch + `NEED_INFO` exit status as backstop for gaps preflight missed. Resume across turns via conversation history.

Rejected alternatives:

- **Pure option 1** (mid-dispatch interrupt) — infeasible without OpenCode SDK changes.
- **Pure option 2** (preflight only) — plans evolve, scenarios drift; backstop is cheap.
- **Perun auto-loads `.env`** — security regression. Credentials are user responsibility; plan only declares the contract.

---

## Part A — Plan format: `## Setup` section

`/create-qa-plan` emits an explicit `## Setup` block. The plan declares the **contract** (what's required); the user fulfils the contract (sets env vars, starts services). Plans never instruct Zmora to read secret files.

```markdown
---
source: PR #42
branch: feature/login
base-url: http://localhost:3000
detected-tools: [playwright, curl, psql]
---

## Setup

**Required environment variables:**
- `TEST_USER_EMAIL` — login email for test account
- `TEST_USER_PASSWORD` — login password for test account

**Required services:**
- App at `http://localhost:3000` (responds 2xx on `/healthz`)

**Required databases:**
- `postgresql://localhost:5432/myapp_test`

## FE Test Scenarios
...
## BE Test Scenarios
...
```

**Parser contract:**

- Section heading exactly `## Setup` (one occurrence, optional). When present, **must appear before** `## FE Test Scenarios` / `## BE Test Scenarios` so the parser is single-pass.
- Subsections recognized by bold headers (trailing colon optional): `**Required environment variables:**`, `**Required services:**`, `**Required databases:**`.
- Items are markdown bullets.
  - **Env var items:** backticked NAME matching regex `^[A-Z_][A-Z0-9_]*$` + optional ` — description`. Items not matching the regex are ignored with a warning toast naming the bad line.
  - **Service items:** free text + a URL in backticks (`http://...`, `https://...`, or any scheme curl supports).
  - **DB items:** backticked DSN with explicit scheme (`postgresql://...`, `mysql://...`, `redis://...`, `sqlite:///...`). The scheme selects the probe client (Step 3.5.d). Schemeless forms are rejected with a warning.
- **Soft cap: ≤50 total prerequisites per plan.** Plans exceeding this fail preflight with `too many prerequisites (N) — split the plan or remove unused items`.
- Unknown subsections → ignored with a warning toast (forward-compat, same precedent as `pantheon.json` schema).
- Absent `## Setup` → preflight is **skipped** with a warning; dispatch proceeds as today.

`/create-qa-plan` infers prerequisites from the diff:

- New `process.env.X` / `os.environ["X"]` / `getenv("X")` usage in PR → add `X` to required env vars.
- New service URL in code (e.g., `redis://`, `http://localhost:NNNN`) → add to required services.
- New DB connection string usage → add to required databases.

The generator emits its best guess; the user edits the plan before running QA.

## Part B — Perun preflight (new Step 3.5)

Insert between current Step 3 (sanitization) and Step 4 (ensure output dir) in `src/agents/perun.md`. Also **remove** "fall back to env files" from Step 2's base-URL detection — `base-url` is now a frontmatter prerequisite.

```
3.5. Preflight prerequisites.

  a. Parse the `## Setup` section. If absent, emit toast
     "QA plan has no Setup section — skipping preflight" and continue to Step 4.
     Auto-inject `base-url` from frontmatter (if present) as an additional
     required service so it gets probed the same way.

  b. For each required environment variable VAR, check the current shell:
       bash -c '[ -n "${VAR:-}" ] && echo OK || echo MISSING'
     This MUST NOT echo the value — only OK/MISSING. NEVER read .env,
     .env.local, .envrc, or any dotfile.

  c. For each required service with URL U:
       curl -sS -o /dev/null -w "%{http_code}" --max-time 3 "$U"
     Accept 2xx, 3xx, 401, 403 as "service reachable" — 401/403 means the
     server is up and rejecting unauthenticated calls, which is expected for
     auth-walled endpoints. Only 000 (connection failure / DNS), 4xx other
     than 401/403, 5xx, and timeouts = MISSING.

  d. For each required database, dispatch by DSN scheme:
       postgresql://  → pg_isready -h <host> -p <port> -d <db> -t 3
       mysql://       → mysqladmin ping -h <host> -P <port> --silent
       redis://       → redis-cli -h <host> -p <port> ping
       sqlite:///     → test -r <path>
     If the required client tool is not on PATH → MISSING with hint
     "client tool `<name>` not installed".

  e. Probes run in parallel with a concurrency cap of 8 (use `xargs -P 8`
     or equivalent). Per-probe timeout: 3 s. Total wall-clock for a plan
     with N prereqs: ≈ ceil(N/8) × 3 s.

  f. Aggregate all MISSING items. If non-empty, ABORT — do NOT call
     dispatch_parallel. Respond to the user with the structured prompt
     from Part C. Wait for their reply (next turn).

  Note: Preflight is a snapshot, not a guarantee. A service that responded
  in (c) may go down before dispatch reaches it; that case is handled by
  Part D's NEED_INFO backstop.
```

## Part C — User-facing missing-prerequisites prompt

When preflight (or post-dispatch `NEED_INFO` aggregation) finds gaps, Perun **responds in chat** — no toast, no question tool, no SDK primitive. Format:

**Preflight-stage prompt (no scenarios have run yet):**

```
⚠️ Cannot start QA — {N} prerequisite(s) missing:

Environment variables not set in OpenCode's process:
  • TEST_USER_EMAIL
  • TEST_USER_PASSWORD

Services not reachable:
  • PostgreSQL at localhost:5432 (connection refused)

To proceed:
  1. In the SAME shell that launches OpenCode, set the env vars:
     `export TEST_USER_EMAIL=…  TEST_USER_PASSWORD=…`
     (or `source .env` in that shell before starting OpenCode)
  2. Start PostgreSQL: e.g. `docker compose up -d db`
  3. RESTART OpenCode if it's already running — env changes don't propagate live.

Then re-run /run-qa.
```

**Mid-run prompt (some scenarios ran, others returned `NEED_INFO`):**

```
⏸ Pausing QA — {M} scenario(s) need additional setup.

Wave 0 results:
  ✅ BE-01 — passed
  ❌ BE-03 — error: HTTP 500 (will not auto-retry — investigate first)
  ⏸ BE-02 — needs STRIPE_TEST_KEY

Not yet dispatched ({K} scenarios in Wave 1+):
  BE-04, BE-05, BE-06

Missing:
  • STRIPE_TEST_KEY (env var)

To proceed:
  1. Set STRIPE_TEST_KEY in the shell that launched OpenCode, then restart OpenCode.
  2. Reply "resume" to continue from where we stopped (BE-01 stays passed, BE-03 stays
     errored, BE-02 + Wave 1+ re-dispatch).
  3. Reply "abort" to finalize the report with current results (no further dispatch).
  4. Re-running /run-qa starts over from scratch and discards Wave 0 progress.
```

Both prompts: name every gap, explain what user must do, and **never** ask the user to paste secrets into chat (that would store creds in transcript). Setup is environmental.

If the user does paste a secret anyway, **Perun MUST NOT echo the value** in its response. It acknowledges generically: *"Got it — please ensure that env var is set in OpenCode's process; restart OpenCode if needed."*

## Part D — Zmora `NEED_INFO` exit status

Extend the Zmora return contract in `src/modules/qa/prompt-sections/core.md`:

```json
{
  "status": "NEED_INFO",
  "scenario": "BE-03",
  "kind": "credentials" | "service" | "fixture" | "tool",
  "missing": ["STRIPE_TEST_KEY"],
  "hint": "Set STRIPE_TEST_KEY in shell, re-run /run-qa or reply 'resume'"
}
```

**Triggers (in priority order):**

1. **Primary, deterministic:** An env var declared in `## Setup` is empty at scenario runtime. Each overlay adds a check before the first request and returns `NEED_INFO` immediately.
2. **Primary, deterministic:** A required tool (`psql`, `redis-cli`, …) is not on PATH.
3. **Secondary, heuristic (best-effort):** HTTP request returns 401/403, OR DB connection fails with an auth error. Zmora's `hint` field is best-effort here — the missing var name may be wrong; user judgment required.

**Wave-status contract.** A `NEED_INFO` payload travels as the structured `result` of a **successful** task — the wave-level `DispatchResult.status` is `success`, and the JSON payload inside contains `"status": "NEED_INFO"`. Wave status `error`/`timeout` is treated as today (SKIP with error message as reason), not as `NEED_INFO`. This keeps `dispatch.ts` unchanged.

`dispatch_parallel` returns mixed payloads in a single wave (some `success`/success, some `success`/`NEED_INFO`, some `error`). Perun's wave-result loop (extending Step 6 / `perun.md:111-117`):

1. Categorize each result by parsing the JSON payload.
2. If any payload has `"status": "NEED_INFO"`:
   - **Do not dispatch any subsequent wave** (Wave N+1 simply isn't started — nothing to "cancel" because dispatch is blocking-per-wave).
   - Aggregate all `NEED_INFO` payloads across the current wave.
   - Emit the **mid-run prompt** from Part C with the full status snapshot.
3. If no `NEED_INFO` → proceed to next wave as today.

## Part D.1 — Resume semantics

When the user replies after a Part C prompt, Perun treats the conversation as a single QA run continuing across turns.

**Categorization of pre-resume scenarios:**

| State | On resume |
|---|---|
| `success` | keep result, do NOT re-dispatch |
| `NEED_INFO` | re-dispatch (this is what the user just unblocked) |
| Scenario in an un-started wave (cancelled) | re-dispatch |
| `error` / `timeout` | do NOT auto-retry; surface to user with note "investigate before re-running" |
| SKIP from sanitization (security-related) | do NOT re-dispatch; permanent for this plan |

**Resume procedure:**

1. **Re-run preflight first.** If anything still MISSING → respond again with Part C (preflight prompt). Loop is bounded by user — every turn is one iteration.
2. Build a re-dispatch list: `R = { scenarios that returned NEED_INFO } ∪ { scenarios from un-started waves }`.
3. **Pre-filter dependencies.** For each scenario in `R`, drop entries from its `depends_on` that point to scenarios already in `success` state. Without this, `compute_waves` raises a "dangling reference" error when called on `R` alone (the satisfied predecessor isn't in `R`). Conceptual rule: passed predecessors are treated as implicit success-edges.
4. **Predecessor failure does not block.** Scenarios in `R` whose `depends_on` includes an `error`/`timeout` predecessor are still dispatched. This matches the existing contract (`qa.md:135`: "predecessor failure does NOT block dependents") — Perun does not cascade failure.
5. Recompute waves from the filtered re-dispatch list via `compute_waves`.
6. Dispatch. Merge results: previously-passed scenarios keep their results; new dispatch overwrites their `NEED_INFO` predecessors.
7. If the resume dispatch itself returns more `NEED_INFO` → repeat from step 1. No turn limit, but the user can say "abort" at any point.
8. **Abort handling.** If the user says "abort" / "stop" / "skip remaining" → Perun writes the report with what it has (passing + failed + NEED_INFO-as-SKIP + un-started-as-SKIP), no further dispatch.

**Confirmation gate.** Before re-dispatching, Perun explicitly asks: *"Resume QA with {M+K} scenarios? (M previously blocked + K never started)"* and waits for a yes-equivalent. This protects against ambiguous user replies like "ok cool" being read as "go" when the user only meant to acknowledge.

**State storage:** none. Perun reconstructs the partial-results table from its own previous turn's mid-run prompt (Part C). No `.partial.json` files; no checkpoint module. **This requires the mid-run prompt to enumerate every scenario by ID with its status** — that listing is the canonical state for the resume turn.

**Plan modification between turns is undefined.** If the user edits the plan file between Turn N and Turn N+1, Perun does not attempt to reconcile. Recommended user action: re-run `/run-qa` from scratch. Perun may emit a soft warning if the plan's mtime changed between turns.

## Part E — Files to change

| File | Change | Est. lines |
|---|---|---|
| `src/agents/perun.md` | Insert Step 3.5 (preflight). Strip "fall back to env files" from Step 2. Extend Step 6 with `NEED_INFO` categorization and resume logic. | ~80 |
| `src/commands/create-qa-plan.md` | Emit `## Setup` section. Inference rules for env vars / services / DBs from PR diff. Template update. | ~50 |
| `src/modules/qa/prompt-sections/core.md` | Add `NEED_INFO` to status enum + JSON example. | ~15 |
| `src/modules/qa/prompt-sections/overlay-fe.md` | Pre-flight env check; 401 detection → `NEED_INFO`. | ~15 |
| `src/modules/qa/prompt-sections/overlay-be.md` | Pre-flight env + tool check; 401/403 + DB auth → `NEED_INFO`. | ~20 |
| `docs/testing/plans/` (example plans) | One example plan with `## Setup` section, for documentation. | ~30 |

**No new TypeScript modules.** All logic fits in prompts. `dispatch_parallel`, `compute_waves`, `assign_issue_ids` are unchanged.

## Part F — Backward compatibility

| Scenario | Behavior |
|---|---|
| Old plan (no `## Setup`) | Preflight skipped with toast warning; dispatch as today. |
| Old Zmora response without `NEED_INFO` (just `success`/`error`/`timeout`) | Treated as today. `NEED_INFO` is opt-in via new overlay prompts. |
| `## Setup` with unknown subsections | Ignored with warning toast. Forward-compat. |
| Plan declares prereqs but user has them set anyway | Preflight passes silently; no UX change. |

## Part G — Scope exclusions (deliberate)

- **No mid-dispatch interrupt.** Needs OpenCode SDK changes; out of scope.
- **No `.env` auto-loading by Perun.** Security regression.
- **No persistent partial-state file.** Conversation history suffices.
- **No automatic credential-pasting flow.** Pasting secrets into chat stores them in transcript; we deliberately keep credentials environmental.
- **No retry of `error` / `timeout` on resume.** These may be real bugs; auto-retry would mask them.
- **No DB schema / fixture seeding.** Plan declares the DB must be reachable; populating it is user setup.

## Part H — Risks & mitigations

| Risk | Mitigation |
|---|---|
| Preflight checks themselves require tools (`curl`, `pg_isready`) that aren't installed | Probe for the tool first; if missing, surface as a preflight gap with install hint. |
| `/create-qa-plan` infers wrong prerequisites from diff (false positives → annoying prompts; false negatives → `NEED_INFO` at runtime) | False positives: user edits plan before run. False negatives: `NEED_INFO` backstop catches them. Both paths converge on the same Part C prompt. |
| `## Setup` section drifts from reality (someone adds a test using `STRIPE_KEY` without updating Setup) | `NEED_INFO` from Zmora catches it. The drift becomes a soft warning, not a silent failure. |
| User pastes secrets into chat anyway despite our prompt asking them not to | Conversation history is the user's terminal — we can't prevent this. Part C wording asks them to set in shell instead. |
| Endless resume loop (user keeps providing partial info) | Each turn is one iteration; user can `abort` at any point. No silent retry. |
| Service preflight succeeds but service crashes between preflight and dispatch | Dispatched scenario gets connection-refused → `NEED_INFO`. Backstop catches it. |

## Part I — Open questions

None blocking after the 2026-05-25 sequential-thinking revision. Ambiguities resolved in that pass:

- DSN format requires explicit scheme (`postgresql://`, `mysql://`, `redis://`, `sqlite:///`).
- `base-url` from frontmatter is auto-injected as a required service in preflight.
- Service preflight treats 401/403 as "reachable" (auth-walled but up).
- `NEED_INFO` travels inside `success`-status wave results; dispatch.ts unchanged.
- Resume pre-filters `depends_on` to drop satisfied predecessors before `compute_waves`.
- Mid-run prompt must enumerate every scenario by ID — that listing is the resume state.
- Plan modification between turns is undefined behavior; recommend `/run-qa` from scratch.
- OpenCode inherits process env from launch shell — user must set env before launch (or restart OpenCode after setting it).

## Part J — Acceptance criteria

A QA run with broken setup should:

1. Detect the gap in ≤30 s (preflight) **or** at most one wasted wave (`NEED_INFO` backstop).
2. Tell the user **exactly which** env vars / services / DBs are missing.
3. Never read `.env` (or any dotfile) from Perun's side.
4. Resume cleanly: scenarios that passed pre-resume appear `success` in the final report and are NOT re-dispatched.
5. Allow `abort` to write a partial report with what passed/failed/skipped.
6. Preflight never echoes env-var values to chat (only OK/MISSING); Perun never echoes pasted secrets back.

A QA run with a complete setup should be **indistinguishable** from today's flow (no new toasts, no extra prompts, no perf regression) — preflight passes silently, dispatch runs as today, report is identical.
