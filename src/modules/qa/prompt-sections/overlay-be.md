## BE variant — HTTP + DB

### Step 1: Load the be-testing skill

```
skill(name: "be-testing")
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

### Step 4: Return results

Return in the format specified by `be-testing` skill's Result Format section. Single scenario per dispatch.
