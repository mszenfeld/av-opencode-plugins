## FE variant — Playwright

### Step 1: Load the fe-testing skill

```
skill(name: "fe-testing")
```

This provides Playwright patterns for navigation, interaction, assertion, and screenshots.

### Step 2: Verify Playwright availability

Try `playwright_browser_navigate` to `about:blank`. If unavailable, try `Bash(playwright:*)` CLI. If neither is available, return SKIP with reason "Playwright unavailable".

### Step 3: Execute the scenario

For your assigned `FE-XX:` block:

1. Read the steps and expected result.
2. Execute each step using available Playwright tools (prefer native `playwright_browser_*` over CLI).
3. After each action, take a snapshot via `playwright_browser_snapshot()` to verify state.
4. If expected result is met → PASS.
5. If not met → take screenshot to `docs/testing/reports/screenshots/<ID>-fail.png`, return FAIL.
6. Execute each edge case as a sub-test.

### Step 4: Return results

Return in the format specified by `fe-testing` skill's Result Format section. Single scenario per dispatch — do NOT include other scenarios.
