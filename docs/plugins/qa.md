# QA Plugin Guide

The QA plugin provides end-to-end testing and quality assurance workflows for projects using the AppVerk OpenCode plugin bundle. It supports both frontend (Playwright browser automation) and backend (API endpoint + database) testing, with structured test plans and reports.

## Installation

The root plugin bundle includes this package automatically. No separate installation is required.

## Usage

### Create a QA test plan

Generate a structured test plan from a PR description, ticket, or feature specification:

```text
/create-qa-plan [PR description or ticket text]
```

Examples:

```text
/create-qa-plan Add two-factor authentication to the login flow
```

```text
/create-qa-plan Fix pagination on the user list page
```

The command creates a `docs/testing/plans/YYYY-MM-DD-<topic>-test-plan.md` file with test cases, preconditions, and expected results.

### Run a QA session

Execute a saved test plan or run a quick ad-hoc QA check:

```text
/run-qa [plan-file-or-path]
```

Examples:

```text
/run-qa docs/testing/plans/2026-04-29-feature-auth-test-plan.md
```

```text
/run-qa src/auth/components/LoginForm.tsx
```

The `/run-qa` command:

1. Loads the test plan file or finds the most recent plan in `docs/testing/plans/`
2. Extracts every `### FE-XX:` / `### BE-XX:` scenario into a flat list
3. Routes each scenario by prefix: `FE-` → `zmora-fe` variant, `BE-` → `zmora-be` variant
4. Dispatches one `zmora` task per scenario through `dispatch_parallel`'s 4-worker pool
5. Honours `**Depends-on:**` annotations by computing topological waves and dispatching wave-by-wave
6. Collects results into a markdown report with pass/fail status
7. Generates `docs/testing/reports/YYYY-MM-DD-<topic>-report.md`

## Direct Agent Use

You can also invoke the testing agent directly for ad-hoc checks. The agent registers as two variants — pick the one matching your stack:

```bash
opencode agent zmora-fe "Run accessibility checks on the checkout page"
```

```bash
opencode agent zmora-be "Test the GET /api/v1/orders endpoint with pagination"
```

Inside a `/run-qa` run, Perun routes each scenario to the right variant automatically — you only see `zmora` in the TUI label, the report, and any error messages. Calling the variants directly is an escape hatch for one-off checks.

## Architecture

### Variant-split registration

The plugin registers **two subagents** but presents them as **one logical agent**:

| Element | Type | Mode | Purpose |
|---|---|---|---|
| `zmora-fe` | Agent | `subagent` | FE variant — `allowed-tools` includes Playwright (`playwright_browser_*`, `Bash(playwright:*)`) plus the shared base. Composed at plugin init from `prompt-sections/core.md` + `prompt-sections/overlay-fe.md`. |
| `zmora-be` | Agent | `subagent` | BE variant — `allowed-tools` includes HTTP/DB CLIs (`Bash(curl:*)`, `Bash(psql:*)`, `Bash(mysql:*)`, `Bash(sqlite3:*)`, `Bash(mongosh:*)`, `Bash(redis-cli:*)`, `Bash(jq:*)`, etc.) plus the shared base. Composed from `core.md` + `overlay-be.md`. |
| `zmora` (logical) | — | — | Not a registration. The label Perun uses when dispatching, and the name that appears in every user-facing string (TUI, report, terminal error). Resolves to one of the two variants under the hood. |

The variants share their core prompt body (single-scenario execution loop, result format) and only differ in their per-stack overlay and `allowed-tools` list. The shared body lives at `src/modules/qa/prompt-sections/core.md`; per-stack overlays at `overlay-fe.md` / `overlay-be.md`. `src/modules/qa/prompt-builder.ts` composes them into the full markdown prompt at plugin init.

#### Why the split

OpenCode's plugin API requires each registered agent to declare a fixed `allowed-tools` list at registration time. Putting FE and BE behind one registration would force one shared allowlist — either the union of both stacks' tools (the BE scenario keeps Playwright access; the FE scenario keeps `psql` / `curl`) or nothing at all. Either choice removes the runtime tool-allowlist as a security boundary.

Splitting into two registrations preserves the boundary at the OpenCode runtime layer regardless of prompt content. A scenario whose body tries to exec a cross-stack tool (e.g. an FE-prefixed scenario attempting `curl https://attacker.tld`) fails at the allowlist check, not at a prompt-level guard. This also provides **defense in depth against Perun routing bugs:** if the prefix → variant routing in `perun.md` ever has a bug (e.g. an `FE-` scenario routed to `zmora-be`), the wrong variant simply lacks the requested tool and returns "tool not in allowlist" — the scenario fails safely as SKIP, never silently compromises.

### Per-scenario dispatch

| Element | Type | Description |
|---------|------|-------------|
| `/create-qa-plan` | Command | Generates structured test plans from PR descriptions or tickets |
| `/run-qa` | Command | Hands the plan to `@perun`, which extracts scenarios, builds the dependency graph, and dispatches one `zmora` task per scenario |
| `zmora` | Logical agent | Single-scenario executor. Two registered variants (`zmora-fe`, `zmora-be`) dispatched per-scenario; the logical name is what appears in the TUI, the report, and every error message. |
| `test-plan-format` | Skill | Rules for writing test plans with Given/When/Then, IDs, metadata, optional `**Depends-on:**` field |
| `report-format` | Skill | QA report structure with QA-XXX IDs, canonical code-review-compatible fields (ID, Location, Category, Problem, Impact, Remediation), `/fix` and `/fix-report` integration |
| `fe-testing` | Skill | Frontend testing patterns: Playwright CLI, selectors, assertions |
| `be-testing` | Skill | Backend testing patterns: HTTP requests, DB validation, curl |

Perun dispatches one task per `### FE-XX:` / `### BE-XX:` scenario block through `dispatch_parallel`. The dispatcher's 4-wide worker pool (concurrency hardcoded in `src/modules/coordinator/dispatch.ts`) caps in-flight scenarios; a 30-scenario plan drains through 4 workers concurrently. See [coordinator.md](./coordinator.md#dispatch_parallel-runtime-characteristics) for the pool's full contract.

## Plan format extensions

### Optional `**Depends-on:**` field

Plans use `## FE Test Scenarios` / `## BE Test Scenarios` headings with `### FE-XX:` / `### BE-XX:` blocks (existing format). One optional addition: a scenario may declare dependencies on other scenarios via a `**Depends-on:**` field placed directly under the heading.

Example:

```markdown
### BE-01: POST /api/users creates user
- **Area:** users endpoint
- **Method:** POST /api/users
- ...

### BE-02: PUT /api/users updates the user created in BE-01
**Depends-on:** BE-01
- **Area:** users endpoint
- ...

### BE-03: DELETE /api/users removes the user
**Depends-on:** BE-01, BE-02
- ...
```

Semantics:

- **Independent scenarios** (no `**Depends-on:**`) run as soon as a pool worker is free. This is the common case and the single-wave fast path — no dependency-graph machinery has any overhead.
- **Dependent scenarios** run only after every listed predecessor has reported back (any status — pass, fail, or skip).
- **Predecessor failure does NOT block dependents.** If `BE-01 create user` fails and `BE-02 update user` then sees 404, that's diagnostic data, not noise. Tests should surface errors, not skip silently.
- **Dependencies can cross stacks:** `**Depends-on:** FE-01` inside a `BE-` scenario is valid (e.g. FE creates the user via UI, BE asserts on the resulting DB state).
- **Hard errors at plan-parse time:** self-references (`**Depends-on:** BE-02` inside `BE-02`), cycles (`A → B → A`), and references to non-existent or sanitisation-dropped scenarios all abort the run with a clear error pointing at the offending scenario(s). `dispatch_parallel` is never called when the graph is invalid.
- **Opt-in.** Old plans without any `**Depends-on:**` annotation parse exactly as before and dispatch in a single wave. `/create-qa-plan` does not emit the field by default — generator stays "dumb"; authors annotate manually when they know two scenarios share state.

Perun computes dispatch waves by topological sort: Wave 0 = scenarios with no dependencies; Wave N+1 = scenarios whose every dependency was in some earlier wave. Each wave is one `dispatch_parallel` call; waves run sequentially, scenarios within a wave run through the 4-wide pool.

### Skill Frontmatter Format

Each skill is a markdown file with YAML frontmatter:

```yaml
---
name: skill-name
description: What the skill does
activation: When to load the skill
---
```

- **`name`** — Unique identifier used with `load_appverk_skill("skill-name")`
- **`description`** — Brief explanation of the skill's purpose
- **`activation`** — Rule for when the skill should be loaded (e.g., "Load when creating QA test plans")

## Setup and preflight

`/run-qa` performs a **preflight check** before dispatching any scenarios, and individual scenarios can pause the run mid-flight via `NEED_INFO` when a prerequisite turns out to be missing. Both mechanisms are driven by an optional `## Setup` block in the test plan.

### Credentials and secrets

Read this **before** your first `/run-qa`. The rules below are not optional — they apply to every run, every plan, and every reply during a `NEED_INFO` pause.

- **Put credentials in env vars, set them in the shell that launches OpenCode.** `export FOO=bar` (or `source .env`) in that shell, then start OpenCode from it. Both the preflight probe and every Zmora subagent read credentials only via `process.env` — never from `.env` files or other dotfiles at runtime.
- **Never paste credential values into chat.** Not in the initial request, not as a reply to a `NEED_INFO` pause, not "just to test something quickly". The conversation transcript is persistent and may be reviewed later — treat it like a logfile that anyone with access to your OpenCode history can read. Perun will not echo a pasted value back, but it cannot remove it from the transcript; the exposure has already happened.
- **If you change an env var, restart OpenCode.** Environment variables are captured at process start; running `export` after launch — even in OpenCode's own shell — does not update the running process's view. See [Why "restart OpenCode after env changes"](#why-restart-opencode-after-env-changes) for the full mechanics and the practical sequence.
- **Reply `resume` (or `abort`), not the value.** When a `NEED_INFO` pause asks for a missing credential, the correct response is to fix the env var in the shell, restart OpenCode, and reply `resume`. Replying with the value itself leaks it into the transcript and still won't satisfy preflight on the next attempt (the process snapshot is unchanged until restart).

If you do accidentally paste a secret, treat that credential as compromised: rotate it at the upstream service. The chat transcript cannot be redacted.

### The `## Setup` section in plans

`/create-qa-plan` emits a `## Setup` section after frontmatter and before the `## FE Test Scenarios` / `## BE Test Scenarios` blocks, declaring the env vars, services, and databases the run will need. You can also add or edit the section by hand.

```markdown
## Setup

**Required environment variables:**
- `TEST_USER_EMAIL` — login email for the test account
- `TEST_USER_PASSWORD` — login password for the test account

**Required services:**
- App at `http://localhost:3000`

**Required databases:**
- `postgresql://localhost:5432/myapp_test`
```

Rules:

- One backtick group per item: env var NAME, service URL, or DB DSN. DSNs must include an explicit scheme (`postgresql://…`, `mysql://…`, `redis://…`, `sqlite:///…`); schemeless forms are rejected by preflight.
- Free text after the backtick group is for the human reader; preflight ignores it.
- Omit the section entirely if a plan needs no prerequisites — preflight emits a "no Setup section, skipping" toast and the run proceeds as before.

### Preflight abort prompt

After parsing the plan, Perun pipes the declared prerequisites through `scripts/qa-preflight.sh`, which probes each env var, service, and DB. If any item is `MISSING`, **Perun aborts before any Zmora dispatch** and emits a prompt of the form:

```
⚠️ Cannot start QA — <N> prerequisite(s) missing:

Environment variables not set in OpenCode's process:
  • <NAME_1>
Services not reachable:
  • <URL> (<reason>)

To proceed:
  1. In the SAME shell that launches OpenCode, set the env vars:
     `export <NAME_1>=…` (or `source .env` in that shell before starting OpenCode)
  2. Start the missing services (e.g. `docker compose up -d`).
  3. RESTART OpenCode if it's already running — env changes don't propagate live.

Then re-run /run-qa.
```

This is not a bug — it means the plan declared a prerequisite the current process can't satisfy. Fix the gap and re-run `/run-qa` to retry; preflight runs again from scratch.

### Mid-run `NEED_INFO` pause

Preflight is a snapshot. A service that responded at preflight time may go down before its scenario runs, a credential may turn out to be expired, or a required CLI may be missing on `PATH` inside the Zmora subagent's allowlist. When a scenario detects such a runtime gap it returns status `NEED_INFO` (treated as `SKIP` for the report) with a structured payload classifying the gap by `kind`:

| `kind` | Meaning | `missing` payload |
|---|---|---|
| `credentials` | Required env var is empty, or the upstream rejects its value (e.g. expired API key → 401) | Env var NAMES (never values) |
| `service` | Upstream host is unreachable in a non-credential way: DNS failure, connection refused, persistent 5xx | Base URLs |
| `fixture` | Required test data (seed row, file, record) is missing from the DB or filesystem | Fixture keys (table/row IDs or fixture names) |
| `tool` | A required CLI binary is not on `PATH` | Binary names |

After each wave, if any scenario returned `NEED_INFO`, Perun **pauses the run** (no further waves dispatched) and prints a `⏸ Pausing QA` prompt summarising what passed, what failed, what's blocked, and what's not yet dispatched. The prompt invites you to:

1. Fix the missing items (set env vars, start services, install tools, seed fixtures), then **restart OpenCode**.
2. Reply `resume` (or `continue`, `go`, `try again`…) to continue from where the run stopped — Perun re-runs preflight, re-dispatches only the `NEED_INFO` and not-yet-started scenarios, and merges results with the wave(s) that already ran.
3. Reply `abort` (or `stop`, `cancel`…) to finalize the report immediately. Passing scenarios remain `PASS`, blocked ones report as `SKIP`.
4. Re-run `/run-qa` from scratch to discard all in-progress state and start over.

Ambiguous replies (`ok`, `cool`) trigger one clarifying question. Pasted credential values are never echoed back into chat.

### Why "restart OpenCode after env changes"

Both prompts insist on restarting OpenCode after setting env vars. The reason: **environment variables are captured at process start.** OpenCode reads its environment once when it launches; Perun and every Zmora subagent inherit that snapshot. Running `export FOO=bar` in another terminal — or even in OpenCode's own shell after launch — does not update the running process's view.

Practical sequence:

1. Stop OpenCode.
2. In the shell where you'll start OpenCode, either `export FOO=bar` directly or `source .env`.
3. Start OpenCode from that same shell.
4. Re-run `/run-qa` (or reply `resume` if you were mid-run).

If you change env vars and reply `resume` without restarting, preflight re-runs against the **old** process snapshot and will report the same `MISSING` items.

## Limitations

- **No cross-scenario data isolation.** Concurrent scenarios touching shared state (the same DB row, the same user account, the same uploaded file) can still race under the 4-wide pool even when neither declares the other in `**Depends-on:**`. The dependency mechanism gives plan authors a knob to serialise *known* dependencies (create → update → delete on the same entity), but does not auto-detect accidental shared state. Plan authors must still design with concurrency in mind; transactional sandboxes / per-scenario data prefixes are deferred to a future revision.
- **Pool starvation by a slow scenario.** If one scenario hits the 5-minute per-task timeout, that pool slot is blocked for 5 minutes. The other 3 workers keep draining, so total throughput drops 25% but doesn't halt.
- **Per-plan task cap.** `dispatch_parallel` rejects any single call with more than 50 tasks (per wave). A plan exceeding 50 scenarios in any single wave will be rejected — split it, or use `**Depends-on:**` to introduce additional waves so each wave stays under the cap.
- **Playwright tools:** The FE variant prioritises OpenCode's native `playwright_browser_*` tools. Falls back to the `playwright` bash CLI if native tools are unavailable.
- **Database CLI tools:** The BE variant attempts to use the project's native DB tool (`psql`, `mysql`, `sqlite3`, `mongosh`, `redis-cli`, etc.). If DB connection details are not in the test plan, it auto-detects them from `.env`, `.env.local`, `docker-compose.yml`, framework config files, and environment variables. It does not spin up test databases automatically.
- **Cross-plugin integration:** QA reports use QA-XXX IDs and are compatible with `/fix` and `/fix-report` commands from the code-review plugin.
- **Variant suffix may leak in `/agents`.** The `/agents` slash command lists every registered subagent, so users browsing the registry directly may see both `zmora-fe` and `zmora-be`. Their `description` fields say "internal variant of zmora" so the mapping back to the logical agent is explicit. Every other surface (Perun's TUI label, the report, error messages) shows only `zmora` — Perun's variant-suffix normalisation strips `-fe`/`-be` before display.
- **No CI integration:** Reports are local markdown files only. CI pipeline integration is planned.

## Project Structure

```
src/modules/qa/
├── index.ts                       # AppVerkQAPlugin factory — registers zmora-fe + zmora-be
├── prompt-builder.ts              # buildQATesterAgent(stack) → composes full prompt at plugin init
├── allowed-tools.ts               # SHARED_TOOLS, FE_TOOLS, BE_TOOLS constants
└── prompt-sections/
    ├── core.md                    # Shared single-scenario execution loop + result format
    ├── overlay-fe.md              # Playwright-specific instructions
    └── overlay-be.md              # HTTP/DB-specific instructions

src/commands/
├── create-qa-plan.md              # /create-qa-plan command template
└── run-qa.md                      # /run-qa command template

src/skills/qa/
├── test-plan-format/SKILL.md      # Test plan writing rules (incl. **Depends-on:**)
├── report-format/SKILL.md         # Report writing rules
├── fe-testing/SKILL.md            # Frontend testing patterns (Playwright)
└── be-testing/SKILL.md            # Backend testing patterns (HTTP + DB)

tests/modules/qa/                  # Vitest tests for plugin registration, builder output, routing
```

The variant prompts are built **in memory** by `prompt-builder.ts` at plugin init and never written to `dist/agents/`. The root build copies `prompt-sections/*.md` into `dist/modules/qa/prompt-sections/` so the builder can read them at runtime.
