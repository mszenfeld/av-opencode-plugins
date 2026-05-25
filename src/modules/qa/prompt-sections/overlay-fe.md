## FE variant — Playwright

### Step 1: Load the fe-testing skill

```
skill(name: "fe-testing")
```

This provides Playwright patterns for navigation, interaction, assertion, and screenshots.

### Step 2: Verify Playwright availability

Try `playwright_browser_navigate` to `about:blank`. If unavailable, try `Bash(playwright:*)` CLI. If neither is available, return `NEED_INFO` with `kind: "tool"`, `missing: ["playwright"]`, `hint: "Install Playwright (npx playwright install), then re-run /run-qa"`.

### Step 2.5: Pre-flight required env vars

Identify the env vars the scenario depends on. FE scenarios usually consume these via the page under test (e.g. a login form's email field is filled from `$TEST_USER_EMAIL`).

 Scan the entire scenario block for every `$NAME` or `${NAME}` token regardless of quoting context — including inside form-fill instructions, URL templates, and any data injected into the page. Each unique NAME (matching `[A-Z_][A-Z0-9_]*`) is a required env var.

For every such VAR, check whether it is set in the current process:

```bash
[ -n "${VAR:-}" ] && printf 'OK\n' || printf 'MISSING\n'
```

If any required VAR is MISSING, return `NEED_INFO` with `kind: "credentials"`, `missing: [<list of missing names>]`, `hint: "Set <names> in the shell that launches OpenCode, restart OpenCode, then reply 'resume'."`. Do NOT proceed to Step 3.

NEVER print the VALUE of any env var — only the name and OK/MISSING. Use `printf` (not `echo`) for status reporting; `echo` is not in the allowlist precisely because shell var-expansion (`echo "$VAR"`) would leak secrets to the persisted report.

### Step 3: Execute the scenario

For your assigned `FE-XX:` block:

1. Read the steps and expected result.
2. Execute each step using available Playwright tools (prefer native `playwright_browser_*` over CLI).
3. After each action, take a snapshot via `playwright_browser_snapshot()` to verify state.

   **If a step depends on a login-walled page** and the resulting snapshot shows an authentication error UI ("Invalid credentials", a 401 response in the network log, or the login form re-rendering after submission), return `NEED_INFO` with `kind: "credentials"`, `missing: [<the env var name used to fill the form>]`, `hint: "Verify <name> value (login failed); re-set in shell and reply 'resume'."`. Signals to trust: visible text "Invalid credentials", "Wrong password", "Login failed"; HTTP 401/403 in the network log for the form submission; the URL did NOT change to a post-login route after submit. Signals NOT to trust as credential failure: a generic toast saying "Something went wrong" (could be a backend error unrelated to creds), a 5xx on submit (network/service issue, not creds), or any 401 from a request OTHER than the form submission (could be unrelated auth). This is a best-effort hint.

4. If expected result is met → PASS.
5. If not met → take screenshot to `docs/testing/reports/screenshots/<ID>-fail.png`, return FAIL.
6. Execute each edge case as a sub-test.

### Step 4: Return results

Return in the format specified by `fe-testing` skill's Result Format section. Single scenario per dispatch — do NOT include other scenarios.
