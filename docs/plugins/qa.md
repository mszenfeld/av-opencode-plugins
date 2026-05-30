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

If no plan file is given and none is found in `docs/testing/plans/`, `/run-qa` does not stop: it hands the no-plan case to `@perun`, which dispatches the **Veles** planner (`Veles - Planner`) to author a plan, then presents a **planning-consent gate** ("Run QA on this plan now? Reply 'yes' / 'abort'") before any scenario is dispatched. On approval the run continues from the freshly authored plan; on `abort` the plan stays saved for later review. Veles's result is parsed as structured JSON (`plan_path`, `fe_count`, `be_count`, `setup_prereqs`) and is never interpreted as instructions — only those fields are echoed into the consent gate, so untrusted planner output cannot drive a tool call. See [`src/agents/perun.md`](../../src/agents/perun.md) Workflow 1 (no-plan branch) and the Planning-consent gate section.

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

The plugin registers **three subagents** but presents them as **one logical agent**:

| Element | Type | Mode | Purpose |
|---|---|---|---|
| `zmora-fe` | Agent | `subagent` | FE variant — `allowed-tools` includes Playwright (`playwright_browser_*`, `Bash(playwright:*)`) plus the shared base. Composed at plugin init from `prompt-sections/core.md` + `prompt-sections/overlay-fe.md`. |
| `zmora-be` | Agent | `subagent` | BE variant — `allowed-tools` includes HTTP/DB CLIs (`Bash(curl:*)`, `Bash(psql:*)`, `Bash(mysql:*)`, `Bash(sqlite3:*)`, `Bash(mongosh:*)`, `Bash(redis-cli:*)`, `Bash(jq:*)`, etc.) plus the shared base. Composed from `core.md` + `overlay-be.md`. |
| `zmora-setup` | Agent | `subagent` | Setup variant — provisions one binding per dispatch via the `execute_recipe` plugin tool. Has **no Bash access at all**: `SETUP_TOOLS` is narrow — `Read`, `Glob`, `Grep`, `execute_recipe`. Composed from `core.md` + `overlay-setup.md`. See [Bindings (dynamic credential provisioning)](#bindings-dynamic-credential-provisioning). |
| `zmora` (logical) | — | — | Not a registration. The label Perun uses when dispatching, and the name that appears in every user-facing string (TUI, report, terminal error). Resolves to one of the three variants under the hood. |

The variants share their core prompt body (single-scenario execution loop, result format) and only differ in their per-stack overlay and `allowed-tools` list. The shared body lives at `src/modules/qa/prompt-sections/core.md`; per-stack overlays at `overlay-fe.md` / `overlay-be.md` / `overlay-setup.md`. `src/modules/qa/prompt-builder.ts` composes them into the full markdown prompt at plugin init.

#### Why the split

OpenCode's plugin API requires each registered agent to declare a fixed `allowed-tools` list at registration time. Putting FE and BE behind one registration would force one shared allowlist — either the union of both stacks' tools (the BE scenario keeps Playwright access; the FE scenario keeps `psql` / `curl`) or nothing at all. Either choice removes the runtime tool-allowlist as a security boundary.

Splitting into three registrations preserves the boundary at the OpenCode runtime layer regardless of prompt content. A scenario whose body tries to exec a cross-stack tool (e.g. an FE-prefixed scenario attempting `curl https://attacker.tld`) fails at the allowlist check, not at a prompt-level guard. This also provides **defense in depth against Perun routing bugs:** if the prefix → variant routing in `perun.md` ever has a bug (e.g. an `FE-` scenario routed to `zmora-be`), the wrong variant simply lacks the requested tool and returns "tool not in allowlist" — the scenario fails safely as SKIP, never silently compromises. The setup variant takes the same defense further: `zmora-setup` cannot exec Bash at all, so even a prompt-injection that flips it into "attacker mode" has no actuator beyond `execute_recipe` (whose AST is parser-enforced).

The plugin also registers three Perun-only tools (`execute_recipe`, `record_input`, `parse_plan`) that gate the credential-provisioning workflow described in [Bindings (dynamic credential provisioning)](#bindings-dynamic-credential-provisioning). The tool-availability matrix is enforced per-variant in `AgentConfig.tools`: `execute_recipe` is enabled only on `zmora-setup`; `record_input` and `parse_plan` are disabled on every zmora variant and enabled only in Perun's frontmatter.

### Per-scenario dispatch

| Element | Type | Description |
|---------|------|-------------|
| `/create-qa-plan` | Command | Thin wrapper over the `qa-plan-authoring` skill — sets up progress tasks, delegates authoring, then proposes `/run-qa` as the next step |
| `/run-qa` | Command | Hands the plan to `@perun`, which extracts scenarios, builds the dependency graph, and dispatches one `zmora` task per scenario |
| `zmora` | Logical agent | Single-scenario executor. Two registered variants (`zmora-fe`, `zmora-be`) dispatched per-scenario; the logical name is what appears in the TUI, the report, and every error message. |
| `qa-plan-authoring` | Skill | Shared plan-authoring engine used by both `/create-qa-plan` and Veles: resolves the diff source, classifies FE/BE, gathers context, detects tools, infers the `## Setup` section, generates FE/BE scenarios, and saves the plan |
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

## Bindings (dynamic credential provisioning)

Some QA runs need credentials that are **not** already in the host environment — for example, a short-lived OAuth token that has to be minted from `client_id`/`client_secret`, a JWT signed locally from a static private key, or a row primary key freshly inserted into a seed table. Hard-coding these in the user's shell is awkward (they expire, they're stack-specific, they're inputs for other secrets). The QA plugin solves this with **bindings**: declarative, plan-resident "how to obtain this value" specs that the plugin executes in a sandboxed recipe runner and exposes to dispatched zmora subagents via the `shell.env` hook — never via the LLM context.

A binding has two parts: a **declarative spec** in the plan (name, type, recipe, inputs, egress host), and a **lifecycle** managed entirely in-process by the plugin (mint via `execute_recipe`, store in `BindingsStore`, expose via `shell.env`, scrub via the snapshot scrubber, expire via the TTL sweep). Values never appear in the conversation transcript and never persist on disk.

### Plan-format extension: the `**Bindings:**` subsection

Inside the existing `## Setup` section, plans may add a `**Bindings:**` subsection listing each minted value. Each binding is a top-level list item with four indented sub-fields. Field order is fixed.

```markdown
## Setup

**Required environment variables:**
- `OAUTH_CLIENT_ID` — public OAuth client identifier
- `OAUTH_CLIENT_SECRET` — OAuth client secret

**Bindings:**
- `QA_BIND_TOKEN` (secret) — Short-lived bearer token minted from client credentials
    - Inputs: $OAUTH_CLIENT_ID, $OAUTH_CLIENT_SECRET
    - Egress: `https://auth.example.com`
    - Recipe:
        ```bash
        curl -sf -X POST -u "$OAUTH_CLIENT_ID:$OAUTH_CLIENT_SECRET" https://auth.example.com/oauth/token | jq -r '.access_token'
        ```
```

The five fields per binding:

| Field | Purpose |
|---|---|
| **Name** | Must match `^QA_BIND_[A-Z][A-Z0-9_]*$`. The `QA_BIND_` prefix is mandatory and reserved — it identifies plan-minted values throughout the system (registry, scrubber, denylist exemption). |
| **Type** | `secret` or `plain`. Secrets are scrubbed from any output that propagates back through the plugin (zmora stderr, recipe stderr tail, error messages). Plain values are exposed but not scrubbed. |
| **Description** | Free text after the em-dash. Documentation only — the plugin ignores it. |
| **Inputs** | Comma-separated list of `$NAME` references. Resolved from (1) prior bindings (so binding B can reference `$QA_BIND_A`), then (2) host env vars at recipe-run time. Every `$VAR` referenced in the recipe MUST be declared here; un-declared references are a hard parse error. |
| **Egress** | The single host the recipe is permitted to connect to. Enforced against `curl` URLs and against `psql`/`sqlite3` DSN positional arguments. Cross-host calls are rejected by the recipe parser before any bash is exec'd. |
| **Recipe** | A fenced ` ```bash ` block containing exactly one statement. The recipe runs in a hermetic child env (see [Recipe sandbox rules](#recipe-sandbox-rules) below). Its stdout becomes the binding value; stderr is captured for failure diagnostics. |

Perun's `parse_plan` tool extracts these into the plugin's per-run state (`QaRunState`) and stores the parsed recipe ASTs. The binding VALUES are never produced at parse time — only later, by `execute_recipe`, dispatched against a `zmora-setup` subagent.

### Recipe sandbox rules

Recipes run in a sandboxed bash child whose env is built by `buildChildEnv` (`src/modules/qa/child-env.ts`) — only an allowlisted subset of host env vars (`PATH`, `HOME`, locale) passes through, plus the binding's declared `Inputs` and prior bindings. The host's `process.env` is NOT inherited; cloud credentials, kubeconfig paths, API keys all remain invisible to the recipe even if it escapes the AST parser.

Each recipe is validated by `validateRecipe()` in `src/modules/qa/binding-parser.ts` BEFORE bash is ever spawned. The validator enforces:

| Rule | Detail |
|---|---|
| **Single statement only** | The recipe must be one statement. Splitting on unquoted `;`, `\n`, `&&`, `\|\|` produces exactly one segment. Multi-statement recipes are rejected at parse time. |
| **Bash operator allowlist** | Pipe (`\|`) is allowed between commands. Forbidden constructs: `$(…)` command substitution, backticks, heredocs (`<<EOF`), herestrings (`<<<`), process substitution (`<(…)`/`>(…)`), `eval`, `source`/`.`, `export`, `unset`, `declare`/`local`/`readonly`/`set`, `function`, background (`&`), and redirects to anything other than `/dev/null`. |
| **Command allowlist** | Only these commands may appear as the first word of a pipeline stage: `curl`, `psql`, `sqlite3`, `jq`, `grep`, `cut`, `head`, `tail`, `tr`, `printf`. **`awk` and `sed` are intentionally NOT in the allowlist** — both expose shell-exec primitives (`awk 'BEGIN{system(…)}'`, `sed 'e cmd'` / `sed '… W file'`) that the regex-based validator cannot reliably constrain (removed in COMP-002). Use `jq`, `cut`, `grep` for the same text-shaping needs. |
| **Egress host match** | Every `curl` URL argument's host must equal the binding's declared `Egress` host. The same check applies to `psql` and `sqlite3` DSN arguments (SEC-004) — otherwise a recipe could connect to an attacker-controlled DSN and exfil via SQL. |
| **Sqlite3 dot-command rejection** | Any token starting with `.read`, `.shell`, `.system`, `.import`, `.save`, `.output`, `.log` is rejected — these escape SQL into shell or read arbitrary files (SEC-004). |
| **File-reader path confinement** | Arguments to `grep`/`cut`/`head`/`tail`/`tr` may be `-`, `/dev/null`, `/dev/stdin`, `/dev/zero`, a `./` relative path, or a `$VAR` expansion. Any other absolute path (e.g. `tail /etc/passwd`) is rejected (SEC-005). |
| **Curl flag denylist** | `curl` may not use `-T`/`--upload-file`, `-F @file`/`--form @file`, `-d @file`, `--config`/`-K`, `--cookie-jar`/`-c`, `--dump-header`/`-D` to non-`/dev/null`, `--output`/`-o` to non-`/dev/null`, `-O`/`-J`, `--next`, `--url`, and `--trace*` (SEC-002 — chained requests bypass URL extraction; output/upload flags exfil files). |
| **Recipe length cap** | Recipes longer than 16 KiB are rejected up-front. The validator runs a regex pipeline; an adversarial multi-kilobyte input could push worst-case backtracking into seconds (SEC-008). 16 KiB is roughly 4× the largest legitimate recipe observed in practice. |

When `execute_recipe` runs a recipe, the resulting binding is stored in `BindingsStore` as a `Secret` (the `Secret` wrapper in `src/modules/qa/secret.ts` redacts its value from `toString`/`util.inspect`/`JSON.stringify`). The minted value is never returned to the LLM — `execute_recipe` only ever returns the enums `{status: "ok"}`, `{status: "need_info", missing: […]}`, `{status: "recipe_failed", reason, stderr_tail}`, or `{status: "unknown_binding"}`. The actual value reaches dispatched zmora subagents through the `shell.env` hook in `src/modules/qa/shell-env-hook.ts`, which injects bindings into the bash env of the right child session.

### The `zmora-setup` variant

`zmora-setup` is the third registered subagent. It is the only variant with `execute_recipe` enabled. It has a deliberately narrow `allowed-tools` list:

```ts
SETUP_TOOLS = ["Read", "Glob", "Grep", "execute_recipe"]
```

Notice: **no Bash whatsoever**. The setup variant cannot exec `curl`, `psql`, or any shell command — `execute_recipe` is its only actuator. `Read`/`Glob`/`Grep` are permitted so it can inspect project context when diagnosing recipe failures, but not to execute anything. Read/Glob/Grep are read-only from the project tree; they cannot reach the bindings store, the recipe sandbox, or the host env.

The setup variant runs one binding per dispatched task. Perun dispatches `zmora-setup` once per binding (typically in a Wave 0 burst before the FE/BE waves). The task prompt names the binding (`QA_BIND_TOKEN`), and the variant's overlay tells it to call `execute_recipe({binding_name: "QA_BIND_TOKEN"})` exactly once and then stop — no `curl` verification, no echoing the value, no speculation.

### Conversational mid-run dialog

When a recipe needs inputs that are not yet available (host env vars missing, prior bindings not yet minted), `execute_recipe` returns `{status: "need_info", missing: ["INPUT1", "INPUT2"]}`. The setup variant surfaces this as a structured payload to Perun:

```json
{"status": "NEED_INFO", "kind": "binding_input", "binding": "QA_BIND_TOKEN", "missing": ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET"]}
```

The `binding_input` `kind` is a new entry alongside the existing `credentials`/`service`/`fixture`/`tool` kinds in the [Mid-run `NEED_INFO` pause](#mid-run-need_info-pause) table. Perun handles it through the **conversational mid-run dialog**:

1. **Round-based retry.** Up to **3 rounds per QA run** (bounded retry). On the 3rd unresolved round, Perun auto-aborts with `"Setup unresolved after 3 rounds. Aborting. Last unresolved bindings: NAME1, NAME2."`.
2. **`NAME=value` paste protocol.** Perun's mid-run prompt invites the user to either set env vars in the shell + restart OpenCode + reply `resume` (recommended for secrets), OR paste `NAME=value` pairs directly in chat (acceptable for non-secret inputs like emails or row IDs). Any line matching `^[ \t]*[A-Z_][A-Z0-9_]*[ \t]*=[ \t]*.+[ \t]*$` is parsed; each pair is routed through `record_input({name, value})`. Perun echoes back NAME and value LENGTH only, never the value itself.
3. **Recipe-failed branch.** If `execute_recipe` returns `{status: "recipe_failed", reason, stderr_tail}`, the setup variant surfaces a structured `RECIPE_FAILED` payload; Perun emits a recipe-failed mid-run prompt that includes the (already scrubbed) stderr tail and suggests verifying the inputs or service reachability. After 3 failed attempts the binding is marked unresolved and dependent BE/FE scenarios are SKIPped for the run.

See [Mid-run `NEED_INFO` pause](#mid-run-need_info-pause) for the round-1 prompt template; the binding-specific extensions live in `prompt-sections/overlay-setup.md` and the dialog logic in `src/agents/perun.md` Step 3.6 (`parse_plan`) and Section "Mid-run prompt template (round <i>/3)".

### Resource caps and lifecycle

The plugin enforces hard caps on the bindings store (`src/modules/qa/bindings-store.ts`):

| Limit | Value | Purpose |
|---|---|---|
| Per-parent cap | **32 bindings** per parent session | Bounds the per-run state size; rejects further writes once reached. |
| Global cap | **256 bindings** across all parents | Process-wide ceiling so a runaway plan can't exhaust memory. |
| Value size cap | **4 KiB per value** | Bounds individual entry size; rejects anything larger at write time. Also forbids embedded control bytes (anywhere other than a single trailing newline) to keep header/JSON-payload framing intact. |
| TTL | **1 hour** since last write | A periodic sweep (every 5 minutes) purges entries past TTL — but ONLY when they are not pinned by an in-flight `dispatch_parallel` wave (pin/release is wave-scoped). |

**Name denylist.** User-pasted inputs (`record_input`) are rejected if the name is in the process-control denylist (`PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, `IFS`, `BASH_ENV`, `HOME`, `SSH_AUTH_SOCK`, …) or starts with a well-known credential prefix (`AWS_`, `GCP_`, `GITHUB_`, `ANTHROPIC_`, `OPENAI_`, `DATABASE_`, `OP_`, `VAULT_`, `K8S_`, `KUBE`, …). The full denylist lives in `bindings-store.ts`. Minted recipe bindings (the `QA_BIND_` prefix) are exempt from this denylist — only user-paste names are checked. This prevents a malicious plan from prompting the user to paste under a plausible-looking name like `AWS_ACCESS_KEY_ID` and silently exfil to an attacker-controlled egress host.

**Snapshot pin/release.** Every `dispatch_parallel` wave pins a `BindingSnapshot` for the duration of the wave; the scrubber operates against that snapshot, not the live store. This protects scrubbing from interleaving with concurrent `execute_recipe` writes or `clearParent` purges that would otherwise reveal a newly-minted secret in the moment between write and the next scrub (ARCH-004 / CWE-362). The coordinator releases the snapshot in a `finally` after the wave completes, letting `sweepExpired` and `clearParent` reclaim the entries.

**Cleanup on session deletion.** On `session.deleted` events for the parent (Perun) session, `BindingsStore.clearParent` purges every non-pinned entry for that parent. Pinned entries (those an in-flight reader still holds via snapshot) are preserved so the scrubber doesn't lose its backing entries mid-scrub (CWE-672). The TTL sweep eventually reclaims pinned entries once the wave releases them.

## Setup and preflight

`/run-qa` performs a **preflight check** before dispatching any scenarios, and individual scenarios can pause the run mid-flight via `NEED_INFO` when a prerequisite turns out to be missing. Both mechanisms are driven by an optional `## Setup` block in the test plan.

### Credentials and secrets

Read this **before** your first `/run-qa`. The rules below are not optional — they apply to every run, every plan, and every reply during a `NEED_INFO` pause.

When a mid-run `NEED_INFO` pause asks for a missing input, you have three ways to supply it. **Prefer the first two for any true secret** (passwords, API keys, bearer tokens, signing keys). The chat-paste fallback is for low-sensitivity inputs only (emails, row IDs, public usernames).

1. **Safest — `export` + restart + `resume`.** In the shell that launches OpenCode, run `export NAME=value` (or `source .env`), restart OpenCode, then reply `resume` in chat. The preflight probe and every Zmora subagent read credentials only via `process.env` — values never enter the conversation transcript. Environment variables are captured at process start, so the restart is mandatory; `export` inside a running OpenCode shell does not update the running process's view. See [Why "restart OpenCode after env changes"](#why-restart-opencode-after-env-changes) for the full mechanics.
2. **Safer — provide via a `**Bindings:**` recipe.** If the value is mintable from inputs you already have (an OAuth token from `client_id`/`client_secret`, a signed JWT, a freshly-inserted seed-row ID), declare it as a `QA_BIND_*` entry in the plan's `## Setup` section. The plugin executes the recipe in a sandboxed runner, stores the result in `BindingsStore`, and exposes it to Zmora subagents through the `shell.env` hook. The value is minted server-side and is **never** part of the LLM context or the chat transcript. See [Bindings (dynamic credential provisioning)](#bindings-dynamic-credential-provisioning).
3. **Fallback — paste `NAME=value` in chat (non-secrets only).** When a recipe needs a binding input that is genuinely non-sensitive (a test email, a public ID), you may reply with one `NAME=value` pair per line. Perun routes each line through `record_input({name, value})` and echoes back NAME and value LENGTH only — never the value itself. The snapshot scrubber strips the value from any specialist output that propagates back through the plugin. **However, the value DOES persist in the chat transcript** (this is a hard limit of the OpenCode UI — the transcript cannot be redacted after the fact). Treat the transcript like a logfile that anyone with access to your OpenCode history can read.

If you do accidentally paste a secret — anywhere, not just in a `NEED_INFO` reply — treat that credential as compromised: rotate it at the upstream service. Perun's safe-handling rule means it will not echo the value back, but it has no way to remove it from the transcript.

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
- **Per-call task cap of 4.** `dispatch_parallel` rejects any single call with more than 4 tasks. Perun chunks waves of >4 scenarios into multiple sequential calls of ≤4 tasks each. Wall-clock for large waves grows because chunks do not pipeline (chunk N+1 starts only after every task in chunk N returns) — the cap intentionally matches the worker pool size so the `×N` label always reflects realised concurrency. For waves with widely-varying task durations, prefer splitting via `**Depends-on:**` so the user can reason about ordering, or reduce the scenario count.
- **Playwright tools:** The FE variant prioritises OpenCode's native `playwright_browser_*` tools. Falls back to the `playwright` bash CLI if native tools are unavailable.
- **Database CLI tools:** The BE variant attempts to use the project's native DB tool (`psql`, `mysql`, `sqlite3`, `mongosh`, `redis-cli`, etc.). Connection details come from one of two sources, in priority order: (1) a **Bindings** recipe referenced from the plan frontmatter — Perun's strict orchestrator resolves it via `execute_recipe` before the scenario runs and injects the result as redacted env vars into the Zmora child process; or (2) an explicit DSN / env-var name listed in the plan frontmatter that is already present in OpenCode's process environment. The BE variant **never** reads `.env`, `.env.local`, `docker-compose.yml`, or any framework config file on its own — that contradicts the strict-orchestrator rule that secrets only enter via approved Bindings. It also does not spin up test databases automatically.
- **Cross-plugin integration:** QA reports use QA-XXX IDs and are compatible with `/fix` and `/fix-report` commands from the code-review plugin.
- **Variant suffix may leak in `/agents`.** The `/agents` slash command lists every registered subagent, so users browsing the registry directly may see `zmora-fe`, `zmora-be`, and `zmora-setup`. Their `description` fields say "internal variant of zmora" so the mapping back to the logical agent is explicit. Every other surface (Perun's TUI label, the report, error messages) shows only `zmora` — Perun's variant-suffix normalisation strips `-fe`/`-be`/`-setup` before display.
- **No CI integration:** Reports are local markdown files only. CI pipeline integration is planned.

## Project Structure

```
src/modules/qa/
├── index.ts                       # AppVerkQAPlugin factory — registers zmora-fe / zmora-be / zmora-setup; wires bindings hooks
├── prompt-builder.ts              # buildQATesterAgent(stack) → composes full prompt at plugin init
├── allowed-tools.ts               # SHARED_TOOLS, FE_TOOLS, BE_TOOLS, SETUP_TOOLS constants
├── secret.ts                      # Secret value-object: opaque wrapper that never serialises into logs / reports
├── bindings-store.ts              # In-memory bindings store keyed by parent session ID; TTL sweep + per-parent / global caps
├── binding-parser.ts              # Parses **Bindings:** frontmatter blocks from QA test plans into typed recipe descriptors
├── qa-run-state.ts                # Per-run state (current wave, scenarios in flight, NEED_INFO ledger) used by Perun
├── scrubber.ts                    # Redacts known Secret values from text before it reaches logs / chat / reports
├── record-input.ts                # Records user-pasted NAME=value inputs into the BindingsStore during the mid-run dialog; validates name denylist + charset
├── execute-recipe.ts              # Strict-orchestrator entry point: runs one Binding recipe in the sandbox and returns ONLY an enum status (ok / need_info / recipe_failed / unknown_binding) — never the minted value or env
├── shell-env-hook.ts              # `shell.env` hook that injects resolved bindings into the correct Zmora child session's bash env (keyed by session); does not scrub the inherited env
├── child-env.ts                   # Helpers that compute the exact env snapshot handed to each Zmora subagent
└── prompt-sections/
    ├── core.md                    # Shared single-scenario execution loop + result format
    ├── overlay-fe.md              # Playwright-specific instructions
    ├── overlay-be.md              # HTTP/DB-specific instructions
    └── overlay-setup.md           # zmora-setup variant: runs Binding recipes only, no test execution

src/modules/_shared/               # Sibling modules reused by both qa and perun
├── dispatch-extensions.ts         # Write-once cross-module registry the QA plugin populates (sessionAgentRegistry + scrubberFactory); the coordinator reads it at dispatch time (timeout/merging live in coordinator's dispatch.ts/poller.ts)
├── session-agent-registry.ts      # Maps `childSessionID → agent name` so the `shell.env` hook can resolve agent identity per session
└── load-asset.ts                  # Loads prompt fragments / templates from the built `dist/` tree at runtime

src/commands/
├── create-qa-plan.md              # /create-qa-plan command template
└── run-qa.md                      # /run-qa command template

src/skills/qa/
├── qa-plan-authoring/SKILL.md     # Shared plan-authoring engine (diff → scenarios → saved plan); used by /create-qa-plan and Veles
├── test-plan-format/SKILL.md      # Test plan writing rules (incl. **Depends-on:** and **Bindings:**)
├── report-format/SKILL.md         # Report writing rules
├── fe-testing/SKILL.md            # Frontend testing patterns (Playwright)
└── be-testing/SKILL.md            # Backend testing patterns (HTTP + DB)

tests/modules/qa/                  # Vitest tests for plugin registration, builder output, routing, bindings flow
```

The variant prompts are built **in memory** by `prompt-builder.ts` at plugin init and never written to `dist/agents/`. The root build copies `prompt-sections/*.md` into `dist/modules/qa/prompt-sections/` so the builder can read them at runtime.
