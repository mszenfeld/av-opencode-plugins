# Strict-Orchestrator QA Architecture with Native Bindings — Design (rev3)

**Date:** 2026-05-25
**Status:** Draft (rev3) — addresses findings from second 4-agent review
**Supersedes (partial):** behavior previously described in `2026-05-25-qa-preflight-and-need-info-design.md` for the credential-injection and inline-execution paths.

> **Change log vs rev2**: §4.3 hardens recipe sandbox with explicit bash-operator allowlist, curl flag denylist, and single-statement constraint (eliminates malicious-plan exfil via multi-curl, `--upload-file`, or process substitution); §4.4 introduces deterministic `execute_recipe` plugin tool — recipe execution leaves LLM judgment for diagnostics only; §4.6 names `record_input` as a deterministic tool with explicit interception flow; §4.10 scrubber input set widened to ALL secret-eligible values including user-pasted inputs, with pinned-snapshot semantics for race-safety; §4.9 RECIPE_FAILED cascade now uses transitive-closure SKIP for dependent bindings.
>
> **Change log vs rev1**: §4.1 uses `AgentConfig.tools` as primary gate (native OpenCode); §4.3 mandates `QA_BIND_*` name prefix and recipe-command allowlist; §4.5 hook restricted to `zmora-*` agents only with inverted env-override policy; §4.6 introduces separate `record_input` tool for user-pasted values with bounded retry and feedback; §4.9 NEW (recipe execution semantics); §4.10 NEW (mandatory log-scrubber); §4.11 NEW (resource caps and TTL); open questions §8.2 / §8.5 resolved as design decisions.

---

## 1. Goal

Eliminate two failure modes observed during real QA runs:

1. **Coordinator (Perun) executes scenario work directly** — calling `curl`, `psql`, `docker`, `cat .env`, MCP tools — bypassing its narrow `allowed-tools` allowlist and the "delegate everything" principle.
2. **Dynamic credentials cannot be threaded from setup to test phases** — there is no defined channel from Perun to Zmora for runtime-minted values (JWT, fixture IDs), so Perun either improvises (and leaks values into prompts) or every test scenario returns `NEED_INFO` despite the value being knowable.

Target end-state:

- Perun is a **strict orchestrator** — it reads the plan, dispatches specialists, synthesises results, writes the report. Nothing else.
- Dynamic credentials are minted by a dedicated setup specialist and transported to test specialists via a **native OpenCode mechanism** that never puts the value into an LLM transcript.
- When the setup specialist lacks information, the system holds a **conversational dialog** with the user — asking for the *inputs the recipe needs*, not for the binding itself.
- The design is **defensive against malicious plans, hallucinating LLMs, and adversarial inputs** — not just against the happy path.

## 2. Motivating scenario

Concrete failure observed on 2026-05-25 (`feaute/qa-need-info` branch, plan `2026-05-19-export-pdf-endpoint-test-plan.md`):

1. User invoked `/run-qa` with credentials pasted in chat.
2. Perun, despite its allowlist of `Read, Write, Edit, Bash(mkdir|ls|qa-preflight.sh), Glob, Grep, todowrite, question, dispatch_parallel, assign_issue_ids, compute_waves`, called `serena_list_dir`, `serena_activate_project`, `curl http://localhost:8000`, `supabase status`, `psql`, `make dev.status`, `docker compose logs`, `uv run python scripts/grant_test_entitlement.py`, and `cat .env | grep SERVICE_KEY` — directly violating both the allowlist and the existing "NEVER read `.env`" rule.
3. Perun minted a JWT for the user, embedded the full token (≈1 KB) into 10 dispatched prompts.
4. 9 of 10 Zmoras returned `NEED_INFO("credentials")` because their preflight scans for `$TOKEN` in env, not in prompt text. The text-in-prompt mechanism Perun improvised did not connect to anything.
5. The 10th Zmora hit a real product bug (504 + missing `Cache-Control`), but its signal was buried under nine false `NEED_INFO`s.

Root causes:
- The `allowed-tools` list is **declarative only** — there is no runtime enforcement.
- **No defined transport** exists for value passing between dispatched sessions.
- The mid-run prompt assumes user-fixable shell env. It is structurally incapable of recovering from "Perun knows the value but Zmora can't see it".

## 3. Architecture overview

```
/run-qa
  ↓
Perun reads plan (Read tool, allowlist only)
  ↓
Plan-parse-time validation:
  • all binding names match QA_BIND_*
  • all recipes pass command-allowlist AST check
  • all binding Inputs are declared
  ↓
Preflight (qa-preflight.sh) — static prerequisites (env, services, db)
  ↓ (OK)
compute_waves over ALL scenarios (SETUP-*, BE-*, FE-*) with Depends-on
  ↓
Wave 0: dispatch SETUP-* scenarios to zmora-setup
  • each scenario calls execute_recipe(binding_name) for ONE binding
  • execute_recipe atomically: parses recipe AST, validates, runs, writes binding
  • LLM never sees the value — receives only {status: "ok" | "need_info" | "recipe_failed"}
  • on missing input: NEED_INFO targeting the INPUT, not the binding
  • on recipe failure: RECIPE_FAILED with scrubbed diagnostic
  ↓ (all bindings registered)
Waves 1+: dispatch BE-*/FE-* to zmora-be/zmora-fe
  • bash invocations fire shell.env plugin hook
  • hook checks calling agent (zmora-* only) and injects QA_BIND_* env vars
  • scenario $QA_BIND_TOKEN substitutions resolve to real values, never in transcript
  ↓
Report aggregation (with log-scrubbed output) → docs/testing/reports/
  ↓ (Perun session end OR TTL expiry OR abort)
Cleanup: bindings map purged for parent session
```

Five new primitives carry this:

1. **Declarative per-agent tool restriction** via `AgentConfig.tools` (native OpenCode) — primary gate, paired with prompt-level discipline. (A runtime `tool.execute.before` defense-in-depth hook is deferred to a future iteration; see §4.1.)
2. **`zmora-setup` Zmora variant** with **`execute_recipe` custom tool** (rev3) — deterministic credential acquisition; LLM never observes the value.
3. **`shell.env` plugin hook + per-parent-session bindings map** — native OpenCode channel for env injection, scoped to `zmora-*` agents only.
4. **Mandatory coordinator-side log-scrubber** — redacts known secret-typed binding values from every Zmora result before report/TUI.
5. **Resource caps + TTL** — bindings map has bounded size and lifetime; no leak vector via crash or orphaned session.

## 4. Components

### 4.1 Strict orchestrator constraint (Perun)

Perun's `allowed-tools` allowlist is the **exhaustive** set. Concretely:

- No `Bash(curl:*)`, `Bash(psql:*)`, `Bash(docker:*)`, `Bash(supabase:*)`, `Bash(make:*)`, `Bash(uv:*)`, `Bash(cat:*)`, `Bash(grep:*)`.
- No MCP tools (`serena_*`, `playwright_browser_*`, etc.).
- Reading any dotfile (`.env`, `.env.*`, `.envrc`, `~/.ssh/*`) is forbidden — reaffirms the existing rule.
- The "Hard rule" from the resume Step 7 is **promoted to universal** — applies to every Perun turn (initial dispatch, preflight, resume), not just resume.

Enforcement (two layers, in priority order — as shipped):

1. **Native OpenCode `AgentConfig.tools` declarative restriction** (primary, code-enforced at agent registration time) — `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:840-842` exposes `tools: { [name: string]: boolean }` per agent. Each agent definition (Perun, zmora-fe, zmora-be, zmora-setup) declares allow/deny per known tool in `src/modules/qa/index.ts`. This catches **MCP tools natively** (OpenCode's MCP integration respects this map). Resolves rev1 §8.5 open question.
2. **Prompt-level discipline** (LLM-requested constraint via `core.md` + `overlay-setup.md`) — Perun's and zmora-*'s prompts declare the allowlist with concrete examples of forbidden patterns. LLM compliance only; security must not rely on this alone.

**Future iteration (not implemented):** A third runtime `tool.execute.before` plugin hook is desirable as defense-in-depth. It would receive `{tool, sessionID, callID}` (but **no agent name**, so the plugin would have to maintain its own `sessionID → agent` map populated at `dispatch_parallel` time) and throw to abort on allowlist mismatch. The infrastructure exists (other modules such as `commit` and `session-notification` already register `tool.execute.before` hooks), but the qa module currently does not. Adding it would harden against any future bug that lets a disallowed tool slip past the `AgentConfig.tools` gate. Tracked as a follow-up; out of scope for this revision.

### 4.2 `zmora-setup` variant

A new variant alongside `zmora-fe` / `zmora-be`. Registered via the existing pattern in `src/modules/qa/index.ts` (`VARIANTS = ["fe", "be", "setup"]`).

**Code touch-points** (beyond array edit, surfaced by agent B-T8):
- `src/modules/qa/allowed-tools.ts` — type `QaTesterStack` widens to `"fe" | "be" | "setup"`; new `SETUP_TOOLS` const; `toolsForVariant()` switch extended.
- `src/modules/qa/prompt-builder.ts` — `getOverlay()` switch handles `"setup"` → reads `overlay-setup.md`.
- `src/modules/qa/prompt-sections/overlay-setup.md` — NEW. Setup-specific instructions.
- `src/modules/qa/prompt-sections/core.md` — prefix regex widens to `^#{2,4}\s+(FE|BE|SETUP)-\d+`.

**Allowed tools (SETUP_TOOLS, rev3 narrowed):**
- `Read`, `Glob`, `Grep` (project context inspection for diagnostics)
- `execute_recipe` (custom plugin tool, see §4.4.1) — the ONLY way to actuate a binding recipe; setup-Zmora has no direct Bash access for recipe execution
- (note: `Bash(curl:*)`, `Bash(jq:*)`, etc. are NOT in SETUP_TOOLS in rev3 — the recipe runs INSIDE `execute_recipe` plugin tool, not via LLM-issued bash. This is a tightening over rev2 — setup-Zmora's LLM has even less attack surface.)

**Available for explicit (non-auto-binding) SETUP-XX scenarios** (when plan-author needs custom setup logic not expressible as a recipe-binding): a wider Bash allowlist may be granted per-scenario via an opt-in plan flag `setup-tools: extended` — out-of-scope for this design, defer to a follow-up spec.

**Forbidden:**
- `Write`, `Edit` (no file mutation)
- Reading dotfiles (same restriction as Perun)
- `Bash(bash:*)`, `Bash(sh:*)`, `Bash(eval:*)`, `Bash(source:*)`, `Bash(.:*)` (no shell-recursion)
- `Bash(./scripts/qa-preflight.sh)` (closes A#15 oracle finding — setup MUST NOT introspect env presence by name)
- MCP tools

### 4.3 `## Setup` plan format extension

`## Setup` gains an optional `**Bindings:**` subsection. Each binding has **five** fields:

```markdown
**Bindings:**
- `QA_BIND_TOKEN` (secret) — Supabase JWT for the test user
  - Inputs: `$TEST_USER_EMAIL`, `$TEST_USER_PASSWORD`, `$SUPABASE_URL`, `$ANON_KEY`
  - Egress: `$SUPABASE_URL`
  - Recipe:
    ```bash
    curl -sS "$SUPABASE_URL/auth/v1/token?grant_type=password" \
      -H "apikey: $ANON_KEY" \
      -H "Content-Type: application/json" \
      --data-urlencode "email=$TEST_USER_EMAIL" \
      --data-urlencode "password=$TEST_USER_PASSWORD" \
      | jq -er .access_token
    ```

- `QA_BIND_CV_ID` (plain) — Test CV created via the API
  - Inputs: `$QA_BIND_TOKEN`, `$BASE_URL`
  - Egress: `$BASE_URL`
  - Recipe:
    ```bash
    curl -sS -X POST "$BASE_URL/api/v1/cvs" -H "Authorization: Bearer $QA_BIND_TOKEN" -H "Content-Type: application/json" --data-urlencode 'name=Test CV' --data-urlencode 'language=en' | jq -er .id
    ```
```

**Field schema:**

- **Name**: MUST match `^QA_BIND_[A-Z][A-Z0-9_]*$`. The `QA_BIND_` prefix is mandatory — eliminates A#1 by making it impossible to shadow `PATH`, `LD_PRELOAD`, etc. by design.
- **Type**: `secret` or `plain`. Drives mid-run dialog severity AND log-scrubber pattern matching (§4.10). Default `secret` if unspecified (fail-safe).
- **Inputs**: list of env var names referenced in the recipe. **Must include every `$NAME` token used.** Strict mode — plan parser rejects recipes with undeclared `$NAME` references. Inputs can be either user-supplied env vars (read from process env via inheritance) or other bindings (must be `QA_BIND_*`).
- **Egress**: a single URL (with `$VAR` substitution allowed). The single `curl` call in the recipe MUST target this host. Closes A#12 + S7.
- **Recipe**: a fenced bash code block. **MUST be a single bash statement** (one pipeline). Parsed at plan-load time by a deterministic validator (`src/modules/qa/binding-parser.ts`) — see §4.3.1.

#### 4.3.1 Recipe sandbox (rev3 hardening — closes S7)

Recipes are constrained by THREE orthogonal rules. The validator REJECTS the plan if any is violated. There is no runtime escape — security boundary is at plan-load time, before any dispatch.

**Rule 1 — Single-statement constraint.** A recipe is exactly ONE pipeline of allowed commands. The validator splits the recipe text on `;`, `&&`, `||`, and unescaped newlines (after collapsing `\<newline>` line-continuations). If the split yields more than one statement, REJECT with `"recipe must be a single statement; found N statements"`. This eliminates multi-curl exfil (S7) by construction — a recipe cannot have two separate `curl` invocations.

**Rule 2 — Bash operator allowlist.** Within the single statement, only these constructs are permitted:

| Operator / construct | Allowed | Notes |
|---|---|---|
| `\|` (pipe) | ✅ | Standard pipeline between allowed commands. |
| `\<newline>` (line continuation) | ✅ | Reformatting only — collapses to single logical line. |
| `${VAR}` / `$VAR` (parameter expansion, simple) | ✅ | Substitutes from process env (which includes injected `QA_BIND_*` via §4.5 hook). |
| `${VAR:-default}` / `${VAR:?error}` (parameter expansion, default/error forms) | ✅ | Defensive defaults. |
| `2>/dev/null`, `>/dev/null` | ✅ | Only `/dev/null` redirects permitted. |
| `'...'` / `"..."` (quoting) | ✅ | Required for safe arg passing. |
| `$()`, backticks `` `...` `` (command substitution) | ❌ | REJECT. Subverts pipeline. |
| `$(<file)` (file read substitution) | ❌ | REJECT. Local file read. |
| `<(...)`, `>(...)` (process substitution) | ❌ | REJECT. Subshell. |
| `<<EOF`, `<<-EOF`, `<<<` (heredoc / herestring) | ❌ | REJECT. Multi-line carrier. |
| `;`, `&&`, `\|\|` | ❌ | REJECT (Rule 1 already excluded, but enumerated for clarity). |
| Any redirect to path other than `/dev/null` (`>file`, `2>file`, `&>file`) | ❌ | REJECT. Local file write. |
| `&` (background) | ❌ | REJECT. |
| `(...)`, `{...}` (subshell / brace group) | ❌ | REJECT. |
| `export`, `unset`, `set`, `declare`, `local`, `readonly` | ❌ | REJECT. Env manipulation. |
| `function`, `=>` | ❌ | REJECT. Function definition. |

**Rule 3 — Command allowlist + flag denylist.** Each command in the pipeline must be one of these binaries:

`curl`, `psql`, `sqlite3`, `jq`, `sed`, `awk`, `grep`, `cut`, `head`, `tail`, `tr`, `printf`

Any other token before the first option/argument is REJECT (`eval`, `bash`, `sh`, `source`, `.`, etc. cannot even appear).

**Per-command flag restrictions** (REJECT plan if found):

For `curl` specifically:
- `--upload-file` / `-T` (uploads local file)
- `--form @<file>` / `-F @<file>` (multipart with file)
- `-d @<file>` / `--data @<file>` / `--data-binary @<file>` / `--data-raw @<file>` (request body from file)
- `--config` / `-K` (read flags from config file)
- `--cookie` reading from file / `--cookie-jar` / `-c`
- `--dump-header` / `-D` (write headers to file, unless `/dev/null`)
- `--trace`, `--trace-ascii`, `--trace-config` (debug-to-file)
- `--output` / `-o` (unless `/dev/null`)
- `-O` (remote-name output to local file)
- `--write-out` / `-w` with `@<file>` format
- `--remote-name-all`, `-J`, `--remote-header-name`

`--data-urlencode '...'` (inline-only) IS permitted — recommended way to encode arbitrary string values without local file reads.

**Rule 4 — Egress URL match.** The single `curl` invocation's first URL argument is parsed; `$VAR` tokens substituted with a placeholder. The resulting URL's hostname MUST match `Egress:` host (after the same placeholder substitution). REJECT otherwise. This is enforced statically at plan-load — there is no runtime URL interception.

**Output**: recipe stdout IS the binding value (after `trim()`). Validated per §4.9 (non-empty, not literal `"null"`/`"undefined"`/`"None"`/`"nil"`/`"NaN"`, no control bytes; `"0"` and `"false"` ARE valid binding values).

**Topological order**: each binding's recipe runs after all its `Inputs` are satisfied. Each binding gets its OWN `SETUP-XX` scenario synthesised by Perun (one binding per scenario — improves §4.7 granularity over rev1's "one bundled SETUP-00").

### 4.4 Custom plugin tools — `execute_recipe`, `register_binding`, `record_input`

Rev3 splits the binding lifecycle into THREE deterministic plugin tools. The LLM is never the executor of security-critical actions — it only orchestrates and reasons about diagnostics.

#### 4.4.1 `execute_recipe` (rev3 NEW — deterministic recipe executor)

Signature:
```ts
execute_recipe({
  binding_name: string  // e.g. "QA_BIND_TOKEN"
}): Promise<
  | { status: "ok" }
  | { status: "need_info", missing: string[] }
  | { status: "recipe_failed", reason: string, stderr_tail: string }
  | { status: "unknown_binding" }
>
```

**Behavior** (atomic, plugin-process):

1. Looks up the binding declaration in the parent (Perun) session's parsed plan. Plan is parsed once at `/run-qa` start by `binding-parser.ts` and cached in `qa-run-state.ts` keyed by parent sessionID.
2. Iterates the binding's `Inputs:` list. For each input:
   - If input is a `QA_BIND_*` name: check bindings map (set by a previous `execute_recipe` call).
   - Otherwise (user-supplied env name): check process env via `printenv`.
   - If any is unset → return `{ status: "need_info", missing: [unsetNames] }`. **Recipe is not executed.**
3. All inputs present → execute the recipe via OpenCode's bash tool, **using the AST already validated at plan-load** (no re-parsing the LLM's view of the recipe text — the validated AST is replayed verbatim). Env for the bash call is the union of: process env + bindings map for this parent session + user-paste inputs (same precedence as §4.5).
4. Capture stdout (≤4 KB), stderr (last 200 bytes for diagnostics — passed through §4.10 scrubber before returning).
5. Validate stdout per §4.9 (non-empty, not literal nullish, no control bytes).
6. **Atomically** invoke the internal write to bindings map: `bindingsMap.get(parentID).set(name, { value: new Secret(stdout.trim()), type, source: "minted-recipe", createdAt: Date.now() })`. **The value never leaves the plugin process** — the LLM that called `execute_recipe` sees only `{ status: "ok" }`.
7. Returns `{ status: "ok" }`.

**Failure paths:**
- Non-zero exit → `{ status: "recipe_failed", reason: "exit_code=<N>", stderr_tail: <scrubbed> }`.
- Stdout fails §4.9 validation → `{ status: "recipe_failed", reason: "invalid_output: <empty|nullish|control_bytes>" }`.
- Recipe exceeds 30s timeout → `{ status: "recipe_failed", reason: "timeout" }`.
- Binding name not declared in plan → `{ status: "unknown_binding" }`.
- Per-binding retry counter exceeds 3 → `{ status: "recipe_failed", reason: "max_attempts" }`.

**Availability**:
- `AgentConfig.tools = { execute_recipe: true }` for `zmora-setup` only.
- All other agents (Perun, zmora-fe, zmora-be) → `{ execute_recipe: false }`.

#### 4.4.2 `register_binding` (rev3 internal — no longer LLM-callable)

The original LLM-facing `register_binding` tool is **removed in rev3**. Its function is now performed atomically by `execute_recipe` (§4.4.1) and `record_input` (§4.4.3) internally. The bindings-map write path is exclusively non-LLM.

Implementation: `bindings-store.ts` exports an internal `writeBinding(parentID, name, value, type, source)` function callable only by other plugin modules. LLM agents have no tool to invoke it directly. This is a strict tightening over rev1/rev2 — the LLM cannot stuff arbitrary `(name, value)` into the map.

Validation enforced inside `writeBinding`:
- Name MUST match `^QA_BIND_[A-Z][A-Z0-9_]*$` (for `execute_recipe` callers) OR `^[A-Z_][A-Z0-9_]*$` (for `record_input` user-paste — non-`QA_BIND_*` names allowed since these are recipe Inputs like `TEST_USER_EMAIL`).
- Value byte length ≤ 4 KB.
- Value MUST NOT contain control bytes `0x00`-`0x1F` (except trailing `\n` which is trimmed).
- Type MUST be exactly `"secret"` or `"plain"`.
- Duplicate name without explicit overwrite → coordinator-side log warning "duplicate binding NAME from <source>; ignored"; existing value retained.

#### 4.4.3 `record_input` (rev3 — user-paste channel)

Signature:
```ts
record_input({
  name: string,    // e.g. "TEST_USER_EMAIL" (regular env var name, NOT necessarily QA_BIND_*)
  value: string
}): Promise<{ status: "ok" | "rejected", reason?: string }>
```

**Behavior:**
- Validates `name` against `^[A-Z_][A-Z0-9_]*$` AND against a process-control-env denylist (`PATH`, `LD_*`, `DYLD_*`, `NODE_OPTIONS`, `BASH_ENV`, `IFS`, `HOME`, `USER`, `TMPDIR`, `AWS_*`, `GIT_SSH_*`, `SSH_AUTH_SOCK`, `PROMPT_COMMAND`, `SHELLOPTS`, `ENV`, `PS4`). Rejected names → `{ status: "rejected", reason: "name_in_denylist_or_invalid" }`.
- Value charset constraints same as `writeBinding`.
- On accept: calls `writeBinding(parentID, name, value, type="secret", source="user-paste")`. Default type is always `secret` for user-paste (fail-safe — drives §4.10 scrubbing).
- Returns `{ status: "ok" }`.

**Availability**:
- `AgentConfig.tools = { record_input: true }` for **Perun only**.
- Perun's LLM calls this when it parses a user reply matching `NAME=value` format during mid-run dialog (§4.6).
- Setup/test Zmoras → `{ record_input: false }`.

**Why a tool, not a coordinator-side message intercept**: rev2 left this ambiguous ("coordinator code, not LLM tool"). Rev3 commits to tool-based: Perun's LLM is the natural-language parser of user replies, but the values flow through a deterministic validator (`record_input` tool) before reaching the bindings map. The LLM cannot bypass validation (e.g., register `PATH=...`). Closes Agent C #15.

**Parent-session resolution for all three tools**: each tool reads `ToolContext.sessionID`, walks via `client.session.get(sessionID).parentID` (cached positively). For Perun's `record_input`, `parentID === undefined` (Perun IS the parent) — the tool falls back to using `sessionID` itself as the key. For setup-Zmora's `execute_recipe`, `parentID` is Perun's sessionID.

### 4.5 `shell.env` plugin hook + bindings map

Hook signature (`@opencode-ai/plugin/dist/index.d.ts:241-247`):

```ts
"shell.env": async ({ sessionID }, output) => {
  if (sessionID === undefined) return
  const agent = sessionAgentMap.get(sessionID)
  if (agent === undefined || !agent.startsWith("zmora-")) return     // A#3 fix
  const parentID = await getParentSessionIDCached(sessionID)
  if (parentID === undefined) return
  const bindings = bindingsMap.get(parentID)
  if (bindings === undefined) return
  for (const [name, { value }] of bindings) {
    // A#11 fix: bindings only fill UNSET keys (inherited env wins). With QA_BIND_*
    // namespace, collision with existing env is impossible anyway, but the policy
    // is principled.
    if (output.env[name] === undefined) {
      output.env[name] = value
    }
  }
}
```

**Scope (rev2 hardening):**
- Hook fires **only for sessions whose agent matches `^zmora-`**. Cross-session leak (A#3) is impossible — unrelated chats / non-Zmora agents never trigger injection.
- Hook silently returns for unknown agents (no error, no log) — avoids info leak about which sessions are QA-related.

**Agent identity source** (`sessionAgentMap`):
- Populated by coordinator at `dispatch_parallel` time: when we call `client.session.create({parentID, title})` and receive a `sessionID`, we record `sessionAgentMap.set(sessionID, task.name)` immediately.
- Cleaned up on `session.deleted` event for that sessionID.

**Override policy (rev2 fix for A#11):**
- Bindings fill UNSET keys only.
- Combined with the `QA_BIND_*` namespace (§4.3), collision is structurally impossible: user shell env vars never start with `QA_BIND_`, so the policy is principled but in practice always permissive.

**Cache (rev2 fix for A#9):**
- `getParentSessionIDCached`: only caches positive results (resolved parentID). Failed lookups are not cached. Cache entries keyed by `(sessionID, sessionCreatedAt)` if SDK exposes it; else keyed by `sessionID` with a manual purge on `session.deleted`.

**Error path (rev2 fix for A#14):**
- The hook body is wrapped in `try/catch`. On exception, log only the binding *name* that was being processed, never the value. Failure is non-fatal (hook returns; Zmora's bash sees no injection; preflight Step 2.5 will report MISSING and trigger NEED_INFO).

### 4.6 Conversational mid-run dialog

When zmora-setup cannot satisfy a binding (missing input env var):

- It returns `NEED_INFO` with `kind: "binding_input"`, `binding: "QA_BIND_TOKEN"`, `missing: ["TEST_USER_EMAIL", "TEST_USER_PASSWORD"]`, optional `hint`.
- Perun aggregates these across the wave and emits a mid-run prompt **targeting the inputs, not the binding**:

```
⏸ Setup needs additional inputs (round 1/3).

Bindings status:
  ✅ DATABASE_URL — already in env
  ⏸ QA_BIND_TOKEN — needs TEST_USER_EMAIL, TEST_USER_PASSWORD to mint
  ⏸ QA_BIND_CV_ID — depends on QA_BIND_TOKEN (will retry after TOKEN is bound)

To proceed:
  1. Set in shell, then RESTART OpenCode and reply 'resume' (safest for secrets):
       export TEST_USER_EMAIL=…
       export TEST_USER_PASSWORD=…
  2. Reply with the value(s) directly in chat — values WILL persist in chat
     transcript. OK for non-secret inputs (emails, IDs); NOT recommended for
     passwords. Format: NAME=value, one per line.
  3. Reply 'abort' to stop the run.
```

**User reply parsing (rev2 enhanced for A#7 and S2):**

- `resume` → re-run preflight, re-dispatch setup wave.
- `abort` → write report with current state, stop.
- Lines parsed with regex `^[ \t]*([A-Z_][A-Z0-9_]*)[ \t]*=[ \t]*(.+?)[ \t]*$` (allows whitespace around `=` — fixes S2 typo).
- **Comment/blank lines** (`^\s*#`, `^\s*$`) are silently ignored.
- **Any other non-matching line** triggers a follow-up reply from Perun: "I parsed N values: NAME1, NAME2. I did NOT parse: '<line>' (expected NAME=value). Please clarify or re-paste."
- After parsing, Perun emits confirmation: "Recorded values for: NAME1, NAME2 (lengths: 24, 18 chars). Re-attempting setup..." — echoes names + lengths only, never values.

**Write path for user-pasted values (rev3 — `record_input` tool):**

- Perun's LLM, on observing a user reply that matches the `NAME=value` regex, calls the **`record_input` plugin tool** (§4.4.3) for each parsed pair.
- The tool performs deterministic validation (name pattern + process-control denylist + value charset) and writes to bindings map via `writeBinding()`. The LLM cannot bypass validation — it has no other write path.
- Entries written by `record_input` have `source: "user-paste"` and `type: "secret"` (fail-safe default for log-scrubbing per §4.10).
- User-pasted INPUT values are NOT prefixed `QA_BIND_*` — they are regular env vars (`TEST_USER_EMAIL`, `TEST_USER_PASSWORD`) referenced by recipes via `Inputs:`. The `shell.env` hook does inject them too (so the next `execute_recipe` invocation sees them in env), but the `QA_BIND_*` prefix discipline applies only to *minted bindings* (`execute_recipe` callers must use `QA_BIND_*`; `record_input` callers may use plain env-var names).
- If the tool returns `{ status: "rejected", reason }`, Perun surfaces this verbatim to the user ("I cannot use that name: <reason>. Please choose a different env var name.").

**Retry counter unification (rev3 — resolves Q4 ambiguity):**
- A single counter tracks dialog rounds per QA run: max 3. Each user-`resume` reply consumes one round.
- The per-binding recipe-attempt counter (§4.9) is bounded separately at max 3 attempts but those attempts happen WITHIN one dialog round (auto-retry of execute_recipe with backoff before surfacing NEED_INFO).
- Net effect: at most 3 user-visible rounds × 3 internal recipe attempts = 9 invocations per binding, but the user sees at most 3 dialog prompts.
- After the 3rd dialog round, Perun auto-aborts with diagnostic: "Setup unresolved after 3 rounds. Aborting. Last unresolved bindings: NAME1, NAME2."

**Secret-handling rule** (existing, reaffirmed): if user pastes a value despite the warning, Perun acknowledges generically ("Recorded value for NAME1") — never echoes the value back into chat.

### 4.7 Setup scenarios in the wave graph

Setup runs as Wave 0 via standard `**Depends-on:**` semantics (port from oh-my-openagent's task-dependency model).

**Prefix routing widening** (rev2 fix for C-§4.7 vs core.md:6):
- `src/modules/qa/prompt-sections/core.md` — regex `^#{2,4}\s+(FE|BE)-\d+` widens to `^#{2,4}\s+(FE|BE|SETUP)-\d+`.
- `src/modules/coordinator/sanitize.ts` (or wherever sanitisation reads prefix) — same widening.
- Routing: `FE-*` → `zmora-fe`, `BE-*` → `zmora-be`, `SETUP-*` → `zmora-setup`.

**Per-binding scenario synthesis** (rev2 fix for S6 and partial-state issue):
- For each declared binding in `**Bindings:**`, Perun synthesises one `SETUP-<NN>: Provision QA_BIND_<NAME>` scenario BEFORE `compute_waves`.
- Each synthesised scenario has `Depends-on:` derived from binding's `Inputs` that are themselves bindings (transitive closure).
- One binding = one SETUP scenario = one dispatched setup-Zmora session. If one fails, others are unaffected.

A plan with explicit `### SETUP-XX:` blocks (no `**Bindings:**`) gets those scenarios as-is — no synthesis. Mixed mode (explicit + bindings) is supported; explicit always run.

**Compatibility flag in compute_waves**: no code change beyond the routing prefix; `compute_waves` is prefix-agnostic and handles arbitrary `id` strings (per B-T10 confirmation).

### 4.8 Cleanup semantics

- On Perun's QA-run completion (report written), plugin wipes `bindingsMap.get(perunSessionID)` and removes corresponding `sessionAgentMap` entries.
- On abort (user reply, signal, hook failure), same wipe.
- On parent session deletion (OpenCode event `session.deleted` — confirmed per B-T7), same wipe.
- **TTL** (rev2 fix for A#6 / S4 orphan-leak): each binding entry has a `createdAt` timestamp. A background sweep (every 5 min) purges entries older than 1 hour. Default chosen because longest plausible QA run is well under 1h; longer runs need explicit re-auth.
- **Plugin reload purge** (rev2 fix for C-undeclared-assumption): if the plugin module is reloaded (HMR, restart), `bindingsMap` is naturally re-initialised as an empty Map — bindings vanish, requiring a fresh setup run.
- **No on-disk persistence** — explicit divergence from oh-my-openagent's plaintext mailbox.

### 4.9 Recipe execution semantics (rev3 — deterministic via `execute_recipe`)

Resolves S3, S5, and the rev2 ambiguity about who/where executes recipes.

**Per-recipe execution model** (entirely inside the `execute_recipe` plugin tool — see §4.4.1 for the full lifecycle).

Setup-Zmora's role is simplified compared to rev2: it does NOT read the recipe text and call bash directly. Instead, for each declared binding in its assigned SETUP-* scenario, setup-Zmora:

1. Calls `execute_recipe({ binding_name: "QA_BIND_<NAME>" })`.
2. Receives one of four statuses (§4.4.1):
   - `{ status: "ok" }` → binding registered atomically by the tool; setup-Zmora moves on.
   - `{ status: "need_info", missing: [...] }` → setup-Zmora returns `NEED_INFO` to Perun with the same `missing` list, kind: `"binding_input"`.
   - `{ status: "recipe_failed", reason, stderr_tail }` → setup-Zmora returns `RECIPE_FAILED` to Perun, propagating `reason` and `stderr_tail` (already scrubbed by §4.10 before reaching the LLM).
   - `{ status: "unknown_binding" }` → setup-Zmora returns an error (shouldn't happen — plan parser ensures the binding exists).
3. Setup-Zmora never sees the actual value. Its LLM context contains only status enums + diagnostic strings.

**Recipe timeout**: 30 s per recipe execution (enforced inside `execute_recipe`).

**Bounded retry**:
- Per binding: max 3 recipe attempts. Attempts 1 and 2 are auto-retried with exponential backoff (1s, 3s) inside `execute_recipe` for transient errors (network 5xx, timeout). Attempt 3 surfaces as `recipe_failed(reason: "max_attempts")` to setup-Zmora and onward to Perun.
- Counters live in `qa-run-state.ts` keyed by `(parentID, binding_name)`.

**Transitive cascade** (rev3 fix for Agent B Q5):
- When binding A fails permanently (RECIPE_FAILED after max attempts):
  - Bindings B whose `Inputs:` include A are auto-marked `SKIP(reason: "transitive_binding_failure", failed_dep: A)`. `execute_recipe` is NOT invoked for them — the cascade is determined by `binding-parser.ts` at run time using the parsed dependency graph.
  - BE/FE scenarios with `Depends-on: SETUP-<A>` (or transitively) cascade to `SKIP(reason: "binding_failed", failed_dep: A)`.

**Perun-side handling of `RECIPE_FAILED`:**
- Surface in mid-run dialog with diagnostic excerpt (stderr already scrubbed per §4.10):
  ```
  ❌ QA_BIND_TOKEN — recipe failed (exit 5)
     stderr: "jq: parse error: Invalid numeric literal at line 1, column 5"
     Last 3 attempts exhausted.

  This usually means: the API returned an unexpected response.
  Suggested actions:
    1. Verify TEST_USER_EMAIL/TEST_USER_PASSWORD are correct (re-paste or re-export)
    2. Verify SUPABASE_URL is reachable: try `curl $SUPABASE_URL/health` manually
    3. Reply 'abort' to stop.
  ```
- BE/FE scenarios that depend on the failed binding cascade to `SKIP(reason: "binding_failed")` — not silently FAIL with auth errors (resolves S3 false-signal).

### 4.10 Log-scrubber (rev3 — widened input set + pinned snapshot)

Promoted from rev1 §8.2 open question to required component. Rev3 widens the input set to include user-pasted inputs (closes Agent B Q6) and pins the bindings map for race-safety during report write (closes Q9).

**Mechanism:**

- The scrubber's input set is the **union** of:
  - All bindings in the current parent session's map with `type === "secret"` (registered via `execute_recipe`)
  - All bindings in the current parent session's map with `source === "user-paste"` (registered via `record_input` — these default to `type: secret`)
- Before any Zmora result text is:
  - Written to a report (`docs/testing/reports/`)
  - Echoed to the TUI (via dispatch summary or status)
  - Logged via console / plugin debug
  - Passed to a mid-run dialog (`RECIPE_FAILED` `stderr_tail` included)
- the coordinator applies a pattern replacement: each known secret value is replaced with `[REDACTED:NAME]`.

**Pinned-snapshot semantics** (rev3 fix for Q9 race):

- When `dispatch.ts` starts assembling a report (or any output operation that runs the scrubber), it first calls `bindings-store.pinSnapshot(parentID)` which returns an immutable snapshot of the bindings map at that instant and increments an in-use counter on the underlying entries.
- The scrubber operates on this snapshot, not the live map.
- TTL sweep (§4.11) checks the in-use counter before purging an entry — pinned entries are deferred to the next sweep cycle.
- After the operation completes, `bindings-store.releaseSnapshot(snapshotID)` decrements the counter.

**Implementation point**: `src/modules/qa/scrubber.ts` exports `scrubSecrets(text: string, parentID: string): string`. `src/modules/coordinator/dispatch.ts` `runTask()` calls it AFTER `neutralizeUntrustedOutput()` when the task's parent matches a known QA run. `execute_recipe` also routes `stderr_tail` through the same scrubber before returning to the LLM.

**Patterns matched:**
- Exact-string match of full value (highest priority)
- Partial match of segments ≥16 chars, but only when the segment has Shannon entropy ≥3.5 bits/char (rev3 — filters out low-entropy substrings like `test_user_admin` that could otherwise trigger false-positive redaction in report prose)
- Base64 URL-safe segment matching for JWT body fragments (≥20 chars)

**Caveats acknowledged:**
- Scrubber only protects against values currently in the parent session's bindings map. Once a binding is purged (TTL, session end), historical reports may still contain them. Reports MUST be written before TTL purge — enforced by the pinned-snapshot mechanism above.
- Scrubber is best-effort against ADVERSARIAL obfuscation; a hostile zmora-be can `echo "Token: " | tr 'A-Z' 'a-z'` to evade exact-string match. Threat model: scrubber defends against LLM hallucination/accidental echo, NOT against author-crafted exfil. The corresponding adversary path (malicious plan) is closed at plan-load by §4.3 (no `tr`/`sed` chains can reach a non-/dev/null destination).

### 4.11 Resource caps and quotas (NEW)

Resolves A#6 (unbounded growth) and A#19 (heap dump exposure).

**Per QA run (one Perun session):**
- Max 32 bindings in `bindingsMap.get(perunSessionID)`. 33rd write (`execute_recipe` or `record_input`) returns `{ status: "error", message: "binding cap reached" }`.
- Max 4 KB per binding value.

**Global (plugin process):**
- Max 256 bindings total across all parent sessions. When at cap, oldest expired entries (past TTL, not pinned per §4.10) are evicted first; if still no room, evict LRU across parent sessions (with a coordinator log entry naming the evicted parent ID). Refuse new write only as a last resort.
- Periodic sweep (every 5 min) purges:
  - Entries past TTL (1h)
  - Entries whose parent session no longer exists (verified via `client.session.get`)

**Heap-dump mitigation (A#19):**
- Binding values are wrapped in a `class Secret { value: string }` whose `inspect()` / `toJSON()` return `"[REDACTED]"`. Node `util.inspect` and `JSON.stringify` won't include the value. Doesn't defend against `--inspect` debugger inspection or raw heap dumps, but defends against accidental logging.
- Document `--inspect` and similar flags as contraindicated for QA runs.

## 5. Decisions & rationale

| Decision | Why |
|---|---|
| `shell.env` hook over `DispatchTask.env` | OpenCode SDK's `session.create` body accepts only `{parentID, title}`; no per-session env transport. `shell.env` plugin hook is the **native** primitive for this exact purpose. |
| `AgentConfig.tools` as primary gate, not just runtime hook | `tool.execute.before` hook does NOT receive agent name (B-T2 finding). `AgentConfig.tools: { [name]: boolean }` is OpenCode-native and includes MCP tools (resolves rev1 §8.5 open question + motivating problem #8). |
| `execute_recipe` deterministic tool over LLM-as-executor | Recipe execution must not depend on LLM compliance — A#4 (malicious plan) requires AST-validated execution. `execute_recipe` parses + executes + registers atomically inside plugin; LLM never observes value. Setup-Zmora's LLM context contains only status enums. |
| `record_input` tool with denylist over LLM-direct writes | Mid-run dialog requires deterministic validation of pasted NAME=value pairs; an LLM bypass could let it write `PATH=/tmp` from user input. Tool runs name-denylist + charset validation before `writeBinding`. Closes A#1 attack via user-paste vector. |
| `QA_BIND_*` name prefix (mandatory) | Eliminates A#1 (hostile env name) by construction — `PATH`, `LD_PRELOAD`, `HOME`, etc. cannot be expressed as binding names. Also disambiguates "binding-injected" from "user-exported" env in Zmora's process. |
| Hook scope restricted to `zmora-*` agents | Eliminates A#3 cross-session leak. Bindings cannot reach unrelated chats, even if user runs them in parallel. |
| Recipe command allowlist (no `bash`, `eval`, etc.) | Eliminates A#4 (unsandboxed plan-supplied bash). Plan can still `curl ... \| jq ...` but cannot `curl ... \| bash`. |
| Per-parent-session map, keyed by parentID | Multiple parallel `/run-qa` runs isolated. (B-T6: ID guessability undefined — single-tenant scoping assumed; out-of-scope multi-tenant per §6.) |
| Per-binding SETUP-XX scenario synthesis | Resolves S6 partial-state: each binding has independent dispatch + retry; one failure doesn't block unrelated bindings. |
| Layered NEED_INFO (input-level, not binding-level) | The user knows their email/password, not the JWT. The plan's `Inputs:` declaration drives targeted asks. |
| Mandatory log-scrubber (§4.10) | A#10: prompt discipline alone is insufficient defense; coordinator-side scrubber is the only enforceable layer for "value never echoed". |
| TTL + caps (§4.11) | Bounds A#6 (orphan leak) and limits cost-DoS via crafted plans. 1h TTL is generous for legitimate runs. |
| Inverted env override policy (`shell.env` fills UNSET only) | Restores POLA per A#11. Combined with `QA_BIND_*` namespace, collision is impossible in practice but the policy is principled. |
| Egress allowlist in recipe `Egress:` field | A#12: BE Zmora's `curl` could exfiltrate after binding injection. Pinning egress per-recipe in plan ensures recipe `curl` only hits declared host. |
| Bounded retry (3 dialog rounds; 3 recipe attempts per binding) | A#18 + S5: prevents infinite loops; surfaces issues to user with clear diagnostic. |

## 6. Out of scope

- **Multi-tenant secret storage** — single-user dev / CI runner only. Bindings are isolated by session ID; ID guessability defines the threat boundary (acceptable for current usage).
- **Remote runner support** — local OpenCode server only. Remote runners might not have shell-tool exposure for `shell.env` hook to fire reliably.
- **Binding refresh during long runs** — JWT with 1h TTL is the user's problem if a wave takes >1h. Aligns with TTL purge cycle.
- **`/create-qa-plan` auto-emission of `**Bindings:**`** — out of scope for this design; separate iteration.
- **Encrypted bindings at rest** — bindings live only in plugin process memory; `Secret` wrapper defends against logs/inspect, not against `--inspect` debugger / heap dumps. Document as contraindication.
- **Web-UI / TUI auth-flow integration** — interactive browser-based login not supported; recipes must be CLI-driven.
- **Multi-binding atomic transactions** — bindings register independently; no rollback. Failure isolation is per-binding (§4.7).

## 7. Compatibility

- **Plans without `**Bindings:**` and without `SETUP-*` scenarios** → behave exactly as today. No setup wave runs. Preflight checks shell env; missing vars surface as today's NEED_INFO.
- **Plans with `**Bindings:**`** → setup wave (Wave 0) runs zmora-setup per binding, then test waves.
- **Plans with explicit `SETUP-*` scenarios** (no `**Bindings:**`) → SETUP-* runs as Wave 0 with `zmora-setup` variant. Without `**Bindings:**` declarations, `execute_recipe` cannot be invoked (it requires a parsed binding). These scenarios are limited to non-binding operations (e.g., directory creation, file inspection) using the narrow SETUP_TOOLS allowlist. For binding-producing custom setups, the `setup-tools: extended` opt-in (deferred) is the path.
- **Existing test reports / fix flows** → unaffected.

**Migration:**
- No breaking change for existing plans.
- New plans authored by humans can use the binding feature.
- `/create-qa-plan` retains current behavior; binding-emission is a future enhancement.

**Backward-compat verification step**: regression suite must include a plan WITHOUT `**Bindings:**` to ensure the new wave-0 synthesis is skipped when no bindings declared.

## 8. Open questions (residual, implementation-detail)

Most rev1 open questions are now resolved. The few remaining are implementation-detail:

1. **Log-scrubber regex precision** — exact-string vs partial-segment matching; tune during implementation based on observed false-positives (e.g., scrubbing `[REDACTED]` in a stack trace looks confusing).
2. **`getParentSessionIDCached` perf** — one `client.session.get` per bash call. Cache shape (Map vs WeakMap, eviction) decided during implementation; spec §4.5 mandates the *behavior*, not the data structure.
3. **Recipe-allowlist parser**: AST parser (e.g., `bash-parser`) vs regex pre-check. AST is correct; regex is faster. Decide during implementation; behavioral guarantee is "no `eval`/`bash`/`sh`/`source`/dot-space/forbidden tokens reach execution".

## 9. References

- Transcription source: `2026-05-25` session, plan `2026-05-19-export-pdf-endpoint-test-plan.md` from external project `ineedcv`.
- Prior design: `docs/superpowers/specs/2026-05-25-qa-preflight-and-need-info-design.md`.
- OpenCode SDK: `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:1811-1821` (`SessionCreateData`), `:840-842` (`AgentConfig.tools`), `:465-492` (`Session.parentID`), `:505-510` (`EventSessionDeleted`).
- OpenCode Plugin: `node_modules/@opencode-ai/plugin/dist/index.d.ts:241-247` (`shell.env`), `:234-240` (`tool.execute.before`), `:178-180` (custom tool registration).
- Pattern study: `oh-my-openagent` two-layer tool restriction and task-dependency model.
- Industry patterns synthesised: GitHub Actions outputs/secrets (substitution-before-dispatch + masking), Postman environment envelope (typed key/value), pytest session-scope fixtures (cautionary).
- Review findings: Agent A (security) — 20 findings, 4 CRITICAL; Agent B (technical feasibility) — 10 theses verified; Agent C (consistency) — 8 internal + cross-spec findings; Agent D (UX walkthrough) — 6 scenarios, 7 gaps surfaced.
