---
name: test-plan-format
description: Test plan structure, naming conventions, edge case generation rules, and file saving conventions for QA test plans.
activation: Load when creating or formatting QA test plans
---

# Test Plan Format

## File Conventions

- **Location:** `docs/testing/plans/`
- **Naming:** `YYYY-MM-DD-<topic>-test-plan.md` where `<topic>` is a slugified summary (lowercase, hyphens, no spaces)
- **Create directory if needed:** `mkdir -p docs/testing/plans`

---

## Plan Structure

Every test plan MUST follow this exact structure. Plan metadata lives in YAML frontmatter (parsed by Perun Step 2 — `source`, `branch`, `base-url`, `detected-tools`). There is no separate `## Source` or `## Detected Tools` body section; that metadata is the frontmatter.

~~~markdown
---
source: <PR #N / branch <name> / last N commits / staged changes>
branch: <branch name>
base-url: <http(s)://host:port>
detected-tools: [<tool1>, <tool2>, ...]
---

# Test Plan: <title>

## Setup

Use Setup to declare prerequisites that QA's preflight check must pass before any scenario runs. Omit this section if the plan needs no env vars, services, or databases.

**Required environment variables:**
- `TEST_USER_EMAIL` — login email for test account
- `TEST_USER_PASSWORD` — login password

**Required services:**
- App at `http://localhost:3000`

**Required databases:**
- `postgresql://localhost:5432/myapp_test`

## Changes Summary

<Brief description of what changed and what needs testing. List affected areas.>

## FE Test Scenarios

### FE-01: <scenario name>

**Steps:**
1. <action>
2. <action>
3. <verification>

**Expected result:** <expected result>

**Edge cases:**
- <edge case 1>
- <edge case 2>

## BE Test Scenarios

### BE-01: <scenario name>

**Method:** <HTTP method> <full URL or path>
**Headers:** <required headers, e.g. Content-Type: application/json>
**Payload:**
```json
<JSON body>
```

**Expected response:** status <code>, <response body description>.

**DB Check:**
```sql
<SQL query>
```
<Expected state, e.g. "Expect `last_login_at` updated to within the last 60 seconds.">

**Edge cases:**
- <edge case with expected response>
~~~

### Frontmatter fields

| Field | Required | Notes |
|---|---|---|
| `source` | yes | Human-readable origin: PR number, branch, "last N commits", "staged changes", "example", etc. |
| `branch` | yes | Branch name; use `example` or `n/a` for hand-written reference plans. |
| `base-url` | yes (when scenarios target a live host) | Used by Perun to inject as an additional required service and as the dispatch `Base URL` for Zmora. Omit only for plans with no live target. |
| `detected-tools` | yes | YAML list of tool names actually present (e.g. `[playwright, curl, psql]`). Used to gate dependent scenarios. |

### Section omission and placement

- `## Setup` MUST appear after the page title and before the scenario sections — see `## Setup Rules` below for the full rule set.
- `## Changes Summary` may appear before or after `## Setup`; both placements are accepted by the parser.
- Scenario sections (`## FE Test Scenarios`, `## BE Test Scenarios`) are omitted when not applicable — see `## Section Omission Rules` below.

---

## Setup Rules

- **Placement.** `## Setup` MUST appear after the YAML frontmatter and page title, and before `## FE Test Scenarios` / `## BE Test Scenarios`. `## Changes Summary` may appear before or after `## Setup`. The parser is single-pass.
- **Soft cap.** ≤50 total prerequisites (env vars + services + databases combined). Plans exceeding this are rejected — split the plan or drop unused items.
- **DSN scheme is required.** Databases must use an explicit scheme: `postgresql://`, `mysql://`, `redis://`, `sqlite:///`. Schemeless forms are rejected.
- **sqlite DSNs must be project-relative (3 slashes); 4-slash absolute paths are rejected for safety.** SQLAlchemy's 4-slash form (`sqlite:////tmp/foo.db`) addresses an absolute filesystem path, which would let the preflight probe act as a file-existence oracle for arbitrary host paths (CWE-200). Use the 3-slash project-relative form (`sqlite:///var/test.db`) instead. Paths containing `..` are also rejected.
- **IPv6 hosts are not yet supported in DSNs; use an IPv4 address or hostname.**
- **Env var names.** Must match `^[A-Z_][A-Z0-9_]*$`. Bullets that fail the regex are ignored with a warning.
- **Omit when unused.** A plan with no prerequisites can omit the entire `## Setup` section.

---

## Bindings (dynamic credentials)

Use `**Bindings:**` inside `## Setup` to declare credentials or tokens that must be **minted at QA time** (e.g. short-lived auth tokens fetched from a login endpoint). Unlike `Required environment variables` — which the preflight check only probes for presence — bindings are produced by a sandboxed shell **recipe** run inside Perun's binding executor and then exposed to dependent scenarios.

A binding is a first-class member of `## Setup`, peer to `**Required environment variables:**`, `**Required services:**`, and `**Required databases:**`. Omit the subsection entirely when no bindings are needed.

### Markdown shape

~~~markdown
**Bindings:**
- `QA_BIND_NAME` (secret|plain) — description
  - Inputs: $VAR1, $VAR2
  - Egress: `https://api.example.com`
  - Recipe:
    ```bash
    curl -sf -X POST "$VAR1/auth/login" \
      -H "Content-Type: application/json" \
      --data "{\"email\":\"$VAR2\"}" | jq -er .token
    ```
~~~

Each binding block has exactly four members and they MUST appear in this order: the header line, then `Inputs:`, `Egress:`, and `Recipe:` (with a fenced ```bash``` block). The parser is strict about indentation — sub-fields are indented two spaces beneath the header bullet, and the recipe fence is indented four spaces.

### Field rules

- **Name pattern.** `QA_BIND_[A-Z][A-Z0-9_]*` — the `QA_BIND_` prefix is mandatory. Names that fail the regex cause `parse_plan` to abort with an error.
- **Type.**
  - `secret` — value is scrubbed from logs, reports, and any other artefact the QA run emits. Use for tokens, passwords, API keys.
  - `plain` — value is NOT scrubbed. Use only for non-sensitive derived values (e.g. a discovered resource ID).
- **Inputs.** Comma-separated `$VAR` references. Every `$VAR` that appears in the recipe MUST be declared here; the parser rejects the binding otherwise. Inputs may reference other bindings (`$QA_BIND_OTHER`) — this creates a Wave-0 dependency edge.
- **Egress.** A single host URL the recipe is allowed to talk to. Applies to `curl` (URL host), `psql`, and `sqlite3` (DSN host). The parser rejects any recipe command whose connection target host does not match this value.
- **Recipe.** A single shell statement inside a fenced ```bash``` block. See sandbox rules below.

### Recipe sandbox rules (summary)

The recipe is validated by `validateRecipe()` before it runs. Cross-check `src/modules/qa/binding-parser.ts` for the canonical list; the rules that matter at plan-authoring time are:

- **Single statement.** No `;`, `&&`, `||`, or newlines splitting commands. Pipes (`|`) are allowed — a pipeline is one statement.
- **Command allowlist.** Only `curl`, `psql`, `sqlite3`, `jq`, `grep`, `cut`, `head`, `tail`, `tr`, `printf`. Anything else (including `awk`, `sed`, `bash`, `sh`, `python`) is rejected outright.
- **No shell metaprogramming.** Forbidden: command substitution `$(...)`, backticks, heredocs/herestrings, process substitution `<(...) / >(...)`, `eval`, `source`, `export`, `unset`, `declare`/`local`/`readonly`/`set`, `function`, redirects to anywhere other than `/dev/null`, and trailing `&` backgrounding.
- **Egress host match.** Every `curl` URL host and every `psql`/`sqlite3` DSN host must equal the binding's `Egress:` host.
- **File-reader path confinement.** `grep`, `cut`, `head`, `tail`, `tr` may only read `./` relative paths, `-` (stdin), `/dev/null`, `/dev/stdin`, or `/dev/zero`. Absolute paths anywhere else (e.g. `/etc/passwd`) are rejected.
- **sqlite3 dot-command restrictions.** `.read`, `.shell`, `.system`, `.import`, `.save`, `.output`, `.log` are forbidden — they escape SQL into shell or read arbitrary files.
- **16 KiB cap.** The recipe body (after line-continuation collapse) must be ≤16 384 bytes.

### Wave-0 synthesis (Perun's responsibility)

You — the plan author — only write the declarative binding block. Perun synthesises one `### SETUP-<NN>: Provision QA_BIND_<NAME>` scenario per binding during Step 3.6 of its workflow (see `src/agents/perun.md`). These SETUP-* scenarios:

- Are inserted into the scenario list BEFORE wave computation, so they typically land in Wave 0.
- Inherit `Depends-on:` from any `Inputs:` that are themselves `QA_BIND_*` names — transitive bindings chain correctly.
- Have a one-line body that invokes `execute_recipe({ binding_name: "QA_BIND_<NAME>" })`.

Do NOT hand-author `### SETUP-XX:` scenarios in your plan — they are generated, not authored.

---

## Scenario Naming

- FE scenarios: `FE-01`, `FE-02`, ... `FE-NN` (zero-padded two digits)
- BE scenarios: `BE-01`, `BE-02`, ... `BE-NN` (zero-padded two digits)
- Numbering is sequential within each section, starting from 01

---

## Edge Case Generation Rules

For EVERY scenario, consider and include relevant edge cases from:

### Input boundaries
- Empty/null/missing values
- Maximum length strings
- Special characters (unicode, HTML entities, SQL metacharacters)
- Negative numbers, zero, boundary values (MAX_INT)

### Authentication & Authorization
- Unauthenticated request (no token)
- Expired token
- Valid token but insufficient permissions
- Another user's resource (IDOR)

### State
- Resource does not exist (404)
- Duplicate creation attempt (409)
- Concurrent modifications (race conditions)
- Resource in unexpected state (e.g., already deleted, already processed)

### Data integrity
- Required fields missing (422)
- Invalid data types (string where number expected)
- Referential integrity (foreign key does not exist)

### FE-specific
- Slow/no network connection
- Empty state (no data to display)
- Very long content (overflow, truncation)
- User not logged in
- Browser back/forward during operation

---

## Section Omission Rules

- If changes are **FE-only**: omit the `## BE Test Scenarios` section entirely
- If changes are **BE-only**: omit the `## FE Test Scenarios` section entirely
- If a tool is **unavailable**: omit it from the frontmatter `detected-tools` list and mark dependent scenarios with `(skip — <tool> unavailable)` in the scenario name

---

## Dependency annotations (opt-in)

Scenarios may declare dependencies on other scenarios via an optional `**Depends-on:**` field directly beneath the heading. Listed scenarios run to completion (any status — pass/fail/skip) before this scenario starts.

Example:

~~~markdown
### BE-02: PUT /api/users updates the user created in BE-01

**Depends-on:** BE-01

**Method:** PUT /api/users/<id>
...
~~~

Rules:

- Reference scenarios by their full ID (`FE-01`, `BE-02`). Multiple IDs are comma-separated.
- Cross-stack deps are allowed: `BE-02 **Depends-on:** FE-01`.
- No self-references, no cycles, no dangling refs (the run aborts at plan-parse time if any is detected).
- Predecessor failure does NOT block dependents. A dependent surfaces a diagnostic failure rather than skipping silently — better signal-to-noise than auto-skip cascades.

This field is **opt-in**. Plans without `**Depends-on:**` dispatch fully in parallel (subject to the 4-worker pool throttle).

---

## Plan Quality Checklist

Before saving the plan, verify:

- [ ] Every scenario has at least 2 edge cases
- [ ] Every BE scenario has an expected status code
- [ ] Every FE scenario has concrete steps (not "test the form")
- [ ] DB Checks use actual table/column names from the codebase
- [ ] API paths match actual routes from the codebase
- [ ] No placeholder text (TBD, TODO, fill in later)
- [ ] `**Depends-on:**` fields, if present, reference existing scenario IDs without cycles
- [ ] Binding format: every `**Bindings:**` entry uses a `QA_BIND_*` name with `(secret|plain)` type, declares `Inputs:` for every `$VAR` referenced by the recipe, sets an `Egress:` host, and the fenced ```bash``` recipe is a single statement using only allowlisted commands
