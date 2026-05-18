# Specialist Audit for Coordinator MVP

**Audit date:** 2026-05-18
**Auditor:** Pantheon implementation team (via subagent-driven development)
**Scope:** qa-fe-tester (fe-tester), qa-be-tester (be-tester), fix-auto specialists used by `@perun`

> **Note on naming:** The specialist agent files are `packages/qa/dist/agents/fe-tester.md` and
> `packages/qa/dist/agents/be-tester.md`. The coordinator registers them as `qa-fe-tester` and
> `qa-be-tester` via the plugin factory. All findings below use the canonical coordinator names.

---

## qa-fe-tester

**Source:** `packages/qa/dist/agents/fe-tester.md`
**Finding:** PASS

**Observations:**

- **No command-context coupling.** The prompt never references `/run-qa`, "this command", or
  any specific prose command. It defines its contract entirely through its `## Input` section
  (`fe-tester.md:14-16`): "FE test scenarios" and "Base URL". Both are exactly what `@perun`
  passes in `dispatch_parallel`.

- **No fixed findings-file output.** The prompt does not instruct the agent to write to
  `.tmp-fe-findings.md` or any shared path. Results are returned directly as markdown in the
  agent's response (`fe-tester.md:59-79`). This is correct for the coordinator model, where
  `dispatch_parallel` captures the response text rather than reading a side-effect file.

  > Contrast: `/run-qa` (`run-qa.md:138-141`) instructs the subagent to `"Write your findings
  > to the dedicated file: docs/testing/reports/.tmp-fe-findings.md"` via its own prompt
  > wrapper. The agent itself has no such instruction — this was the orchestrator's concern.

- **Playwright availability is self-handled.** The agent detects Playwright availability
  in Step 2 (`fe-tester.md:32-43`) and degrades gracefully to "SKIP all with reason
  'Playwright unavailable'". No tool assumption is hard-coded.

- **Calls `skill(name: "fe-testing")` in Step 1** (`fe-tester.md:24-28`). The `fe-testing`
  skill provides Playwright patterns. This is an additive load; if the skill is unavailable
  the agent still functions with built-in knowledge. Graceful-degradation is not explicitly
  stated here, but skill loading failures are not fatal in the harness.

- **Allowed-tools frontmatter** (`fe-tester.md:2`) lists all Playwright native tools and
  relevant Bash commands. These match what `dispatch_parallel` will have available via the
  `qa-fe-tester` agent type registration.

- **Calling convention:** designed for a single invocation with a batch of scenarios. No loop
  assumption. Returns all scenario results in one response block (`fe-tester.md:59-79`).

**Coordinator prompt strategy:**

`@perun` must include in the `dispatch_parallel` task prompt:
1. The literal text `"Base URL: <url>"` on its own line.
2. The sanitized FE scenario blocks verbatim (all `### FE-XX: ...` sections).

No additional wrapper is required. The agent infers everything else from the prompt and its
own skill. This is already the pattern shown in `perun.md:60-65`.

**Recommended follow-up (if any):**

- None blocking. Post-MVP: confirm `skill` tool is available inside `dispatch_parallel`
  subagents; if not, inline the fe-testing patterns into the agent prompt at build time.

---

## qa-be-tester

**Source:** `packages/qa/dist/agents/be-tester.md`
**Finding:** PASS

**Observations:**

- **No command-context coupling.** The prompt never references `/run-qa` or any specific
  command. Its `## Input` section (`be-tester.md:14-19`) declares three inputs: BE test
  scenarios, Base URL, and optional DB connection info. All three can be provided by
  `@perun`'s dispatch prompt.

- **No fixed findings-file output.** Like `qa-fe-tester`, results are returned inline as
  markdown (`be-tester.md:59-82`). No `.tmp-be-findings.md` write instruction exists in the
  agent prompt itself; that was the `/run-qa` orchestrator's concern.

- **DB connection discovery is self-handled.** When the coordinator does not provide DB
  connection info, the agent falls back to scanning `.env`, `docker-compose.yml`, and
  framework config files (`be-tester.md:40-47`). This matches the `be-testing` skill's
  `Connection String Detection` section. No hard dependency on the coordinator.

- **HTTP client availability is self-handled.** Step 2 (`be-tester.md:34-47`) loads the
  `be-testing` skill and detects available tools. If no HTTP client is found, all scenarios
  are returned as SKIP. No hard assumption about `curl` being present.

- **Calls `skill(name: "be-testing")` in Step 1** (`be-tester.md:28-32`). Same graceful-
  degradation caveat as `qa-fe-tester`.

- **Calling convention:** single invocation with a batch of scenarios. Returns all results
  in one response block (`be-tester.md:59-82`).

- **Allowed-tools frontmatter** (`be-tester.md:2`) lists `curl`, `httpie`, `psql`,
  `sqlite3`, `mysql`, `mongosh`, `redis-cli`, `jq`, `grep`, `cat`, `head`, `tail`, and
  `Read`/`Write`. These are self-consistent with the `be-testing` skill.

**Coordinator prompt strategy:**

`@perun` must include in the `dispatch_parallel` task prompt:
1. `"Base URL: <url>"` on its own line.
2. The sanitized BE scenario blocks verbatim (all `### BE-XX: ...` sections).
3. Optionally `"DB connection: <connection string or credentials>"` if known from the test
   plan frontmatter or project config. If omitted, the agent self-discovers.

This matches the pattern in `perun.md:66-70`. The optional DB connection field is a quality
improvement, not a correctness requirement.

**Recommended follow-up (if any):**

- None blocking. Post-MVP: consider including `"Available tools: curl, psql"` (from
  environment pre-check) in the coordinator prompt to save the agent one tool-detection
  round-trip.

---

## fix-auto

**Source:** `packages/code-review/dist/agents/fix-auto.md`
**Finding:** NEEDS ADJUSTMENT (LOW)

**Observations:**

- **Invocation context mention — low severity.** The description field reads:
  `"Invoked by /fix-report."` (`fix-auto.md:3`). This is frontmatter metadata, not
  a behavioral instruction, so it does not affect runtime. However, it is a stale claim
  now that `@perun` is a second caller. No behavioral impact.

- **Input via `$ARGUMENTS`.** The prompt declares `## Input` as `$ARGUMENTS`
  (`fix-auto.md:14-18`): "The user provides an issue block from `/review`". The reference
  to `/review` is flavour text; the actual contract is the issue block structure (severity,
  title, location, category, problem, remediation). `@perun` passes the full issue block
  from the QA report as the prompt. This is compatible — the agent parses whatever text
  it receives in Phase 1.

- **Uses `question` tool for missing fields** (`fix-auto.md:48-51`). If required fields
  (location, problem, remediation) are absent from the issue block, the agent calls
  `question` to ask the user. In a `dispatch_parallel` subagent context there is no
  interactive user; a blocking `question` call would stall the task. **This is the only
  real risk.** However, `@perun` always passes the full issue block including all required
  fields (`perun.md:183-188`), so this branch should never be triggered in normal operation.

- **`load_appverk_skill` tool** (`fix-auto.md:118`). Phase 2 Step 2.5 calls
  `load_appverk_skill` to load developer skill patterns. The agent handles unavailability
  gracefully: `"If load_appverk_skill is unavailable ... proceed normally. Stack detection
  is additive only."` (`fix-auto.md:136`). No risk.

- **`todowrite` tool** (`fix-auto.md:22`). Phase 1 creates progress tasks. This tool must
  be available inside `fix-auto` subagents. The coordinator's allowed-tools do not list
  `todowrite`, but the agent's own frontmatter does not declare an `allowed-tools` restriction
  for the fix-auto agent type — the tool availability is determined by the harness agent
  registration, not `@perun`'s allowed-tools. No impact on the coordinator.

- **Report output is inline, not file-based** (`fix-auto.md:311-367`). The Fix Report is
  presented as a markdown block in the response. `@perun`'s Workflow 2 (`perun.md:193-196`)
  reads the result text to determine status ("Fixed", "Partially Fixed", "Failed") and then
  edits the report file itself. This is compatible — no shared temp file is involved.

- **Calling convention:** designed for one issue at a time. `@perun` already enforces
  sequential single-issue dispatch (`perun.md:178-181`, `perun.md:212-214`). Compatible.

**Coordinator prompt strategy:**

`@perun` must include in the `dispatch_parallel` task prompt:
1. The complete issue block extracted from the QA report, preserving all fields:
   - `### [SEVERITY] QA-NNN: <title>`
   - `**ID:** QA-NNN`
   - `**Location:** \`file:line\``
   - `**Category:** Testing`
   - `**Problem:**` (with Expected/Actual bullets)
   - `**Remediation:**` (with code examples if present)

2. All required fields must be present to avoid triggering the `question` fallback.

This is already specified in `perun.md:183-188`: `"<full issue block including ID, severity,
location, problem, remediation>"`.

**Recommended follow-up (if any):**

- LOW: Update `fix-auto.md` frontmatter `description` to remove the `/fix-report`-only
  claim: change `"Invoked by /fix-report."` to `"Invoked by /fix-report or @perun."` This
  is documentation accuracy only, not a functional change.
- LOW: The `question` fallback for missing fields (`fix-auto.md:48-51`) will stall in a
  headless subagent context if the coordinator ever passes an incomplete block. Consider
  adding a non-interactive fallback: if required fields are missing, return a structured
  FAILED report rather than calling `question`. Deferred to post-MVP.

---

## Summary

| Specialist | Source file | Status | Blocks MVP? |
|---|---|---|---|
| qa-fe-tester | `packages/qa/dist/agents/fe-tester.md` | PASS | no |
| qa-be-tester | `packages/qa/dist/agents/be-tester.md` | PASS | no |
| fix-auto | `packages/code-review/dist/agents/fix-auto.md` | NEEDS ADJUSTMENT (LOW) | no |

## Decisions

- **qa-fe-tester and qa-be-tester** are fully compatible with `dispatch_parallel` as-is.
  No prompt changes required. The coordinator constructs prompts as shown in `perun.md`.

- **fix-auto** has one structural concern (the `question` fallback on missing required
  fields) that is inert as long as `@perun` always passes complete issue blocks.
  No code or prompt changes are required for MVP correctness.

- **Naming note:** the `run-qa.md` orchestrator injects a `"Write your findings to
  .tmp-fe-findings.md"` instruction into its subagent prompts at call time. The agents
  themselves have no such instruction. `@perun` does not need to replicate this pattern —
  `dispatch_parallel` captures the return value directly.

- **Deferred work (post-MVP):**
  1. Update `fix-auto.md` description line to mention `@perun` as a valid caller.
  2. Add non-interactive fallback to `fix-auto` Phase 1 for missing required fields.
  3. Confirm `skill` tool availability inside `dispatch_parallel` subagents; if unavailable,
     inline skill content into agent prompts at build time.
