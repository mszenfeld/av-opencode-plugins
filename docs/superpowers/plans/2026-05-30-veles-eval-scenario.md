# Veles Model-Evaluation Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, reproducible model-evaluation scenario for the Veles planning agent (plus the playbook/README/gitignore changes needed to run it cleanly and to keep private Layer-2 runs from leaking).

**Architecture:** Pure documentation deliverable under `docs/eval/`. Layer 1 is a self-contained scenario (an embedded login-feature diff) that the existing manual playbook (`docs/eval/playbook.md`) runs against candidate models. Layer 2 is a documented recipe + public template for pointing the same playbook at a private real repo without leaking. No source/TS changes; no test framework — verification is `grep`/`git check-ignore`/structure assertions, plus one optional paid smoke run.

**Tech Stack:** Markdown docs; `git` (`check-ignore`); the existing `docs/eval/playbook.md` runbook and `docs/eval/scenarios/triglav/` as the convention to mirror. The scenario exercises the `qa-plan-authoring` skill (`src/skills/qa/qa-plan-authoring/SKILL.md`) and Veles's JSON contract (`src/modules/plan/veles.md`).

**Spec:** `docs/superpowers/specs/2026-05-30-veles-eval-scenario-design.md`

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `.gitignore` | Make `docs/eval/scenarios/veles/` private-by-default: only the 3 shipped public files are trackable; any mis-named Layer-2 scenario is ignored. | 1 |
| `docs/eval/scenarios/veles/qa-plan-from-diff.md` | Layer 1 scenario — the embedded FE+BE login diff, tiered coverage, gate-then-rank quality signals, discriminators. The main deliverable. | 2 |
| `docs/eval/scenarios/veles/TEMPLATE.md` | Public Layer-2 starting point: scope-instruction Query placeholder + inline privacy reminders. Copied to a gitignored `local-*.md`. | 3 |
| `docs/eval/scenarios/veles/README.md` | Veles scenarios README: convention, Layer-2 private recipe, privacy artifact inventory, the cross-agent shape note (so it is not orphaned on Triglav's README). | 4 |
| `docs/eval/scenarios/triglav/README.md` | Add a "Veles (planning)" row to the existing cross-agent shape note for discoverability. | 5 |
| `docs/eval/playbook.md` | Add the "Evaluating side-effecting agents (Veles)" section (Step-4 + Step-7 carve-outs, capture/delete, mandatory anchor, Layer-2 privacy); add `veles` to the opening enumeration and the "Adapting a scenario" section. | 6 |
| (optional) live run | One anchor-model smoke run to confirm the scenario is well-formed end-to-end and capture/cleanup leaves the tree clean. Paid; gated on user confirmation. | 7 |

Task order matters: **Task 1 (.gitignore) first**, so the public scenario files created in Tasks 2–4 are trackable while mis-named private files are not. Tasks 2–6 are otherwise independent; do them in order for clean commits.

---

### Task 1: `.gitignore` — private-by-default `veles/` scenarios

**Files:**
- Modify: `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/.gitignore`

The existing `.gitignore` already has (near the end):

```
# Local (private) evaluation scenarios — never commit
# Authored copies for non-public codebases live here; the playbook at
# docs/eval/playbook.md treats them as one of two safe locations.
docs/eval/scenarios/**/local-*.md
docs/eval/scenarios/**/private/
```

That protection is **name-convention-only**: a Layer-2 scenario for a private repo that is NOT named `local-*` and NOT under `private/` (e.g. `veles/myrepo.md`) is fully trackable and would leak the private repo's absolute path + scope. This task adds a belt-and-suspenders rule for the `veles/` directory.

- [ ] **Step 1: Write the failing verification and run it**

Run (this is the test — it asserts the desired end state, before the change):

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
echo "should be IGNORED (private, mis-named):"
git check-ignore -v docs/eval/scenarios/veles/myrepo.md || echo "FAIL: not ignored"
echo "should be TRACKABLE (public shipped files):"
for f in qa-plan-from-diff.md TEMPLATE.md README.md; do
  git check-ignore -q docs/eval/scenarios/veles/$f && echo "FAIL: $f is ignored" || echo "OK: $f trackable"
done
```

Expected NOW (before change): first check prints `FAIL: not ignored` (the mis-named private file is trackable — the bug we are fixing). The three public files print `OK: ... trackable`.

- [ ] **Step 2: Add the belt-and-suspenders rule**

Append to `.gitignore`, immediately after the existing `docs/eval/scenarios/**/private/` line:

```
# Veles eval scenarios are private-by-default: only the shipped public files
# under veles/ are trackable. Any other file (a real-repo Layer-2 scenario)
# is ignored even if it lacks the load-bearing `local-` prefix, so a private
# repo's path/scope can never be committed by accident.
docs/eval/scenarios/veles/*
!docs/eval/scenarios/veles/qa-plan-from-diff.md
!docs/eval/scenarios/veles/TEMPLATE.md
!docs/eval/scenarios/veles/README.md
```

- [ ] **Step 3: Run the verification — expect PASS**

Run the same block from Step 1.
Expected NOW (after change): the first check prints a `.gitignore:NN docs/eval/scenarios/veles/*` match line (mis-named file is now IGNORED — no `FAIL`). The three public files still print `OK: ... trackable`. Also confirm the existing local-prefix protection still holds:

```bash
git check-ignore -q docs/eval/scenarios/veles/local-acme.md && echo "OK: local-* ignored" || echo "FAIL"
```
Expected: `OK: local-* ignored`.

- [ ] **Step 4: Commit**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
git add .gitignore
AV_COMMIT_SKILL=1 git commit -m "chore(eval): make veles/ scenarios private-by-default in gitignore

Only the three shipped public files under docs/eval/scenarios/veles/ are
trackable; any other file (a real-repo Layer-2 scenario) is ignored even
without the local- prefix, so a private repo's path/scope cannot be
committed by accident."
```

---

### Task 2: Layer 1 scenario — `qa-plan-from-diff.md`

**Files:**
- Create: `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/docs/eval/scenarios/veles/qa-plan-from-diff.md`

This is the main deliverable: the embedded login-feature diff, written so the `qa-plan-authoring` skill's real Step-5 detection fires (env vars via `os.environ["X"]`, service URL via a literal `http://localhost:PORT`), with tiered (MUST/NICE) coverage and gate-then-rank scoring.

- [ ] **Step 1: Write the failing verification and run it**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
F=docs/eval/scenarios/veles/qa-plan-from-diff.md
for s in '# Veles:' '**Agent:**' '**Target codebase:**' '## Query' '## Expected coverage' '## Quality signals' '## What this discriminates'; do
  grep -qF "$s" "$F" 2>/dev/null && echo "OK: $s" || echo "FAIL: missing $s"
done
echo "detectability fixes:"
grep -qF 'os.environ["DATABASE_URL"]' "$F" 2>/dev/null && echo "OK: DATABASE_URL via os.environ" || echo "FAIL: DATABASE_URL not detectable"
grep -qF 'http://localhost:8000' "$F" 2>/dev/null && echo "OK: literal service URL" || echo "FAIL: no literal URL"
```

Expected NOW (before file exists): every line prints `FAIL`.

- [ ] **Step 2: Create the scenario file with this exact content**

```markdown
# Veles: QA plan from a login-feature diff

**Agent:** Veles - Planner
**Target codebase:** this repo (`av-opencode-plugins`) — execution host only.
The diff is embedded in the Query, so a correct run needs no repo source; any
deep exploration of this repo is wasted effort and a minor negative signal.

> `**Agent:**` is the real registered dispatch name `Veles - Planner` (Triglav's
> is genuinely `triglav`). The casing difference is intentional — the playbook
> does not parse `**Agent:**` programmatically.

## Query

Verbatim prompt sent to the agent (the leading instruction is load-bearing: it
keeps a faithful run from gathering context off the nonexistent repo paths,
dispatching triglav, or asking a clarifying question that would hang a headless
server):

> Generate a QA test plan for the following self-contained changes. The diff
> below is the complete and only change set — plan **only** from it: do not read
> repository source, do not dispatch exploration sub-agents, and do not ask
> clarifying questions. Save the plan and end your turn with the required JSON
> result object.
>
> ````diff
> --- /dev/null
> +++ b/web/src/components/LoginForm.tsx
> @@
> +export function LoginForm() {
> +  const [email, setEmail] = useState("")
> +  const [password, setPassword] = useState("")
> +  const [error, setError] = useState<string | null>(null)
> +  const canSubmit = email.length > 0 && password.length > 0
> +
> +  async function onSubmit() {
> +    // dev API host (matches the backend's local bind)
> +    const res = await fetch("http://localhost:8000/api/login", {
> +      method: "POST",
> +      credentials: "include",
> +      body: JSON.stringify({ email, password }),
> +    })
> +    if (res.status === 401) setError("Invalid email or password")
> +    else if (res.ok) window.location.assign("/dashboard")
> +  }
> +
> +  return (
> +    <form>
> +      <input name="email" value={email} onChange={(e) => setEmail(e.target.value)} />
> +      <input name="password" type="password" value={password}
> +             onChange={(e) => setPassword(e.target.value)} />
> +      {error && <p role="alert">{error}</p>}
> +      <button disabled={!canSubmit} onClick={onSubmit}>Sign in</button>
> +    </form>
> +  )
> +}
> --- /dev/null
> +++ b/api/auth/login.py
> @@
> +import os
> +from fastapi import APIRouter, Response, Request, HTTPException
> +from .db import get_user_by_email
> +from .ratelimit import limit                 # 5 requests / minute / IP
> +
> +router = APIRouter()
> +SESSION_SECRET = os.environ["SESSION_SECRET"]
> +DATABASE_URL = os.environ["DATABASE_URL"]    # postgresql://… user lookup
> +
> +@router.post("/api/login")
> +@limit("5/minute")
> +def login(payload: dict, request: Request, response: Response):
> +    email = payload.get("email")
> +    password = payload.get("password")
> +    if not email or not password:
> +        raise HTTPException(status_code=400, detail="email and password required")
> +    user = get_user_by_email(email)          # SELECT ... FROM users WHERE email = ?
> +    if user is None or not user.verify(password):
> +        raise HTTPException(status_code=401, detail="invalid credentials")
> +    response.set_cookie("session", sign(user.id, SESSION_SECRET), httponly=True, secure=True)
> +    return {"ok": True}
> ````

## Expected coverage

Coverage is **tiered** so partial-coverage models are *ranked*, not pass/failed.
Score MUST items as the ranking backbone; NICE items break ties and reward depth.

**MUST:**

- `## Setup` lists `SESSION_SECRET` and `DATABASE_URL` (both via real
  `os.environ[...]`, so the skill detects them) and the service URL
  `http://localhost:8000` (literal, so Step-5 service detection fires).
- FE scenario references the `email` and `password` inputs and the
  enabled/disabled `Sign in` submit button; ≥2 edge cases (empty fields keep
  submit disabled; a 401 shows the `role="alert"` error).
- BE scenario references `POST /api/login`; 200 + session cookie on valid
  credentials; 401 on invalid; **429 after >5 requests/min**; 400 on missing
  fields. ≥2 edge cases.
- Final message is the 6-field JSON; `fe_count`/`be_count` equal the scenario
  count (see counting rule in Quality signals); `topic` is a login slug;
  `plan_path` exists.

**NICE-TO-HAVE:**

- A DB-state check in the BE scenario (user lookup; the `users` table from the
  SQL comment — do not penalise a check that omits the literal table name).
- Cookie-attribute assertions (`HttpOnly` / `Secure`).
- `detected-tools` frontmatter reflecting the eval host's tools (informational).

**Frontmatter caveat (off-contract input):** the `qa-plan-authoring` skill
derives `source`/`branch` from a git resolution that an embedded diff has no
source for. A faithful model may emit `source: embedded`, omit `branch`, or
improvise — **do not** require literal `source`/`branch` values; grade the
improvisation, not their presence.

## Quality signals

**Scoring model — gate, then rank:**

1. **GATE — JSON contract compliance.** Exactly the 6 keys
   `{ status, plan_path, fe_count, be_count, setup_prereqs, topic }`, valid JSON,
   nothing after it. Binary; failure → `degenerate` (it breaks Perun's parse in
   production). This is the floor, *not* the ranking axis — every capable model
   passes it.
2. **PRIMARY RANKING — plan quality.** Coverage of the MUST edge cases (429, 400,
   401, valid-login cookie, disabled-submit, 401-alert) and FE/BE classification
   correctness. This is where models actually separate.

**Supporting signals (objectively scorable):**

- **Self-consistency** — `fe_count` = number of `### FE-` headings under
  `## FE Test Scenarios`; `be_count` = number of `### BE-` headings under
  `## BE Test Scenarios`; nothing else counts. `setup_prereqs` mirrors the
  `## Setup` backtick items when `## Setup` is present (empty array is valid only
  when `## Setup` is absent — but this diff has env vars, so it must be present).
  `plan_path` exists and is non-empty.
- **Setup inference** — partial credit: 1 point each for `SESSION_SECRET`,
  `DATABASE_URL`, `http://localhost:8000` (3/3 = full).
- **FE/BE classification** correct (the API is not filed under FE, vice versa).
- **Format compliance** — frontmatter + section headers + ≥2 edge cases per
  scenario (the format the `qa-plan-authoring` / `test-plan-format` skills
  enforce — observed from the plan file, not from a skill-load trace).
- **Grounding / no hallucination** — uses real identifiers from the diff
  (`email`, `password`, `/api/login`, `SESSION_SECRET`, `http://localhost:8000`);
  does not invent endpoints/fields absent from the diff.
- **No-execution discipline** — objectively the `git status` no-source-edit check
  (a source edit = failure); not a separate subjective signal.
- **No interview** — did not call the `question` tool.
- **No wasted exploration** — minor negative signal if the model dispatched
  triglav / tried to Read the nonexistent repo paths despite the self-containment
  instruction.

**Degeneration floor (structural, not char-count):** `degenerate` if the plan has
<1 FE scenario, <1 BE scenario, <2 edge cases per scenario, or is missing the
JSON gate. A ~1500-char floor is kept only as a secondary smoke signal and is
explicitly **un-calibrated until the first run** (Triglav's ~2000-char floor was
empirically derived; ours is not yet).

**Variance / determinism:** run **≥2 iterations** per model (provider-default
temperature → FE/BE classification and counts can legitimately vary). Flag
`unreliable` if across iterations the JSON gate pass/fail flips, `fe_count`/
`be_count` differ, or the Setup-inference hit-set differs.

**Latency:** record-only (no threshold). Veles is `EXPENSIVE` and not
high-fan-out, so latency does not gate the verdict for this scenario.

## What this discriminates

- **Shallow / incomplete plan** (misses 429 rate-limit, 400 validation, the
  disabled-submit or 401-alert edge cases) — **the primary discriminator** among
  capable models.
- **Mis-classifies FE/BE.**
- **Breaks the JSON contract** (prose after the JSON, missing/renamed fields,
  invalid JSON) → `degenerate` gate failure (would break Perun's parse).
- **Interview-mode hang** — calls `question` on a clear scope → headless timeout
  (`timeout (interview)`).
- **Starts executing** — edits source / scaffolds the feature instead of
  planning. Veles is a planner.
- **Self-inconsistent counts** — JSON says `fe_count: 3` but writes 1.
- **Hallucination** — invents endpoints/fields/env not in the diff.
- **Wasted exploration** — dispatches triglav / reads nonexistent paths despite
  the self-contained diff.

This scenario is self-contained and runs against the public repo straight from
`git clone` — no external project, no secrets. See the private real-repo path in
`README.md` (Layer 2) for production-fidelity validation.
```

- [ ] **Step 3: Run the verification — expect PASS**

Run the same block from Step 1.
Expected NOW: every line prints `OK` (all sections present; both detectability fixes present).

- [ ] **Step 4: Commit**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
git add docs/eval/scenarios/veles/qa-plan-from-diff.md
AV_COMMIT_SKILL=1 git commit -m "docs(eval): add Veles Layer-1 scenario (QA plan from login diff)

Self-contained embedded FE+BE diff written so the qa-plan-authoring skill's
detection fires; tiered MUST/NICE coverage; gate-then-rank scoring (JSON
contract is the gate, plan quality the ranking signal)."
```

---

### Task 3: Layer 2 public template — `TEMPLATE.md`

**Files:**
- Create: `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/docs/eval/scenarios/veles/TEMPLATE.md`

A public starting point for a private Layer-2 scenario. Its `## Query` is a
scope-instruction placeholder (not an embedded diff), because Layer 1's diff and
Layer 2's scope are different input shapes — copying Layer 1 would mean deleting
its largest block. Contains no private data; safe to commit.

- [ ] **Step 1: Write the failing verification and run it**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
F=docs/eval/scenarios/veles/TEMPLATE.md
for s in '<!-- PRIVATE' '**Target codebase:**' '## Query' '## Expected coverage' '## Quality signals' '## What this discriminates' 'local-'; do
  grep -qF "$s" "$F" 2>/dev/null && echo "OK: $s" || echo "FAIL: missing $s"
done
```

Expected NOW: every line prints `FAIL`.

- [ ] **Step 2: Create the template with this exact content**

```markdown
<!-- PRIVATE-BY-DEFAULT TEMPLATE — read before use.
     1. Copy this file to docs/eval/scenarios/veles/local-<name>.md (gitignored)
        OR to a path OUTSIDE this repo tree (e.g. ~/.config/pantheon/eval/).
        The `local-` prefix is load-bearing for privacy; do not drop it.
     2. Fill the placeholders below for your PRIVATE repo.
     3. The /tmp report this produces is SENSITIVE (private code excerpts +
        absolute paths). chmod 0600, delete after use, NEVER commit it.
     Delete this comment block in your local copy if you wish. -->

# Veles: QA plan — <short title of your private feature>

**Agent:** Veles - Planner
**Target codebase:** /absolute/path/to/your/private/repo
<!-- Prefer a DISPOSABLE git worktree / throwaway clone so a leftover plan,
     serena cache, or dirtied tree never touches your canonical checkout. -->

## Query

Verbatim prompt sent to the agent. Unlike Layer 1 (which embeds a diff), give a
real scope so Veles resolves the diff itself via git/gh:

> Generate a QA test plan for <PR #N | branch feature/xyz | last N commits |
> the diff of <SHA1>...<SHA2>>. Default diff source: open PR on the current
> branch, else branch diff vs main. Save the plan and end with the required JSON
> result object.

## Expected coverage

Author this by inspecting the REAL diff (Claude can help generate the list).
Tier it MUST vs NICE-TO-HAVE so partial-coverage models are ranked, not
pass/failed:

**MUST:**

- `## Setup` lists <the env vars / service URLs / DB strings the diff introduces>.
- FE scenario references <the real changed components / fields / buttons>; ≥2
  edge cases.
- BE scenario references <the real endpoints / methods / status codes>; ≥2 edge
  cases.
- Final message is the 6-field JSON; counts match the file; `plan_path` exists.

**NICE-TO-HAVE:**

- <deeper assertions specific to your diff>

## Quality signals

Reuse the gate-then-rank model from `qa-plan-from-diff.md`: JSON contract is the
GATE (failure → `degenerate`); plan quality (MUST coverage + FE/BE
classification) is the PRIMARY ranking signal. Counting rule, self-consistency,
no-interview, no-execution, ≥2 iterations, latency record-only — all as in the
Layer-1 scenario. NOTE: at Layer 2, triglav enters the loop (Veles explores the
real repo) — treat it as both a scoring confound and a leakage channel.

## What this discriminates

Name the failure modes your real diff is good at catching (see
`qa-plan-from-diff.md` for the canonical list). A scenario is only useful if it
can FAIL meaningfully — if you cannot name a discriminating failure mode, the
scenario is not ready.
```

- [ ] **Step 3: Run the verification — expect PASS**

Run the same block from Step 1. Expected: every line prints `OK`. Also confirm it is trackable (public): `git check-ignore -q docs/eval/scenarios/veles/TEMPLATE.md && echo FAIL || echo OK`. Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
git add docs/eval/scenarios/veles/TEMPLATE.md
AV_COMMIT_SKILL=1 git commit -m "docs(eval): add public Layer-2 template for private Veles scenarios

Scope-instruction Query placeholder (not an embedded diff) plus inline
privacy reminders; copied to a gitignored local-*.md for real private repos."
```

---

### Task 4: Veles scenarios README — `README.md`

**Files:**
- Create: `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/docs/eval/scenarios/veles/README.md`

Mirrors `docs/eval/scenarios/triglav/README.md`: convention, the Layer-2 private
recipe, the privacy artifact inventory, and the cross-agent shape note (carried
here too so it is not orphaned if Triglav's README is the only host).

- [ ] **Step 1: Write the failing verification and run it**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
F=docs/eval/scenarios/veles/README.md
for s in 'Veles evaluation scenarios' 'qa-plan-from-diff.md' 'Layer 2' 'disposable' 'sessionID' '/tmp' 'Cross-agent' 'Veles (planning)'; do
  grep -qF "$s" "$F" 2>/dev/null && echo "OK: $s" || echo "FAIL: missing $s"
done
```

Expected NOW: every line prints `FAIL`.

- [ ] **Step 2: Create the README with this exact content**

```markdown
# Veles evaluation scenarios

Scenarios for picking the best model for the **Veles** planning agent, run via
[`docs/eval/playbook.md`](../../playbook.md). Veles is a *side-effecting* agent
(it writes a plan file and returns a JSON contract), so the playbook's
"Evaluating side-effecting agents (Veles)" section applies — read it before a run.

## What's here

- `qa-plan-from-diff.md` — **Layer 1**, public, self-contained. An embedded
  login-feature diff (1 FE + 1 BE file). The reproducible discriminator for
  ranking candidate models; runs straight from `git clone`, isolates the Veles
  model (the diff is self-contained, so triglav stays out of the loop).
- `TEMPLATE.md` — public starting point for **Layer 2** (a private real repo).
  Copy it to a gitignored `local-*.md` and fill in your repo.

## Two-layer workflow

1. **Layer 1 — rank cheaply.** Run `qa-plan-from-diff.md` against your candidate
   models. Deterministic, public, isolates the Veles model.
2. **Layer 2 — confirm on real code.** Validate the winner against a real
   **private** repo. Higher fidelity (Veles resolves a real diff; triglav enters
   the loop), but never reproducible-in-repo and must not leak.

## Layer 2 recipe (private real repo)

1. Copy `TEMPLATE.md` → save as `local-<name>.md` here (gitignored) **or** outside
   the repo tree (`~/.config/pantheon/eval/…`). The `local-` prefix is load-bearing
   for privacy; a `.gitignore` belt-and-suspenders rule also ignores any other
   non-shipped file under `veles/`, but prefer `local-` or an out-of-tree path.
2. Set `**Target codebase:**` to the private repo's absolute path — ideally a
   **disposable git worktree / throwaway clone**, so a leftover plan, serena
   cache, or dirtied tree never touches your canonical checkout.
3. Set `## Query` to a real scope (PR/branch/range) so Veles resolves the diff
   itself via `git`/`gh`.
4. Author `## Expected coverage` by inspecting the real diff (Claude can help).
5. Run the playbook with the absolute path.

## Privacy — every Layer-2 artifact is sensitive

Do **not** commit a Layer-2 scenario or its report. Each of these can embed the
private repo's absolute path and/or private code excerpts and must be cleaned:

| Artifact | Handling |
|---|---|
| scenario file | gitignored `local-*` / outside tree |
| `/tmp` report (embeds the plan body + sub-agent excerpts + path/SHA) | `chmod 0600`, delete after use; record a non-identifying target label, not the abs path |
| `/tmp/oc_eval_server_$PORT.log`, `/tmp/oc_eval_$PORT.mjs` | delete (playbook Step 7) — both embed the private path |
| OpenCode session store | delete by captured `sessionID` (not title-prefix); verify |
| target repo `.serena/cache/` | a private repo may not gitignore `.serena/` — surface it, do not auto-whitelist |
| dispatched triglav output | treat citations/excerpts of private files as private |

## Scenario file convention

Section headers are a soft schema (the playbook reads them naturally, no parser):

- `# Veles: <short title>` (h1)
- `**Agent:**` / `**Target codebase:**` metadata lines
- `## Query` — verbatim prompt sent to the agent
- `## Expected coverage` — tiered MUST / NICE-TO-HAVE
- `## Quality signals` — gate-then-rank + supporting signals
- `## What this discriminates` — failure modes this scenario detects

A scenario is only useful if it can FAIL meaningfully. Always name the
discriminating failure modes before shipping a new scenario.

## Cross-agent shape note

The convention is shared across `docs/eval/scenarios/<agent>/`; the semantics
differ per agent:

- **Triglav** (Q&A) — Query in, synthesis out; quality signals grade the answer
  text.
- **Zmora** (execution) — Query is the verbatim QA-scenario block; coverage is
  the expected pass/fail verdict; quality signals focus on tool calls.
- **Perun** (orchestration) — Query is a multi-step request; coverage names the
  expected dispatch waves and synthesis points.
- **Veles (planning)** — Query is a diff (Layer 1) or a real scope (Layer 2);
  coverage lists the plan sections + scenario topics the plan must contain;
  quality signals are gate-then-rank: the JSON contract is the GATE, plan quality
  the PRIMARY ranking signal, plus self-consistency (counts match the file),
  FE/BE classification, and no-execution / no-interview discipline.
```

- [ ] **Step 3: Run the verification — expect PASS**

Run the same block from Step 1. Expected: every line prints `OK`.

- [ ] **Step 4: Commit**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
git add docs/eval/scenarios/veles/README.md
AV_COMMIT_SKILL=1 git commit -m "docs(eval): add Veles scenarios README (convention, Layer-2 recipe, privacy)

Mirrors the Triglav README; documents the private real-repo recipe, the full
Layer-2 leakage inventory, and the cross-agent shape note with a Veles row."
```

---

### Task 5: Triglav README — add the Veles cross-agent row

**Files:**
- Modify: `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/docs/eval/scenarios/triglav/README.md`

The "Cross-agent shape note" at the end of the Triglav README enumerates
Triglav / Zmora / Perun but not Veles. Add a Veles bullet for discoverability.

- [ ] **Step 1: Write the failing verification and run it**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
grep -qF '**Veles** (planning)' docs/eval/scenarios/triglav/README.md && echo "OK" || echo "FAIL: no Veles row"
```

Expected NOW: `FAIL: no Veles row`.

- [ ] **Step 2: Add the Veles bullet to the cross-agent note**

In `docs/eval/scenarios/triglav/README.md`, find the bullet list under
"## Cross-agent shape note" that currently ends with the `- **Perun**
(orchestration) — …` item. Insert this new bullet immediately after the Perun
bullet (use the Edit tool; match the Perun bullet's exact text as `old_string`
and append the Veles bullet):

```markdown
- **Veles** (planning) — Query is a diff (Layer 1) or a real scope (Layer 2);
  `## Expected coverage` lists the plan sections + scenario topics the plan must
  contain; `## Quality signals` are gate-then-rank (the JSON contract is the
  GATE, plan quality the primary ranking signal). See
  [`../veles/README.md`](../veles/README.md).
```

- [ ] **Step 3: Run the verification — expect PASS**

Run the Step-1 command. Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
git add docs/eval/scenarios/triglav/README.md
AV_COMMIT_SKILL=1 git commit -m "docs(eval): add Veles row to the cross-agent shape note"
```

---

### Task 6: Playbook addendum + enumeration

**Files:**
- Modify: `/Users/mef1st0/Projects/AppVerk/av-opencode-plugins/docs/eval/playbook.md`

Three edits: (a) add `veles` to the opening agent enumeration; (b) insert the
"Evaluating side-effecting agents (Veles)" section (which amends Steps 4 and 7);
(c) point the "Adapting a scenario" section at Veles too.

- [ ] **Step 1: Write the failing verification and run it**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
F=docs/eval/playbook.md
grep -qE '\(`triglav`, `zmora`, `perun`, `veles`\)' "$F" && echo "OK: enumeration" || echo "FAIL: enumeration"
grep -qF '## Evaluating side-effecting agents (Veles)' "$F" && echo "OK: section" || echo "FAIL: section"
grep -qF 'Step 4 carve-out' "$F" && echo "OK: step4 carve-out" || echo "FAIL: step4"
grep -qF 'Step 7 carve-out' "$F" && echo "OK: step7 carve-out" || echo "FAIL: step7"
grep -qF 'Anchor run is MANDATORY for Veles' "$F" && echo "OK: anchor" || echo "FAIL: anchor"
```

Expected NOW: every line prints `FAIL`.

- [ ] **Step 2a: Edit the opening enumeration**

Use the Edit tool. The file currently opens (lines ~3-5):

> Manual procedure for evaluating which model best fits a given Pantheon agent
> (`triglav`, `zmora`, `perun`). No CI, no automation, no framework — Claude Code

Replace `(`triglav`, `zmora`, `perun`)` with `(`triglav`, `zmora`, `perun`, `veles`)`.

- [ ] **Step 2b: Insert the side-effecting-agents section**

Use the Edit tool. Insert the following new section **between** the end of
`### Step 7 — Cleanup` and the `## Lessons learned` heading. Match the
`## Lessons learned` line as `old_string` and prepend the new section + a blank
line before it:

```markdown
## Evaluating side-effecting agents (Veles)

Veles is not read-only: it **writes a QA plan** to `docs/testing/plans/`, may
**dispatch triglav**, and ends with a 6-field JSON contract
`{ status, plan_path, fe_count, be_count, setup_prereqs, topic }`. The procedure
above mostly applies, with these amendments. (Scenario: `scenarios/veles/`.)

- **Step 4 carve-out (scoring).** Veles has no `<results>` block — its structural
  skeleton is the JSON contract (6 keys, valid JSON, nothing after it) plus the
  plan's frontmatter/section/edge-case format. The JSON contract is a **gate**
  (failure → `degenerate`), NOT the ranking axis; rank by **plan quality** (MUST
  edge-case coverage + FE/BE classification), not by coverage-substring count.
  The depth floor is structural (≥1 FE + ≥1 BE scenario, ≥2 edge cases each), not
  the Triglav ~2000-char figure.
- **Step 7 carve-out (cleanup).** Step 7's blanket "any change is unexpected"
  does NOT apply to Veles: the plan under `docs/testing/plans/` is *expected*
  output — capture-then-delete it. Only a **source** edit is a finding. Scope the
  `.serena/cache/` whitelist to repos that actually gitignore it; for a Layer-2
  private target, surface `.serena/` writes rather than auto-whitelisting.
- **Capture the JSON.** Parse the final assistant message as the 6-field JSON.
- **Capture-then-delete the plan, on a guaranteed path.** Read `plan_path`
  relative to `TARGET`, store its content in the report, then delete the file in
  a `finally`/trap **and** from the SIGINT/SIGTERM `cleanup()` handler so a crash
  cannot leave a leftover. Capture+delete after *each* iteration; run candidates
  **strictly serially** against a target (the plan dir is shared mutable state).
  End the run with a `git status` gate: if anything under `docs/testing/plans/`
  remains, stop and require manual deletion before any commit.
- **Session cleanup by `sessionID`.** Delete the spawned session(s) by the
  captured ID (Steps 3/6 capture it), not by fragile title-prefix match; verify.
- **Interview → timeout caveat.** A `question` call in headless mode never gets
  an answer; record `timeout (interview)` as a model failure mode, not an
  environment anomaly.
- **Anchor run is MANDATORY for Veles** (not "recommended"). Veles has more
  environmental surface than read-only Triglav (file writes, capture/delete,
  possible sub-agent dispatch), so the Step-5 anchor (`opencode/claude-haiku-4-5`)
  is the contemporaneous control that separates a weak model from a cold serena
  cache / throttled provider / environmental interview-hang.
- **Layer 2 (private external target).** Run against a **disposable worktree /
  throwaway clone** of the private repo; run cleanup and `git status` against
  *that* target; treat the report, `/tmp` log, `/tmp` script, session store, and
  serena cache as sensitive; **never commit the report**; record a
  non-identifying target label in the report header instead of the absolute path;
  note triglav is both a scoring confound and a leakage channel.

Minimal Node-script extension (add to the Step-3 skeleton): after the turn is
`done`, parse the final assistant text as JSON, read the file at `plan_path`
relative to `TARGET`, capture its content into the report, then delete it — and
register that delete in the `cleanup()` handler so a crash also removes it:

```javascript
import { rmSync } from "node:fs"
import { join } from "node:path"

let lastPlanPath  // absolute, set after each iteration

const cleanup = () => {
  try { if (lastPlanPath) rmSync(lastPlanPath, { force: true }) } catch {}
  try { process.kill(SERVER_PID) } catch {}
  process.exit(130)
}
process.on("SIGINT", cleanup)
process.on("SIGTERM", cleanup)

// ...after outcome === "done", from the captured final assistant text:
const json = JSON.parse(finalText.slice(finalText.lastIndexOf("{")))
if (json.plan_path) {
  lastPlanPath = join(TARGET, json.plan_path)
  // read + store lastPlanPath content into the report here, then:
  try { rmSync(lastPlanPath, { force: true }) } finally { lastPlanPath = undefined }
}
```
```

- [ ] **Step 2c: Edit the "Adapting a scenario" section**

Use the Edit tool. In the `## Adapting a scenario for your own codebase` section
(near the end), the canonical guide points only at the Triglav README. Add a
Veles pointer. Match the existing sentence that references
`scenarios/triglav/README.md` as `old_string` and append:

> For Veles (a side-effecting planning agent), see
> [`scenarios/veles/README.md`](scenarios/veles/README.md) for the Layer-2
> private-repo recipe and the side-effect/privacy handling above.

- [ ] **Step 3: Run the verification — expect PASS**

Run the Step-1 block. Expected: every line prints `OK`.

- [ ] **Step 4: Commit**

```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
git add docs/eval/playbook.md
AV_COMMIT_SKILL=1 git commit -m "docs(eval): playbook support for side-effecting agents (Veles)

Adds the 'Evaluating side-effecting agents (Veles)' section amending Step 4
(gate-then-rank, no <results> block) and Step 7 (plan is expected output);
capture-then-delete on a guaranteed path; mandatory anchor; Layer-2 privacy.
Adds veles to the opening enumeration and the 'Adapting a scenario' section."
```

---

### Task 7 (OPTIONAL): One-anchor smoke run

**Files:** none (a live run; produces only `/tmp` artifacts).

This validates the scenario end-to-end: that a real Veles run authors a plan,
emits the JSON contract, and that capture-then-delete leaves the repo clean. It
costs a real billable LLM turn and needs `opencode` in PATH. **Gate on explicit
user confirmation** (playbook Cost section).

- [ ] **Step 1: Confirm with the user before spending tokens**

Surface the cost estimate (1 model × 1 iteration, opus/haiku-class) and ask for
go/no-go. If no-go, skip Task 7 entirely — the deliverable is complete without it.

- [ ] **Step 2: Run the playbook once with the anchor model**

Follow `docs/eval/playbook.md` Steps 1–3 against
`docs/eval/scenarios/veles/qa-plan-from-diff.md` with a single candidate
`opencode/claude-haiku-4-5` (the anchor), iterations = 1, `TARGET` = this repo.

- [ ] **Step 3: Verify the run and the cleanup**

Expected:
- The final assistant message parses as the 6-field JSON with `status: "ok"`.
- A plan existed at `plan_path` during the run and its content was captured.
- After capture-then-delete: `git status --short` is clean (nothing left under
  `docs/testing/plans/`), and no source files changed.

Run:
```bash
cd /Users/mef1st0/Projects/AppVerk/av-opencode-plugins
git status --short
```
Expected: empty output (clean tree). If anything under `docs/testing/plans/`
remains, the capture-delete gate failed — delete it and fix the script before
relying on the scenario.

- [ ] **Step 4: No commit** — `/tmp` report is not committed (it may contain repo
  excerpts). Note the run's outcome in the conversation only.

---

## Notes for the implementer

- **No source/TS changes.** This is a docs-only deliverable; do not touch
  `src/`, `tests/`, `dist/`, or `bunfig.toml`. No `bun`/`tsup`/`vitest` step is
  required (the existing test suite does not cover `docs/eval/`).
- **Commit hook.** This repo blocks `git commit` unless `AV_COMMIT_SKILL=1` is in
  the command (used in every commit step above). Do not add `Co-Authored-By`.
- **Markdown-in-markdown.** Tasks 2–4 embed code/diff fences inside the file
  content. When writing the files, reproduce the fences exactly (the Layer-1
  `## Query` deliberately uses a four-backtick ` ````diff ` fence inside a
  blockquote so the diff renders without breaking the surrounding block).
- **`base-url` vs env detection.** The literal `http://localhost:8000` in the
  diff is what makes the service URL detectable by the skill's Step-5 regex; do
  not "improve" it back to an `import.meta.env`/interpolated form, or the
  scenario becomes unfair (the spec's review found this).
```
