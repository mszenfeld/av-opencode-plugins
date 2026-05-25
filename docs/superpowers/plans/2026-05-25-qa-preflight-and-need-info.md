# QA Preflight + `need_info` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent silent QA-run failures caused by missing setup (env vars, services, databases) by adding (a) a `## Setup` contract to plans, (b) a Perun preflight step that aborts dispatch before any wave runs, and (c) a `need_info` exit status that Zmora returns when a scenario hits an undeclared gap, so Perun can pause + resume cleanly.

**Architecture:** Prompt-driven change with one new shell script. No new TypeScript modules. Zmora's overlay prompts gain pre-flight env/tool checks and emit a structured `NEED_INFO` payload as their result; Perun's prompt gains a Step 3.5 preflight block that invokes `scripts/qa-preflight.sh` (the only narrow-allow-listed addition to Perun's bash surface), and a Step 6 extension that recognises `NEED_INFO` payloads, prints a status snapshot to the user, and resumes on the next turn by re-dispatching only the blocked scenarios. The Zmora `NEED_INFO` payload is delivered as the `result` field of a wave-status-`success` task, so `src/modules/coordinator/dispatch.ts` is unchanged.

**Tech Stack:** Markdown prompts (`src/agents/perun.md`, `src/modules/qa/prompt-sections/*.md`), markdown command (`src/commands/create-qa-plan.md`), a single shell script (`scripts/qa-preflight.sh`) that wraps curl / pg_isready / mysqladmin / redis-cli / printenv probes. Vitest for two test suites: (a) the script's behaviour, (b) a regression guard on dispatch.ts payload passthrough.

**Source spec:** [`docs/superpowers/specs/2026-05-25-qa-preflight-and-need-info-design.md`](../specs/2026-05-25-qa-preflight-and-need-info-design.md)

---

## Task 1: Add `need_info` to Zmora core contract

**Files:**
- Modify: `src/modules/qa/prompt-sections/core.md` (Result format section, lines 27-30)

- [ ] **Step 1: Open the file and find the Result format section**

Read `src/modules/qa/prompt-sections/core.md` lines 27-30. Confirm the current text matches:

```
## Result format

Return ONE scenario result in the format specified by the loaded skill (see `fe-testing` or `be-testing` skill for the exact template). Status values: `PASS`, `FAIL`, `SKIP`.
```

- [ ] **Step 2: Replace the Result format section with the extended contract**

Use Edit. `old_string`:

```
## Result format

Return ONE scenario result in the format specified by the loaded skill (see `fe-testing` or `be-testing` skill for the exact template). Status values: `PASS`, `FAIL`, `SKIP`.
```

`new_string`:

```
## Result format

Return ONE scenario result in the format specified by the loaded skill (see `fe-testing` or `be-testing` skill for the exact template). Status values: `PASS`, `FAIL`, `SKIP`, `NEED_INFO`.

## `NEED_INFO` payload

Return `NEED_INFO` instead of `FAIL` when the scenario cannot run because a declared prerequisite is missing at runtime — typically an env var that the plan's `## Setup` section lists as required but which is empty in the current process. This signals Perun to pause the QA run and ask the user for setup, rather than emit a misleading FAIL.

When you return `NEED_INFO`, the wave-level task status is still `success` (the work succeeded — it correctly detected the gap). Your structured JSON payload carries the detail:

```json
{
  "status": "NEED_INFO",
  "scenario": "BE-03",
  "kind": "credentials" | "service" | "fixture" | "tool",
  "missing": ["STRIPE_TEST_KEY"],
  "hint": "Set STRIPE_TEST_KEY in OpenCode's process env (in the shell that launches OpenCode), then restart OpenCode and reply 'resume'."
}
```

- `kind` classifies the gap. `credentials` = env var. `service` = HTTP endpoint not reachable. `fixture` = test data missing in DB. `tool` = required CLI not on PATH.
- `missing` is the list of identifiers (env var names, URLs, tool names, etc.).
- `hint` is a one-line action the user can take. NEVER include the value of any secret — only names.

NEVER return `NEED_INFO` for genuine test failures (assertion miss, wrong status code). Those are `FAIL`.
```

- [ ] **Step 3: Read back to confirm**

Read `src/modules/qa/prompt-sections/core.md` lines 27-60. Confirm the new section is present and well-formed.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/prompt-sections/core.md && \
AV_COMMIT_SKILL=1 git commit -m "feat(qa): add NEED_INFO status to Zmora result contract"
```

---

## Task 2: Add preflight + `NEED_INFO` to BE overlay

**Files:**
- Modify: `src/modules/qa/prompt-sections/overlay-be.md` (Step 2, Step 3, add Step 2.5)

- [ ] **Step 1: Read current overlay-be.md**

Read `src/modules/qa/prompt-sections/overlay-be.md` (all 29 lines). Note: Step 2 (tool detection) already returns SKIP if no HTTP client. We extend it.

- [ ] **Step 2: Replace Step 2 with extended tool + env preflight**

Use Edit. `old_string`:

```
### Step 2: Detect available tools

Run the tool-detection block from the be-testing skill. Record which HTTP client and DB client are available. If no HTTP client is available, return SKIP with reason "No HTTP client available".

If the scenario's DB Check is specified but the DB client is unavailable, perform the API portion and mark only the DB Check as SKIP.
```

`new_string`:

```
### Step 2: Detect available tools

Run the tool-detection block from the be-testing skill. Record which HTTP client and DB client are available.

If no HTTP client is available, return `NEED_INFO` with `kind: "tool"`, `missing: ["curl"]`, `hint: "Install curl or another HTTP client; re-run /run-qa"`.

If the scenario's DB Check is specified but the DB client is unavailable, perform the API portion and mark only the DB Check as SKIP.

### Step 2.5: Pre-flight required env vars

Before sending any request, identify which env vars the scenario depends on. These are usually referenced via shell expansion in the scenario's `curl` / `psql` commands (e.g. `$TEST_USER_EMAIL`, `${API_KEY}`).

For every such VAR, check whether it is set in the current process:

```bash
[ -n "${VAR:-}" ] && echo "OK" || echo "MISSING"
```

If any required VAR is MISSING, return `NEED_INFO` immediately with `kind: "credentials"`, `missing: [<list of missing names>]`, `hint: "Set <names> in the shell that launches OpenCode, restart OpenCode, then reply 'resume'."`. Do NOT proceed to Step 3.

NEVER echo the VALUE of any env var to the conversation — only the name and OK/MISSING.
```

- [ ] **Step 3: Append `NEED_INFO` detection to Step 3 execution flow**

Find Step 3 (execution). Use Edit. `old_string`:

```
### Step 3: Execute the scenario

For your assigned `BE-XX:` block:

1. Read the scenario: method, endpoint, headers, payload, expected response, DB check.
2. Construct and send the HTTP request.
3. Verify response status code + body (via `jq` when available, `grep` fallback).
4. If DB Check is specified: run the query, compare against expected.
5. Execute each edge case as a sub-test.
6. Save response dumps to `docs/testing/reports/dumps/<ID>-response.json` when needed.
```

`new_string`:

```
### Step 3: Execute the scenario

For your assigned `BE-XX:` block:

1. Read the scenario: method, endpoint, headers, payload, expected response, DB check.
2. Construct and send the HTTP request.
3. Verify response status code + body (via `jq` when available, `grep` fallback).

   **If the response is 401 or 403** AND the request used an auth-related env var (e.g. Authorization header sourced from `$API_KEY`), the credential is likely wrong even though it was non-empty. Return `NEED_INFO` with `kind: "credentials"`, `missing: [<the env var name>]`, `hint: "Verify <name> value (got HTTP <code>); re-set in shell that launches OpenCode and reply 'resume'."`. This is a best-effort hint — the missing name may be wrong; the user judges.

4. If DB Check is specified: run the query, compare against expected.

   **If the DB connection fails with an authentication error**, return `NEED_INFO` with `kind: "service"`, `missing: [<DSN host:port>]`, `hint: "Verify database credentials (auth failure on <DSN>); re-set in shell and reply 'resume'."`.

5. Execute each edge case as a sub-test.
6. Save response dumps to `docs/testing/reports/dumps/<ID>-response.json` when needed.
```

- [ ] **Step 4: Read back to confirm**

Read `src/modules/qa/prompt-sections/overlay-be.md` (whole file). Confirm Step 2, Step 2.5, Step 3 all present, in order, no duplication.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/prompt-sections/overlay-be.md && \
AV_COMMIT_SKILL=1 git commit -m "feat(qa): emit NEED_INFO from BE overlay on missing env / 401 / DB auth"
```

---

## Task 3: Add preflight + `NEED_INFO` to FE overlay

**Files:**
- Modify: `src/modules/qa/prompt-sections/overlay-fe.md` (Step 2 → expand; insert Step 2.5)

- [ ] **Step 1: Read current overlay-fe.md**

Read `src/modules/qa/prompt-sections/overlay-fe.md` (all 28 lines).

- [ ] **Step 2: Replace Step 2 with `NEED_INFO` on missing Playwright + insert Step 2.5 env check**

Use Edit. `old_string`:

```
### Step 2: Verify Playwright availability

Try `playwright_browser_navigate` to `about:blank`. If unavailable, try `Bash(playwright:*)` CLI. If neither is available, return SKIP with reason "Playwright unavailable".
```

`new_string`:

```
### Step 2: Verify Playwright availability

Try `playwright_browser_navigate` to `about:blank`. If unavailable, try `Bash(playwright:*)` CLI. If neither is available, return `NEED_INFO` with `kind: "tool"`, `missing: ["playwright"]`, `hint: "Install Playwright (npx playwright install), then re-run /run-qa"`.

### Step 2.5: Pre-flight required env vars

Identify the env vars the scenario depends on. FE scenarios usually consume these via the page under test (e.g. a login form's email field is filled from `$TEST_USER_EMAIL`).

For every such VAR, check whether it is set in the current process:

```bash
[ -n "${VAR:-}" ] && echo "OK" || echo "MISSING"
```

If any required VAR is MISSING, return `NEED_INFO` with `kind: "credentials"`, `missing: [<list of missing names>]`, `hint: "Set <names> in the shell that launches OpenCode, restart OpenCode, then reply 'resume'."`. Do NOT proceed to Step 3.

NEVER echo the VALUE of any env var — only the name and OK/MISSING.
```

- [ ] **Step 3: Append `NEED_INFO` 401 detection to Step 3 execution**

Use Edit. `old_string`:

```
### Step 3: Execute the scenario

For your assigned `FE-XX:` block:

1. Read the steps and expected result.
2. Execute each step using available Playwright tools (prefer native `playwright_browser_*` over CLI).
3. After each action, take a snapshot via `playwright_browser_snapshot()` to verify state.
4. If expected result is met → PASS.
5. If not met → take screenshot to `docs/testing/reports/screenshots/<ID>-fail.png`, return FAIL.
6. Execute each edge case as a sub-test.
```

`new_string`:

```
### Step 3: Execute the scenario

For your assigned `FE-XX:` block:

1. Read the steps and expected result.
2. Execute each step using available Playwright tools (prefer native `playwright_browser_*` over CLI).
3. After each action, take a snapshot via `playwright_browser_snapshot()` to verify state.

   **If a step depends on a login-walled page** and the resulting snapshot shows an authentication error UI ("Invalid credentials", a 401 response in the network log, or the login form re-rendering after submission), return `NEED_INFO` with `kind: "credentials"`, `missing: [<the env var name used to fill the form>]`, `hint: "Verify <name> value (login failed); re-set in shell and reply 'resume'."`. This is a best-effort hint.

4. If expected result is met → PASS.
5. If not met → take screenshot to `docs/testing/reports/screenshots/<ID>-fail.png`, return FAIL.
6. Execute each edge case as a sub-test.
```

- [ ] **Step 4: Read back to confirm**

Read `src/modules/qa/prompt-sections/overlay-fe.md` (whole file). Confirm new Steps 2, 2.5, 3 present in order.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/prompt-sections/overlay-fe.md && \
AV_COMMIT_SKILL=1 git commit -m "feat(qa): emit NEED_INFO from FE overlay on missing env / auth UI"
```

---

## Task 4: Strip `.env` fallback from Perun's base-URL detection

**Files:**
- Modify: `src/agents/perun.md` line 37

- [ ] **Step 1: Find Step 2's base-URL detection bullet**

Read `src/agents/perun.md` lines 33-37. Confirm current line 37:

```
   - Detect base URL: prefer `base-url` from frontmatter; fall back to env files, README, or `package.json` port hints.
```

- [ ] **Step 2: Replace to remove env-file fallback**

Use Edit. `old_string`:

```
   - Detect base URL: prefer `base-url` from frontmatter; fall back to env files, README, or `package.json` port hints.
```

`new_string`:

```
   - Detect base URL: require `base-url` in frontmatter, or fall back to README / `package.json` port hints. NEVER read `.env`, `.env.local`, `.envrc`, or any dotfile — base-URL discovery must not touch credential-bearing files. If no source provides a base URL, abort Step 2 with an explanatory error to the user.
```

- [ ] **Step 3: Read back to confirm**

Read `src/agents/perun.md` lines 33-40. Confirm new wording.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/agents/perun.md && \
AV_COMMIT_SKILL=1 git commit -m "fix(perun): forbid base-URL detection from reading .env files"
```

---

## Task 5: Create `scripts/qa-preflight.sh` probe runner

**Files:**
- Create: `scripts/qa-preflight.sh`
- Create: `tests/scripts/qa-preflight.test.ts` (vitest harness that spawns the script)

This shell script encapsulates ALL the probing logic so Perun's prompt stays declarative and `allowed-tools` stays narrow. The script reads probe descriptors from stdin (one per line, format `env NAME`, `service URL`, `db DSN`) and emits `OK <ident>` or `MISSING <ident> (<reason>)` to stdout, one per line. Exit code is always 0 — gap counting is the caller's job (Perun parses stdout).

Without this script, Step 3.5.b's env-var probe would need shell-builtin constructs (`for`, `[`, parameter expansion) that require `Bash(bash:*)` — an over-broad allowance that effectively bypasses the narrow allowlist. Wrapping it in a single script we whitelist via `Bash(./scripts/qa-preflight.sh:*)` keeps the allowlist tight.

- [ ] **Step 1: Verify scripts/ dir exists**

```bash
ls scripts/
```

If the directory doesn't exist, create it: `mkdir -p scripts`.

- [ ] **Step 2: Write the script**

Use Write to create `scripts/qa-preflight.sh`:

```bash
#!/usr/bin/env bash
# QA preflight probe runner. Reads probe descriptors from stdin, emits OK/MISSING lines to stdout.
#
# Stdin format (one per line, tab-separated):
#   env<TAB>VAR_NAME
#   service<TAB>URL
#   db<TAB>DSN
#
# Stdout format (one per line):
#   OK <ident>
#   MISSING <ident> (<reason>)
#
# Exit code: always 0. The caller (Perun) parses stdout to count gaps.
# Security: NEVER prints env-var values. Only names and OK/MISSING.

set -u  # treat unset as error inside the script itself; intentionally no `-e` (we
        # never want a single probe failure to abort the whole run)

probe_env() {
    local name="$1"
    # printenv exits 0 if set, 1 if not. Redirect stdout so the value never
    # reaches our pipeline — only the exit code matters.
    if printenv "$name" >/dev/null 2>&1; then
        echo "OK env:$name"
    else
        echo "MISSING env:$name (not set in process env)"
    fi
}

probe_service() {
    local url="$1"
    # Cap each probe at 3s. Accept 2xx/3xx/401/403 as reachable.
    local code
    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
    case "$code" in
        2*|3*|401|403) echo "OK service:$url" ;;
        000)           echo "MISSING service:$url (connection failure)" ;;
        *)             echo "MISSING service:$url (HTTP $code)" ;;
    esac
}

probe_db() {
    local dsn="$1"
    # Dispatch by scheme prefix.
    case "$dsn" in
        postgresql://*|postgres://*)
            if ! command -v pg_isready >/dev/null 2>&1; then
                echo "MISSING db:$dsn (client tool 'pg_isready' not installed)"
                return
            fi
            # Strip scheme, parse host:port/db. Format: postgresql://host:port/db
            local rest="${dsn#postgresql://}"; rest="${rest#postgres://}"
            local hostport="${rest%%/*}"
            local dbname="${rest#*/}"
            local host="${hostport%:*}"
            local port="${hostport#*:}"
            if pg_isready -h "$host" -p "$port" -d "$dbname" -t 3 >/dev/null 2>&1; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (pg_isready failed)"
            fi
            ;;
        mysql://*)
            if ! command -v mysqladmin >/dev/null 2>&1; then
                echo "MISSING db:$dsn (client tool 'mysqladmin' not installed)"
                return
            fi
            local rest="${dsn#mysql://}"
            local hostport="${rest%%/*}"
            local host="${hostport%:*}"
            local port="${hostport#*:}"
            if mysqladmin ping -h "$host" -P "$port" --silent >/dev/null 2>&1; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (mysqladmin ping failed)"
            fi
            ;;
        redis://*)
            if ! command -v redis-cli >/dev/null 2>&1; then
                echo "MISSING db:$dsn (client tool 'redis-cli' not installed)"
                return
            fi
            local rest="${dsn#redis://}"
            local host="${rest%:*}"
            local port="${rest#*:}"
            if redis-cli -h "$host" -p "$port" ping >/dev/null 2>&1; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (redis-cli ping failed)"
            fi
            ;;
        sqlite:///*)
            local path="${dsn#sqlite:///}"
            if [ -r "$path" ]; then
                echo "OK db:$dsn"
            else
                echo "MISSING db:$dsn (file not readable: $path)"
            fi
            ;;
        *)
            echo "MISSING db:$dsn (unrecognised DSN scheme — must be postgresql:// / mysql:// / redis:// / sqlite:///)"
            ;;
    esac
}

# Read stdin descriptors. Format is tab-separated `kind<TAB>value`.
while IFS=$'\t' read -r kind value; do
    case "$kind" in
        env)     probe_env "$value" ;;
        service) probe_service "$value" ;;
        db)      probe_db "$value" ;;
        '')      ;;  # skip blank lines
        *)       echo "MISSING $kind:$value (unknown probe kind '$kind')" ;;
    esac
done
```

- [ ] **Step 3: Make it executable**

```bash
chmod +x scripts/qa-preflight.sh
```

- [ ] **Step 4: Write the failing test**

Create `tests/scripts/qa-preflight.test.ts`:

```typescript
import { spawn } from "node:child_process"
import { describe, expect, it } from "vitest"

const SCRIPT = "scripts/qa-preflight.sh"

function runPreflight(stdin: string, env: Record<string, string> = {}): Promise<{
  stdout: string
  exitCode: number | null
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(SCRIPT, [], { env: { ...process.env, ...env } })
    let stdout = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (exitCode) => resolve({ stdout, exitCode }))
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

describe("scripts/qa-preflight.sh", () => {
  it("reports OK for an env var that is set", async () => {
    const { stdout, exitCode } = await runPreflight(
      `env\tTEST_PREFLIGHT_FIXTURE_SET\n`,
      { TEST_PREFLIGHT_FIXTURE_SET: "any-value" },
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain("OK env:TEST_PREFLIGHT_FIXTURE_SET")
  })

  it("reports MISSING for an env var that is not set", async () => {
    const { stdout, exitCode } = await runPreflight(
      `env\tTEST_PREFLIGHT_FIXTURE_UNSET_XYZ\n`,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain("MISSING env:TEST_PREFLIGHT_FIXTURE_UNSET_XYZ")
  })

  it("never prints the value of an env var (security)", async () => {
    const secret = "do-not-leak-this-value-12345"
    const { stdout } = await runPreflight(
      `env\tTEST_PREFLIGHT_SECRET\n`,
      { TEST_PREFLIGHT_SECRET: secret },
    )
    expect(stdout).not.toContain(secret)
  })

  it("rejects unrecognised DB DSN scheme", async () => {
    const { stdout } = await runPreflight(`db\tunknown://host:1234/db\n`)
    expect(stdout).toMatch(/MISSING db:unknown:\/\/.*unrecognised DSN scheme/)
  })

  it("reports MISSING for a service URL that fails to connect", async () => {
    // Port 1 is in the privileged range and almost certainly closed locally.
    const { stdout } = await runPreflight(`service\thttp://127.0.0.1:1\n`)
    expect(stdout).toMatch(/MISSING service:http:\/\/127\.0\.0\.1:1/)
  })

  it("handles multiple probes in one invocation", async () => {
    const { stdout } = await runPreflight(
      [
        `env\tTEST_PREFLIGHT_MULTI_A`,
        `env\tTEST_PREFLIGHT_MULTI_B_UNSET`,
        ``,
      ].join("\n"),
      { TEST_PREFLIGHT_MULTI_A: "v" },
    )
    expect(stdout).toContain("OK env:TEST_PREFLIGHT_MULTI_A")
    expect(stdout).toContain("MISSING env:TEST_PREFLIGHT_MULTI_B_UNSET")
  })

  it("ignores blank lines without erroring", async () => {
    const { stdout, exitCode } = await runPreflight(`\n\n\n`)
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("exit code is 0 even when probes fail (caller parses stdout)", async () => {
    const { exitCode } = await runPreflight(
      `env\tTEST_PREFLIGHT_DEFINITELY_NOT_SET\n`,
    )
    expect(exitCode).toBe(0)
  })
})
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/scripts/qa-preflight.test.ts
```

Expected: all 8 tests pass. If any fail, fix the script. Common gotchas:
- `set -u` is on but a variable wasn't initialised → guard with `${var:-}`.
- `command -v` returning non-zero in a subshell → wrap in `if`, not `&&`.
- Forgot `chmod +x` → fix with `chmod +x scripts/qa-preflight.sh`.

- [ ] **Step 6: Lint with shellcheck if available**

```bash
command -v shellcheck >/dev/null && shellcheck scripts/qa-preflight.sh || echo "shellcheck not installed — skipping"
```

If shellcheck is installed, fix any warnings it surfaces.

- [ ] **Step 7: Commit**

```bash
AV_COMMIT_SKILL=1 git add scripts/qa-preflight.sh tests/scripts/qa-preflight.test.ts && \
AV_COMMIT_SKILL=1 git commit -m "feat(qa): add scripts/qa-preflight.sh probe runner with vitest harness"
```

---

## Task 5b: Widen Perun's `allowed-tools` for the preflight script

**Files:**
- Modify: `src/agents/perun.md` line 5 (frontmatter `allowed-tools`)

- [ ] **Step 1: Read current frontmatter**

Read `src/agents/perun.md` lines 1-6. Confirm current line 5:

```
allowed-tools: Read, Write, Edit, Bash(mkdir:*), Bash(ls:*), Glob, Grep, todowrite, question, dispatch_parallel, assign_issue_ids, compute_waves
```

- [ ] **Step 2: Add only the preflight script to allow-list**

Use Edit. `old_string`:

```
allowed-tools: Read, Write, Edit, Bash(mkdir:*), Bash(ls:*), Glob, Grep, todowrite, question, dispatch_parallel, assign_issue_ids, compute_waves
```

`new_string`:

```
allowed-tools: Read, Write, Edit, Bash(mkdir:*), Bash(ls:*), Bash(./scripts/qa-preflight.sh:*), Glob, Grep, todowrite, question, dispatch_parallel, assign_issue_ids, compute_waves
```

Rationale: Step 3.5 (added in Task 6) invokes a single allow-listed script that encapsulates curl / pg_isready / mysqladmin / redis-cli / printenv. We deliberately do NOT add `Bash(bash:*)` (too broad — would defeat the narrow allowlist) and we do NOT add the individual binaries directly (they'd require shell composition that we can't get without `bash:*`). The script is the single, testable, allow-listed entry point.

- [ ] **Step 3: Read back to confirm**

Read `src/agents/perun.md` lines 1-7.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/agents/perun.md && \
AV_COMMIT_SKILL=1 git commit -m "chore(perun): widen allowed-tools for preflight probes"
```

---

## Task 6: Insert Step 3.5 (preflight prerequisites) into Perun

**Files:**
- Modify: `src/agents/perun.md` (between current Step 3 and Step 4 — around line 47-49)

- [ ] **Step 1: Locate insertion point**

Read `src/agents/perun.md` lines 39-52. Confirm Step 3 ends with the line:

```
   - If sanitisation drops every step of every scenario, abort the run with "no executable scenarios after sanitisation" — do NOT call `dispatch_parallel`.
```

and Step 4 begins with:

```
4. **Ensure output directory exists.**
```

- [ ] **Step 2: Insert Step 3.5 immediately before Step 4**

Use Edit. `old_string`:

```
   - If sanitisation drops every step of every scenario, abort the run with "no executable scenarios after sanitisation" — do NOT call `dispatch_parallel`.

4. **Ensure output directory exists.**
```

`new_string`:

```
   - If sanitisation drops every step of every scenario, abort the run with "no executable scenarios after sanitisation" — do NOT call `dispatch_parallel`.

3.5. **Preflight prerequisites.** Verify the user's environment can satisfy what the plan declares it needs, BEFORE dispatching anything. This is a snapshot check; gaps that slip past it are caught by the `NEED_INFO` backstop in Step 6.

   **3.5.a — Parse `## Setup`.** Look for the `## Setup` section in the plan. If absent, emit toast `Pantheon: QA plan has no Setup section — skipping preflight` and continue to Step 4. If present, parse three subsections (bold headers, trailing colon optional):

   - `**Required environment variables:**` — bullets, each a backticked NAME matching `^[A-Z_][A-Z0-9_]*$`. Bullets that fail the regex are ignored with a warning toast naming the bad line.
   - `**Required services:**` — bullets, each contains a backticked URL.
   - `**Required databases:**` — bullets, each a backticked DSN with explicit scheme (`postgresql://...`, `mysql://...`, `redis://...`, `sqlite:///...`). Schemeless forms are rejected with a warning.

   Auto-inject `base-url` from frontmatter (if present) as an additional required service so it gets probed the same way. Apply soft cap: if total prerequisites > 50, abort with `too many prerequisites (N) — split the plan or remove unused items`.

   **3.5.b — Build the probe input.** Assemble a tab-separated list, one descriptor per line, in this format:

   ```
   env<TAB>VAR_NAME
   service<TAB>URL
   db<TAB>DSN
   ```

   Order doesn't matter; the script processes each line independently.

   **3.5.c — Run the preflight script.** Pipe the descriptor list into `scripts/qa-preflight.sh` (added in Task 5):

   ```bash
   printf 'env\tTEST_USER_EMAIL\nenv\tTEST_USER_PASSWORD\nservice\thttp://localhost:3000\ndb\tpostgresql://localhost:5432/myapp_test\n' | ./scripts/qa-preflight.sh
   ```

   The script:

   - Probes env vars via `printenv VAR >/dev/null` — exit code only, never echoes the value.
   - Probes services via `curl --max-time 3` — accepts 2xx/3xx/401/403 as reachable.
   - Probes databases via the appropriate client (`pg_isready` / `mysqladmin` / `redis-cli` / file-readable test for sqlite).
   - Emits one line per descriptor: `OK <ident>` or `MISSING <ident> (<reason>)`.
   - Always exits 0 — gap counting is your job.

   Per-probe timeout is 3 s (enforced by the script). Total wall-clock target: ≤30 s for ≤50 prereqs (probes run sequentially in the script — sufficient for typical plans).

   **3.5.d — Decide.** Parse the script's stdout. Collect every line starting with `MISSING`. If the list is empty, continue to Step 4. If non-empty, ABORT — do NOT call `dispatch_parallel`. Emit the **preflight prompt** from [Section: User prompts](#user-prompts-for-missing-prerequisites) using the MISSING entries, then wait for the user's next turn.

   **Preflight is a snapshot.** Services that passed here may go down before dispatch reaches them; that case is handled by the Step 6 `NEED_INFO` backstop. Likewise, env vars are checked in the process Perun runs in — env changes the user makes AFTER OpenCode started are invisible until OpenCode restarts.

4. **Ensure output directory exists.**
```

- [ ] **Step 3: Read back to verify the section landed**

Read `src/agents/perun.md` lines 47-100. Confirm Step 3.5 sub-steps a-f are present, well-formed, no truncation. Confirm Step 4 still follows.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/agents/perun.md && \
AV_COMMIT_SKILL=1 git commit -m "feat(perun): add Step 3.5 preflight for required env / services / DBs"
```

---

## Task 7: Extend Perun's Step 6 to recognise `NEED_INFO` and pause subsequent waves

**Files:**
- Modify: `src/agents/perun.md` (Step 6 region — currently around lines 111-117 before Task 6's insertion shifts numbering)

- [ ] **Step 1: Re-find Step 6 (line numbers shifted after Task 6)**

Use `grep -n "^6\." src/agents/perun.md` to find the line where Step 6 starts. Read 20 lines around it. Confirm it contains the parse-specialist-responses block referencing `status === "error"`.

- [ ] **Step 2: Replace the result-parsing bullets with NEED_INFO-aware variant**

Use Edit. `old_string`:

```
6. **Parse specialist responses.** For each result in the accumulated wave list:
   - Prefer JSON if the result starts with `{` or `[`.
   - Fall back to markdown parsing: extract `### [SEVERITY] ...:` headings, `**Problem:**` / `**Remediation:**` / `**Scenario:**` fields with best-effort regex.
   - If `status === "error"` or `status === "timeout"`, treat that single scenario as SKIP with the error message as reason. (Other scenarios are unaffected — failure does not cascade.)
   - If result contains `[…truncated…]`, synthesize what is present — do not retry.
   - **Variant-suffix normalisation.** Before any string from a specialist response (error messages, finding text, scenario references, `result.name`) is written to the report or surfaced to the terminal, replace `zmora-fe` → `zmora` and `zmora-be` → `zmora` in every user-facing string. The variant suffix is an internal implementation detail; only the logical agent name appears to users. Internal log/debug strings may retain variant names.
```

`new_string`:

```
6. **Parse specialist responses.** For each result in the accumulated wave list:
   - Prefer JSON if the result starts with `{` or `[`.
   - Fall back to markdown parsing: extract `### [SEVERITY] ...:` headings, `**Problem:**` / `**Remediation:**` / `**Scenario:**` fields with best-effort regex.
   - If wave-level `status === "error"` or `status === "timeout"`, treat that single scenario as SKIP with the error message as reason. (Other scenarios are unaffected — failure does not cascade.)
   - **If the JSON payload's inner `status === "NEED_INFO"`** (note: wave-level status remains `"success"` — the work succeeded by detecting the gap), treat the scenario as SKIP for reporting purposes (status `SKIP`, reason `"needs <kind>: <missing>"`), AND record the payload in a `needInfoItems` list (collect across the whole wave).
   - If result contains `[…truncated…]`, synthesize what is present — do not retry.
   - **Variant-suffix normalisation.** Before any string from a specialist response (error messages, finding text, scenario references, `result.name`) is written to the report or surfaced to the terminal, replace `zmora-fe` → `zmora` and `zmora-be` → `zmora` in every user-facing string. The variant suffix is an internal implementation detail; only the logical agent name appears to users. Internal log/debug strings may retain variant names.

6.5. **NEED_INFO wave handling.** After parsing the current wave's results:
   - If `needInfoItems` is **empty** → proceed to the next wave (or to Step 7 if this was the last wave).
   - If `needInfoItems` is **non-empty**:
     a. Do NOT dispatch any subsequent wave. (Dispatch is blocking-per-wave; there is nothing to cancel — Wave N+1 simply isn't started.)
     b. Aggregate every `needInfoItem` across the current wave by `kind`. Deduplicate by `(kind, missing-name)`.
     c. Emit the **mid-run prompt** from [Section: User prompts](#user-prompts-for-missing-prerequisites) using the aggregated list and a status snapshot of every scenario (`PASS` / `FAIL` / `SKIP` / `NEED_INFO` / `not-yet-dispatched`).
     d. Wait for the user's next turn. Follow the **Resume procedure** in [Section: Resume semantics](#resume-semantics) on the next turn.
```

- [ ] **Step 3: Read back to confirm**

Read `src/agents/perun.md` around Step 6 (find via grep). Confirm Step 6.5 is inserted, no duplicate content, no broken numbering for downstream Steps 7-10.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/agents/perun.md && \
AV_COMMIT_SKILL=1 git commit -m "feat(perun): recognise NEED_INFO payloads and pause subsequent waves"
```

---

## Task 8: Add User Prompts + Resume Semantics sections to Perun

**Files:**
- Modify: `src/agents/perun.md` (append two new H2/H3 sections at end of Workflow 1, BEFORE Workflow 2 or the example block)

- [ ] **Step 1: Locate insertion point — end of Workflow 1**

Use `grep -n "^### Workflow 2" src/agents/perun.md` (or `grep -n "^## " src/agents/perun.md`) to find where Workflow 1 ends. Read 30 lines preceding that. The new sections must go AFTER Step 10 (or whatever the final Workflow 1 step is) and BEFORE the next workflow / example.

If Workflow 2 doesn't exist, find the next `## ` heading (e.g. the example QA report at the end). Insert before it.

- [ ] **Step 2: Insert the User Prompts section**

Use Edit. `old_string`: the final step of Workflow 1 followed by the next heading. Concretely, find the last Step 10 line (currently around the report-template ends) and the next `## ` or `### ` heading. Use Edit to insert the two new sections between them. The exact `old_string` will be the last line of Step 10's content followed by the next heading — read the file first to get this verbatim.

`new_string` (insert in place of the old_string, with old_string appended at the end of new_string so nothing is lost):

```
### User prompts for missing prerequisites

When you have to ask the user to fix setup, you respond directly in chat — there is no TUI input primitive. Use one of these two templates verbatim, filling in the bracketed slots.

**Preflight-stage prompt** (no scenarios have run yet — used by Step 3.5.f):

```
⚠️ Cannot start QA — <N> prerequisite(s) missing:

Environment variables not set in OpenCode's process:
  • <NAME_1>
  • <NAME_2>

Services not reachable:
  • <URL> (<reason e.g. connection refused / HTTP 500>)

Databases not reachable:
  • <DSN> (<reason>)

To proceed:
  1. In the SAME shell that launches OpenCode, set the env vars:
     `export <NAME_1>=…  <NAME_2>=…`
     (or `source .env` in that shell before starting OpenCode)
  2. Start the missing services (e.g. `docker compose up -d`).
  3. RESTART OpenCode if it's already running — env changes don't propagate live.

Then re-run /run-qa.
```

**Mid-run prompt** (some scenarios already ran — used by Step 6.5.c):

```
⏸ Pausing QA — <M> scenario(s) need additional setup.

Wave <i> results:
  ✅ <ID_1> — passed
  ❌ <ID_2> — error: <reason> (will not auto-retry — investigate first)
  ⏸ <ID_3> — needs <kind>: <missing>

Not yet dispatched (<K> scenarios in Wave <i+1>+):
  <ID_4>, <ID_5>, <ID_6>

Missing:
  • <NAME_1> (<kind>)
  • <URL> (<kind>)

To proceed:
  1. Fix the missing items (set env vars / start services / install tools), then RESTART OpenCode.
  2. Reply "resume" to continue from where we stopped.
  3. Reply "abort" to finalize the report with current results (no further dispatch).
  4. Re-running /run-qa starts over from scratch and discards this wave's progress.
```

**Secret-handling rule.** If the user pastes a credential value into chat (despite the prompt's advice not to), do NOT echo it back. Acknowledge generically: *"Got it — please ensure that env var is set in OpenCode's process; restart OpenCode if needed."* The pasted value still lives in the chat transcript and there's no way to redact it, but Perun MUST NOT amplify the exposure.

### Resume semantics

After a mid-run prompt, treat the user's next reply as part of the same QA run continuing across turns.

**Recognising user intent:**

- Words like `resume`, `continue`, `go`, `ok proceed`, `try again`, equivalents in other languages → treat as **resume**.
- Words like `abort`, `stop`, `skip remaining`, `cancel`, `give up` → treat as **abort**.
- Ambiguous reply (`ok`, `cool`, `thanks`) → ask once more: *"Resume QA with <M+K> scenarios? Reply 'resume' or 'abort'."*
- A reply that includes new env-var values pasted in chat → still requires `resume` to dispatch; do not auto-resume on credentials-paste (the user may have wanted to abort).

**On abort:** Write the report immediately with what you have (`PASS` for previously passing, `FAIL` for previously failing, `SKIP` for `NEED_INFO`/un-started/sanitisation-rejected). Display the summary and stop.

**On resume:**

1. **Re-run Step 3.5 (preflight)** from scratch. If anything is still MISSING → emit the preflight prompt again. The loop is bounded by the user — every turn is one iteration.
2. **Build the re-dispatch list `R`** = `{ scenarios that returned NEED_INFO } ∪ { scenarios from un-started waves }`. Read these from your own previous turn's mid-run prompt (the status snapshot is the canonical state — Perun stores no files).
3. **Pre-filter dependencies.** For each scenario in `R`, drop entries from its `depends_on` that point to scenarios already in `PASS` state. Without this, `compute_waves` raises a "dangling reference" error when called on `R` alone (the satisfied predecessor isn't in `R`). Conceptual rule: passed predecessors are treated as implicit success-edges.
4. **Predecessor failure does not block.** Scenarios in `R` whose `depends_on` includes a previously-`FAIL`/`error`/`timeout` predecessor are still dispatched. This matches the existing contract — Perun does not cascade failure.
5. **Recompute waves** from the filtered re-dispatch list via `compute_waves`.
6. **Confirmation gate.** Before re-dispatching, print to the user: *"Resume QA with <M+K> scenarios (<M> previously blocked + <K> never started)? Reply 'yes' to proceed, 'abort' to stop."* Wait for `yes` (or equivalent). Anything else = abort.
7. **Dispatch the re-dispatch waves.** Merge results: previously-`PASS` scenarios keep their results; new dispatch overwrites their `NEED_INFO` predecessors.
8. If the resume dispatch itself returns more `NEED_INFO` → loop back to step 1. No turn limit.

**Plan modification between turns is undefined behavior.** If the plan file's mtime has changed since the previous turn, emit a soft warning toast `Pantheon: plan file modified mid-run — results may be inconsistent` and proceed. Do not attempt to reconcile additions/deletions; recommend the user re-run `/run-qa` from scratch if they intend a fresh run.
```

Then append the original `old_string` line (the next heading line) after this new content, so the heading is preserved.

- [ ] **Step 3: Read back to confirm**

Read 60 lines around the new sections. Confirm both subsections are present, the heading that came after is intact, no duplication.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/agents/perun.md && \
AV_COMMIT_SKILL=1 git commit -m "feat(perun): add user-prompt templates and resume semantics"
```

---

## Task 9: Update `/create-qa-plan` to emit `## Setup` section

**Files:**
- Modify: `src/commands/create-qa-plan.md` (Step 6 — Generate Test Plan)

- [ ] **Step 1: Read Step 6 in current command file**

Read `src/commands/create-qa-plan.md` lines 141-165. Confirm Step 6's current bullets enumerate Source / Changes Summary / Detected Tools / FE Scenarios / BE Scenarios but no Setup.

- [ ] **Step 2: Insert a new bullet for `## Setup` section emission**

Use Edit. `old_string`:

```
Using the skill's format, generate the test plan:

1. Fill in the **Source** section with the resolved diff source
2. Write the **Changes Summary** based on the analysis
3. Fill in **Detected Tools** based on tool detection results
4. Generate **FE Test Scenarios** (if FE changes detected):
```

`new_string`:

```
Using the skill's format, generate the test plan:

1. Fill in the **Source** section with the resolved diff source
2. Write the **Changes Summary** based on the analysis
3. Fill in **Detected Tools** based on tool detection results
4. Generate the **`## Setup` section** declaring prerequisites the QA run will need. Place this section AFTER frontmatter and BEFORE `## FE Test Scenarios` / `## BE Test Scenarios` so it parses in a single pass.

   Infer prerequisites from the diff:
   - **New `process.env.X` / `os.environ["X"]` / `getenv("X")` / `ENV["X"]` usage** in PR → add `X` to `**Required environment variables:**`.
   - **New service URL in code** (matches `https?://localhost:\d+`, `redis://`, `postgres://`, `mongodb://` etc.) → add to `**Required services:**`.
   - **New DB connection string usage** → add to `**Required databases:**` with explicit scheme (`postgresql://...`, `mysql://...`, `redis://...`, `sqlite:///...`). Schemeless forms are rejected by preflight.

   Format:

   ```markdown
   ## Setup

   **Required environment variables:**
   - `TEST_USER_EMAIL` — login email for test account
   - `TEST_USER_PASSWORD` — login password

   **Required services:**
   - App at `http://localhost:3000`

   **Required databases:**
   - `postgresql://localhost:5432/myapp_test`
   ```

   Rules:
   - Env var names must match `^[A-Z_][A-Z0-9_]*$` (uppercase + underscore + digits).
   - One backtick group per item: env-var NAME, service URL, or DB DSN.
   - Free text after the backtick group (e.g. ` — login email for test account`) is for the human; preflight ignores it.
   - Soft cap: ≤50 items total. If your inference yields more, group / drop infrequently-used ones.
   - If no env vars / services / DBs are needed (e.g. a fully static-content scenario), omit the `## Setup` section entirely — preflight will skip with a warning toast, and the run proceeds as today.

   Mark all generated items as best-effort inferences — the user is expected to review and edit before running QA. If you can't tell whether something is needed, include it; the user can delete it.

5. Generate **FE Test Scenarios** (if FE changes detected):
```

- [ ] **Step 3: Renumber remaining Step 6 bullets**

The previous step 4 became step 5, the old step 5 (FE) becomes step 5 (no — wait, we INSERTED a new step 4 and the old 4 became 5). Re-read the section and update the explicit bullet numbers (the remaining `4. Generate FE...`, `5. Generate BE...` become `5. Generate FE...`, `6. Generate BE...`).

Use Edit. `old_string`:

```
4. Generate **FE Test Scenarios** (if FE changes detected):
   - One scenario per changed component/page/feature
   - Include concrete steps using actual UI element names from the code
   - Include at least 2 edge cases per scenario
5. Generate **BE Test Scenarios** (if BE changes detected):
```

`new_string`:

```
5. Generate **FE Test Scenarios** (if FE changes detected):
   - One scenario per changed component/page/feature
   - Include concrete steps using actual UI element names from the code
   - Include at least 2 edge cases per scenario
6. Generate **BE Test Scenarios** (if BE changes detected):
```

- [ ] **Step 4: Read back to confirm full Step 6 numbering is now 1-6**

Read `src/commands/create-qa-plan.md` lines 141-220. Confirm numbering is sequential 1-6 with the new step 4 (Setup) inserted correctly.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/commands/create-qa-plan.md && \
AV_COMMIT_SKILL=1 git commit -m "feat(create-qa-plan): emit ## Setup section with prerequisite inference"
```

---

## Task 10: Update `test-plan-format` skill (if it exists) to document `## Setup`

**Files:**
- Investigate: `find . -name "test-plan-format*" -not -path "./node_modules/*"`
- Modify (if found): the located file

- [ ] **Step 1: Locate the skill**

Run:

```bash
find . -name "test-plan-format*" -not -path "./node_modules/*" -not -path "./.git/*"
```

- [ ] **Step 2: If the file exists, read and patch its plan template**

If found at e.g. `packages/<plugin>/src/skills/test-plan-format.md`, read it. Find the canonical plan-template block (the markdown skeleton it documents). Insert the `## Setup` section template between the frontmatter and `## FE Test Scenarios`. Use the same template from Task 9 Step 2.

- [ ] **Step 3: If not found, skip this task**

If `find` returns nothing, the skill is provided by an external plugin and this repo can't update it. Note in the commit (or skip the commit). The /create-qa-plan instructions in Task 9 are sufficient because the LLM will follow them even if the upstream skill doesn't mention Setup.

- [ ] **Step 4: Commit (only if file modified)**

```bash
AV_COMMIT_SKILL=1 git add <path-to-skill> && \
AV_COMMIT_SKILL=1 git commit -m "docs(test-plan-format): document ## Setup section schema"
```

---

## Task 11: Add example QA plan demonstrating `## Setup`

**Files:**
- Create: `docs/testing/plans/example-with-setup.md` (canonical template, not dated — referenced by docs)

- [ ] **Step 1: Verify directory exists**

```bash
mkdir -p docs/testing/plans
ls docs/testing/plans/
```

- [ ] **Step 2: Create the example plan**

Use Write to create `docs/testing/plans/example-with-setup.md` with this content:

```markdown
---
source: example (handwritten — not from a PR)
branch: example
base-url: http://localhost:3000
detected-tools: [playwright, curl, psql]
---

# Example Test Plan with `## Setup`

This plan demonstrates the `## Setup` section recognised by `/run-qa` preflight (see `src/agents/perun.md` Step 3.5). Real plans are generated by `/create-qa-plan` — this file is a hand-written reference.

## Setup

**Required environment variables:**
- `TEST_USER_EMAIL` — login email for the test account
- `TEST_USER_PASSWORD` — login password for the test account

**Required services:**
- App at `http://localhost:3000`

**Required databases:**
- `postgresql://localhost:5432/myapp_test`

## Changes Summary

This example exercises a login flow. Use it to verify that preflight catches missing setup before any Zmora dispatch.

## FE Test Scenarios

### FE-01: User logs in with valid credentials

**Steps:**
1. Navigate to `http://localhost:3000/login`.
2. Fill the email field with `$TEST_USER_EMAIL`.
3. Fill the password field with `$TEST_USER_PASSWORD`.
4. Click the `Log in` button.

**Expected result:** User is redirected to `/dashboard`. The page shows the email from `$TEST_USER_EMAIL` in the top-right corner.

**Edge cases:**
- Empty password → form shows validation error, no redirect.
- Wrong password → form shows "Invalid credentials", no redirect.

## BE Test Scenarios

### BE-01: POST /api/login returns 200 with valid credentials

**Method:** POST `http://localhost:3000/api/login`
**Headers:** `Content-Type: application/json`
**Payload:**
```json
{"email": "$TEST_USER_EMAIL", "password": "$TEST_USER_PASSWORD"}
```

**Expected response:** status 200, body has `{"token": "<non-empty>"}`.

**DB Check:**
```sql
SELECT last_login_at FROM users WHERE email = '$TEST_USER_EMAIL';
```
Expect `last_login_at` updated to within the last 60 seconds.

**Edge cases:**
- Missing password field → 400 with `{"error": "password required"}`.
- Wrong password → 401 with `{"error": "invalid credentials"}`.
```

- [ ] **Step 3: Verify the plan renders cleanly**

Read `docs/testing/plans/example-with-setup.md` back. Confirm frontmatter, `## Setup` (placed correctly between frontmatter and `## Changes Summary`), and the scenario IDs (`FE-01`, `BE-01`) match what Perun's prefix sanitisation expects.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add docs/testing/plans/example-with-setup.md && \
AV_COMMIT_SKILL=1 git commit -m "docs(qa): add example plan demonstrating ## Setup section"
```

---

## Task 12: Regression test — dispatch.ts passes structured JSON payloads through unchanged

**Files:**
- Test: `tests/modules/coordinator/dispatch-payload-passthrough.test.ts` (new)

This test guards the spec's load-bearing assumption: a Zmora task that returns a JSON string like `{"status": "NEED_INFO", ...}` reaches Perun unmodified — `dispatch.ts` wraps it in a `DispatchResult` with wave-level `status: "success"` and stuffs the original JSON into `result` (string). If a future refactor unwraps or re-serialises the payload, this test catches it.

- [ ] **Step 1: Inspect dispatch.ts result-construction site**

Read `src/modules/coordinator/dispatch.ts` lines 240-265 (the worker's success-path result construction). Confirm the `result` field is built from the specialist's raw text response without parsing/transforming.

- [ ] **Step 2: Inspect existing dispatch.test.ts pattern**

Read `tests/modules/coordinator/dispatch.test.ts` (first 40 lines + first test) to understand the file's fake-SDK fixture pattern.

- [ ] **Step 3: Write the failing test**

Mirror the patterns in `dispatch.test.ts` exactly. The real API is `dispatchParallel({ tasks, agentRegistry, specialist, signal })` where `specialist` implements `DispatchSpecialist` (`startTask`, `fetchMessages`, `abortTask`).

Create `tests/modules/coordinator/dispatch-payload-passthrough.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import {
  dispatchParallel,
  type AgentInfo,
  type DispatchSpecialist,
} from "../../../src/modules/coordinator/dispatch.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

// Minimal echo specialist. Returns the configured payload as the final
// assistant message so `dispatchParallel` packs it into `result.result`.
function makeEchoSpecialist(payload: string): DispatchSpecialist {
  return {
    async startTask() {
      return "fake-session"
    },
    async fetchMessages(): Promise<PollerMessage[]> {
      return [{ role: "assistant", content: payload, finish_reason: "end_turn" }]
    },
    async abortTask() {
      /* never aborted in these tests */
    },
  }
}

const ZMORA_BE_REGISTRY: Record<string, AgentInfo> = {
  "zmora-be": { mode: "subagent" },
}

describe("dispatchParallel — payload passthrough", () => {
  it("preserves a JSON-shaped NEED_INFO payload byte-for-byte in result", async () => {
    // This is the contract Perun's Step 6.5 (Task 7) relies on: a Zmora
    // response that serialises {"status": "NEED_INFO", ...} must reach Perun
    // unmodified, with wave-level status === "success".
    const needInfoPayload = JSON.stringify({
      status: "NEED_INFO",
      scenario: "BE-03",
      kind: "credentials",
      missing: ["STRIPE_TEST_KEY"],
      hint: "Set STRIPE_TEST_KEY in shell, restart OpenCode, reply 'resume'.",
    })

    const results = await dispatchParallel({
      tasks: [{ name: "zmora-be", prompt: "...", context: "..." }],
      agentRegistry: ZMORA_BE_REGISTRY,
      specialist: makeEchoSpecialist(needInfoPayload),
      signal: new AbortController().signal,
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe("success")
    expect(results[0]?.result).toBe(needInfoPayload)

    // Sanity: parsing the result string yields the original object.
    const parsed = JSON.parse(results[0]!.result)
    expect(parsed.status).toBe("NEED_INFO")
    expect(parsed.missing).toEqual(["STRIPE_TEST_KEY"])
  })

  it("preserves PASS payloads identically (regression for existing behaviour)", async () => {
    const passPayload = JSON.stringify({ status: "PASS", scenario: "BE-01" })

    const results = await dispatchParallel({
      tasks: [{ name: "zmora-be", prompt: "...", context: "..." }],
      agentRegistry: ZMORA_BE_REGISTRY,
      specialist: makeEchoSpecialist(passPayload),
      signal: new AbortController().signal,
    })

    expect(results[0]?.status).toBe("success")
    expect(results[0]?.result).toBe(passPayload)
  })
})
```

> **Note:** The exact `PollerMessage` shape and `fetchMessages` contract are defined in `src/modules/coordinator/poller.ts` — if the import path or `finish_reason` value differs from the snippet above, mirror what `dispatch.test.ts` already does (look at `finishedMessage()` helper on line 13). Do NOT invent fields the type system doesn't have.

- [ ] **Step 4: Run the test**

```bash
npx vitest run tests/modules/coordinator/dispatch-payload-passthrough.test.ts
```

Expected: tests pass (or, if the API differs, the failure tells you what to fix). If they pass, the contract is preserved by current code — the test acts as a guard.

If they fail because of API mismatch (not because dispatch mutates the payload), fix the test to match the actual API. If they fail because dispatch DOES mutate the payload, that's a real bug — file an issue and adapt the design.

- [ ] **Step 5: Run the full test suite to confirm no regression**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add tests/modules/coordinator/dispatch-payload-passthrough.test.ts && \
AV_COMMIT_SKILL=1 git commit -m "test(coordinator): guard dispatchParallel payload passthrough for NEED_INFO"
```

---

## Task 13: Lint + typecheck + full test suite

**Files:**
- (no edits — verification only)

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: no errors. (Prompt edits are markdown — eslint won't lint markdown, but the test file in Task 12 must pass.)

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Full test suite**

```bash
npm test
```

Expected: all tests pass, including the new dispatch-payload-passthrough test.

- [ ] **Step 4: If anything fails, fix and re-run**

Do NOT proceed past this gate with a red build. Each failure is either: (a) a typo in the prompt edits (fix the markdown), (b) the new test using the wrong API (fix the test against the real dispatch.ts API), or (c) a real regression (investigate carefully — the spec's invariant may be broken).

- [ ] **Step 5: No commit** — this task is verification-only. If a fix was needed, it gets its own commit with a `fix(<scope>): ...` message.

---

## Task 14: Manual smoke test — happy path + broken-setup paths

**Files:**
- (no edits — manual verification)

This is the only realistic way to verify prompt-level behaviour end-to-end. Document results in the PR description.

- [ ] **Step 1: Set up a clean shell**

Open a fresh terminal. Do NOT export `TEST_USER_EMAIL` or `TEST_USER_PASSWORD`. Start OpenCode from this shell.

- [ ] **Step 2: Happy-path test — all prerequisites met**

In the OpenCode TUI:

```
> export TEST_USER_EMAIL=test@example.com  (do this BEFORE starting OpenCode in a real test; for this dry-run just verify behaviour)
> /run-qa docs/testing/plans/example-with-setup.md
```

Note: the `>` lines above are terminal prompts; you would set the env var before starting OpenCode. For this smoke test, just confirm that Perun reads the `## Setup` section and (because env vars are absent) emits the preflight prompt.

Expected: Perun's preflight (Step 3.5) parses the `## Setup`, probes each prerequisite, and prints the **preflight prompt** from Task 8 listing the missing vars and unreachable services.

- [ ] **Step 3: Broken-setup test — missing env vars only**

Confirm Perun emits the preflight prompt naming exactly `TEST_USER_EMAIL` and `TEST_USER_PASSWORD`. Confirm no Zmora dispatch occurred (no entries in `docs/testing/reports/`).

- [ ] **Step 4: Broken-setup test — missing service only**

Set the env vars but do NOT start the app on `localhost:3000`. Restart OpenCode. Re-run `/run-qa docs/testing/plans/example-with-setup.md`.

Expected: preflight prompt names the missing service URL with reason `connection refused`. No dispatch.

- [ ] **Step 5: Mid-run NEED_INFO test (synthetic)**

This requires an undeclared prerequisite. Edit the example plan to remove `STRIPE_TEST_KEY` from `## Setup` (or use a custom plan where a scenario references an env var the Setup section omits). Run `/run-qa` against that plan. Expected: preflight passes (declared vars present, services up), Wave 0 dispatches, one of the Zmora results returns `NEED_INFO`, Perun emits the **mid-run prompt** from Task 8.

- [ ] **Step 6: Resume test**

In the same OpenCode session, reply `resume`. Expected: Perun confirms (`Resume QA with N scenarios?`), you confirm `yes`, Perun re-runs preflight, then re-dispatches only the previously-NEED_INFO scenario + any un-started waves.

- [ ] **Step 7: Document results**

Write the observed behaviour into the PR description (or a brief `docs/reviews/2026-05-25-qa-preflight-smoke-test.md` if the user requests). Include: (a) which prompts fired, (b) whether the messages matched the templates verbatim, (c) any deviations from the spec's expected behaviour.

- [ ] **Step 8: No commit** — manual test, no file changes.

---

## Task 15: Finalize

- [ ] **Step 1: Final commit log check**

```bash
git log --oneline master..HEAD
```

Confirm the commit history is clean — each task in the plan produced a single conventional-commits message.

- [ ] **Step 2: Self-review the diff against the spec**

```bash
git diff master..HEAD -- src/ docs/testing/plans/example-with-setup.md tests/modules/coordinator/dispatch-payload-passthrough.test.ts | less
```

Open the spec side-by-side. Confirm each Part of the spec maps to one or more commits in this branch. If any spec requirement is missing, add a task and re-run from there.

- [ ] **Step 3: Push and open PR**

(Only after explicit user approval — never push automatically.)

```bash
git push -u origin <branch-name>
gh pr create --title "feat(qa): preflight + NEED_INFO for /run-qa" --body "$(cat <<'EOF'
## Summary
- Adds `## Setup` declaration to QA plans so /run-qa can verify env / services / databases before dispatching Zmora
- Perun aborts dispatch with a structured prompt when preflight finds gaps; user fixes setup and re-runs (or replies "resume")
- Zmora emits `NEED_INFO` payload when a runtime gap is detected; Perun pauses subsequent waves, prompts user, resumes selectively
- Spec: docs/superpowers/specs/2026-05-25-qa-preflight-and-need-info-design.md
- Plan: docs/superpowers/plans/2026-05-25-qa-preflight-and-need-info.md

## Test plan
- [x] Unit: dispatch-payload-passthrough.test.ts
- [x] Lint, typecheck, full test suite green
- [x] Manual smoke: preflight catches missing env vars (Task 14 Step 3)
- [x] Manual smoke: preflight catches unreachable services (Task 14 Step 4)
- [x] Manual smoke: mid-run NEED_INFO + resume (Task 14 Steps 5-6)
- [ ] Verify dispatch behavior in real session (reviewer)
EOF
)"
```
