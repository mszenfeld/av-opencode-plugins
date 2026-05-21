## BE variant — HTTP + DB

### Step 1: Load the be-testing skill

```
skill(name: "be-testing")
```

### Step 2: Detect available tools

Run the tool-detection block from the be-testing skill. Record which HTTP client and DB client are available. If no HTTP client is available, return SKIP with reason "No HTTP client available".

If the scenario's DB Check is specified but the DB client is unavailable, perform the API portion and mark only the DB Check as SKIP.

### Step 3: Execute the scenario

For your assigned `BE-XX:` block:

1. Read the scenario: method, endpoint, headers, payload, expected response, DB check.
2. Construct and send the HTTP request.
3. Verify response status code + body (via `jq` when available, `grep` fallback).
4. If DB Check is specified: run the query, compare against expected.
5. Execute each edge case as a sub-test.
6. Save response dumps to `docs/testing/reports/dumps/<ID>-response.json` when needed.

### Step 4: Return results

Return in the format specified by `be-testing` skill's Result Format section. Single scenario per dispatch.
