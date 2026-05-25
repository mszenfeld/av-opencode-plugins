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
