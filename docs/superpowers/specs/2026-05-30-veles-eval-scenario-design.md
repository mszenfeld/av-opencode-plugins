# Veles Model-Evaluation Scenario — Design

**Date:** 2026-05-30
**Status:** Approved (design), revised after MoA review — pending implementation plan
**Author:** brainstorming session (Claude + Marian)

## Goal

Give the Pantheon eval framework a way to pick the best model for **Veles**
(the planning specialist), the same way `docs/eval/scenarios/triglav/` does for
Triglav. The deliverable is a **scenario** (plus the small playbook/README
changes needed to run it cleanly), not a benchmark run — model selection is
performed later by running `docs/eval/playbook.md` against this scenario.

## Why Veles is not Triglav (the core constraint)

Triglav is a read-only Q&A agent: query in, synthesised text out, scored from
the answer text. Veles is fundamentally different and that difference drives the
whole design:

1. **It writes a file.** Veles saves a QA plan to `docs/testing/plans/` and does
   not edit source. Each eval iteration therefore has a side effect.
2. **It can dispatch sub-agents.** Veles may dispatch `triglav` for exploration,
   which makes triglav's model a scoring confound if it enters the loop.
3. **It returns a structured JSON contract** as its final message:
   `{ status, plan_path, fe_count, be_count, setup_prereqs, topic }`. This is the
   compliance GATE for scoring (Perun's no-plan flow parses it) — not the primary
   ranking signal; see "Scoring model" below.
4. **Its domain is web FE/BE flows**, but this repo is a CLI/Node plugin with no
   web app. So *what input we feed Veles* is the pivotal design decision.

### Two Veles-specific landmines for headless eval

- **Side effects + leak risk.** `docs/testing/plans/` is **not** gitignored
  (verified), so a generated plan dirties the working tree and risks an
  accidental commit. Same-day filenames (`YYYY-MM-DD-<topic>-test-plan.md`)
  collide across iterations. The harness must capture-then-delete the plan each
  iteration **on a guaranteed path** (`finally`/trap + SIGINT/SIGTERM handler),
  end every run with a `git status` gate, and **never run candidates in parallel
  against the same target** (the plan dir is shared mutable state). For Layer 2
  this is sharpened: a leftover plan would embed *private* code — see Privacy.
- **Interview-mode hang.** If the model calls the `question` tool on an
  ambiguous scope, it waits forever in a non-interactive server → timeout. The
  scenario must give an unambiguous scope, and "asked instead of authoring" is a
  named failure mode (`timeout (interview)`), not an environment issue.

## Decision: layered design (input strategy)

Input-strategy options considered: (A) prose feature description, (B) real git
range in *this* repo, (C) embedded fictional web diff in the prompt, (D) real
external repo. Chosen: **layered C + D**, mirroring how Triglav ships one public
scenario and documents private ones.

| | Layer 1 — *discriminator for ranking* | Layer 2 — *validation on real code* |
|---|---|---|
| **Input** | embedded diff (1 FE + 1 BE file) in `## Query` | scope (PR/branch/range) of a real **private** repo |
| **Repo status** | shipped, public, committed | **not committed** (`local-*.md` / outside tree) |
| **Purpose** | cheap, deterministic; *designed to* isolate the Veles model | production fidelity; triglav deliberately in the loop |
| **Report** | `/tmp` | `/tmp`, sensitive (private excerpts), never commit |

Rationale: mechanical git-resolution (B's only real advantage) is the
least-discriminating part of Veles's job, while B's TS-plugin diff yields
ill-defined "correct" plans. C exercises almost the whole discriminating surface
(FE/BE classification + grounding + Setup inference + scenario generation + JSON
contract) deterministically and public-safely, and — because the diff is
self-contained and the Query forbids exploration — should keep triglav out of the
loop (this is enforced by the Query instruction, not merely hoped; see Layer 1
`## Query`). D gives full fidelity when wanted, but is an external dependency,
must stay private (user requirement: must not leak), and re-introduces the
triglav confound — so it is the documented second tier, not the default. Natural
workflow: **rank cheaply on Layer 1, confirm the winner on Layer 2.**

## Privacy guarantee (Layer 2)

User requirement: the real target repo is **private and must not leak anywhere**.
This is broader than "don't commit the scenario" — every Layer-2 artifact below
can embed private absolute paths and/or private code excerpts and must be treated
as sensitive.

**Git-tracking protection (verified via `git check-ignore`):**

- `.gitignore` ignores `docs/eval/scenarios/**/local-*.md` and
  `docs/eval/scenarios/**/private/` — the `**` glob already covers the future
  `veles/` directory. **This protection is name-convention-only:** a copied
  scenario that is NOT named `local-*` and NOT under `private/` (e.g.
  `veles/myrepo.md`) is fully trackable. The `local-` prefix is therefore
  *load-bearing*; the recipe must state this, and we add a belt-and-suspenders
  rule (see Files) so only the two shipped public files are trackable under
  `veles/`.
- `docs/testing/plans/` is **not** ignored → the capture-then-delete gate
  (above) is what keeps a private-derived plan out of git.

**Full Layer-2 artifact inventory (all sensitive, all must be cleaned):**

| Artifact | Leak | Handling |
|---|---|---|
| scenario file | private abs path + scope in `**Target codebase:**`/`## Query` | gitignored `local-*` / outside tree |
| `/tmp` report | embeds private plan body + sub-agent excerpts + target path/SHA in header | mode-0600, delete after use; record a non-identifying target label, not the abs path |
| `/tmp/oc_eval_server_$PORT.log` | OpenCode startup + indexed file paths from the private tree | delete (playbook Step 7) |
| `/tmp/oc_eval_$PORT.mjs` | `TARGET`/cwd = private abs path | delete (playbook Step 7) |
| OpenCode session store | the prompt scope + assistant responses | delete by captured `sessionID` (not fragile title-prefix match), verify deletion |
| target repo `.serena/cache/` | serena cache derived from private code | a private target may NOT gitignore `.serena/`; do not auto-whitelist — surface it |
| dispatched triglav output | citations/excerpts of private files flow into the plan and report | treat all sub-agent output as private |

**Strongest isolation for Layer 2:** run the eval against a **disposable git
worktree or throwaway clone** of the private repo, so any leftover plan / serena
cache / dirtied tree never touches the canonical checkout, and teardown is
`rm -rf` of the throwaway.

## Files (created / changed)

1. `docs/eval/scenarios/veles/qa-plan-from-diff.md` — **new.** Layer 1 scenario,
   the main deliverable.
2. `docs/eval/scenarios/veles/TEMPLATE.md` — **new, public.** A Layer-2 starting
   point whose `## Query` is a *scope-instruction placeholder* (not an embedded
   diff), because Layer 1's diff and Layer 2's scope are different input shapes —
   copying Layer 1 would mean deleting its largest block. Carries the privacy
   reminders inline. (No private data; safe to commit.)
3. `docs/eval/scenarios/veles/README.md` — **new.** Mirrors the Triglav README:
   convention, the Layer 2 private recipe, privacy rules, and a Veles entry for
   the cross-agent shape note (so the note is not orphaned on Triglav's README).
4. `docs/eval/playbook.md` — **edit.** Add a "Evaluating side-effecting agents
   (Veles)" section (incl. the Step-4 and Step-7 carve-outs below); add `veles`
   to the agents enumeration (opening line) and to the "Adapting a scenario"
   section.
5. `docs/eval/scenarios/triglav/README.md` — **small edit.** Add a
   "Veles (planning)" row to the existing cross-agent shape note.
6. `.gitignore` — **edit.** Belt-and-suspenders: under
   `docs/eval/scenarios/veles/`, ignore everything except the shipped public
   files (`qa-plan-from-diff.md`, `TEMPLATE.md`, `README.md`), so a mis-named
   Layer-2 scenario cannot be tracked. (Implementation finalises the exact
   pattern; intent is "private-by-default in `veles/`".)

## Layer 1 scenario content

Header:

```markdown
# Veles: QA plan from a login-feature diff

**Agent:** Veles - Planner
**Target codebase:** this repo (`av-opencode-plugins`) — execution host only.
The diff is embedded in the Query, so a correct run needs no repo source; any
deep exploration of this repo is wasted effort and a minor negative signal.
```

(`**Agent:**` uses the real registered dispatch name `Veles - Planner`; Triglav's
is genuinely `triglav`. The casing difference is intentional, not a schema break —
the playbook does not parse `**Agent:**` programmatically.)

### `## Query` (verbatim prompt sent to the agent)

Unambiguous scope (so the model authors directly, never interviews) **and an
explicit self-containment instruction** so a faithful run does not gather context
from the (nonexistent) repo paths or dispatch triglav:

> "Generate a QA test plan for the following self-contained changes. The diff
> below is the complete and only change set — plan **only** from it; do not read
> repository source, do not dispatch exploration sub-agents, and do not ask
> clarifying questions."

Followed by a fixed embedded unified diff (stable across runs — no
`Date.now`/random, no repo dependency). The diff is written so the
`qa-plan-authoring` skill's actual Step-5 detection patterns fire (env vars via
`os.environ["X"]`; service URL via a literal `http://localhost:PORT`):

```diff
--- /dev/null
+++ b/web/src/components/LoginForm.tsx
@@
+export function LoginForm() {
+  const [email, setEmail] = useState("")
+  const [password, setPassword] = useState("")
+  const [error, setError] = useState<string | null>(null)
+  const canSubmit = email.length > 0 && password.length > 0
+
+  async function onSubmit() {
+    // dev API host (matches the backend's local bind)
+    const res = await fetch("http://localhost:8000/api/login", {
+      method: "POST",
+      credentials: "include",
+      body: JSON.stringify({ email, password }),
+    })
+    if (res.status === 401) setError("Invalid email or password")
+    else if (res.ok) window.location.assign("/dashboard")
+  }
+
+  return (
+    <form>
+      <input name="email" value={email} onChange={(e) => setEmail(e.target.value)} />
+      <input name="password" type="password" value={password}
+             onChange={(e) => setPassword(e.target.value)} />
+      {error && <p role="alert">{error}</p>}
+      <button disabled={!canSubmit} onClick={onSubmit}>Sign in</button>
+    </form>
+  )
+}
--- /dev/null
+++ b/api/auth/login.py
@@
+import os
+from fastapi import APIRouter, Response, Request, HTTPException
+from .db import get_user_by_email
+from .ratelimit import limit                 # 5 requests / minute / IP
+
+router = APIRouter()
+SESSION_SECRET = os.environ["SESSION_SECRET"]
+DATABASE_URL = os.environ["DATABASE_URL"]    # postgresql://… user lookup
+
+@router.post("/api/login")
+@limit("5/minute")
+def login(payload: dict, request: Request, response: Response):
+    email = payload.get("email")
+    password = payload.get("password")
+    if not email or not password:
+        raise HTTPException(status_code=400, detail="email and password required")
+    user = get_user_by_email(email)          # SELECT ... FROM users WHERE email = ?
+    if user is None or not user.verify(password):
+        raise HTTPException(status_code=401, detail="invalid credentials")
+    response.set_cookie("session", sign(user.id, SESSION_SECRET), httponly=True, secure=True)
+    return {"ok": True}
```

(Exact prose finalised during implementation; it must not invite clarifying
questions and must keep the self-containment instruction above.)

### `## Expected coverage` (tiered: MUST vs NICE-TO-HAVE)

Coverage is **tiered** so partial-coverage models are *ranked*, not pass/failed
(avoids the binary 100%-or-0% trap). A grader scores MUST items as the ranking
backbone; NICE items break ties and reward depth.

**MUST:**

- **`## Setup`** lists `SESSION_SECRET` and `DATABASE_URL` (both via real
  `os.environ[...]`, so the skill detects them) and the service URL
  `http://localhost:8000` (literal, so Step-5 service detection fires).
- **FE scenario** references the `email` and `password` inputs and the
  enabled/disabled `Sign in` submit button; ≥2 edge cases (empty fields keep
  submit disabled; 401 shows the `role="alert"` error).
- **BE scenario** references `POST /api/login`; 200 + session cookie on valid
  credentials; 401 on invalid; **429 after >5 requests/min**; 400 on missing
  fields. ≥2 edge cases.
- **Final message** is the 6-field JSON; `fe_count`/`be_count` equal the scenario
  count (counting rule below); `topic` is a login slug; `plan_path` exists.

**NICE-TO-HAVE:**

- A DB-state check in the BE scenario (user lookup; the `users` table from the
  SQL comment — do not penalise a check that omits the literal table name).
- Cookie-attribute assertions (`HttpOnly`/`Secure`).
- `detected-tools` frontmatter reflecting the eval host's tools (informational).

**Frontmatter caveat (off-contract input):** the skill derives `source`/`branch`
from a git resolution that an embedded diff has no source for. A faithful model
may emit `source: embedded` / omit `branch`, or improvise — **do not** require
literal `source`/`branch` values; grade the improvisation, not their presence.

### `## Quality signals`

**Scoring model — gate, then rank:**

1. **GATE — JSON contract compliance.** Exactly the 6 keys, valid JSON, nothing
   after it. Binary; failure → `degenerate` (it breaks Perun's parse in
   production). This is the floor, *not* the ranking axis — every capable model
   passes it, so it cannot rank the field.
2. **PRIMARY RANKING — plan quality.** Coverage of the MUST edge cases (429, 400,
   401, valid-login cookie, disabled-submit, 401-alert) and FE/BE classification
   correctness. This is where models actually separate.

**Supporting signals (objectively scorable):**

- **Self-consistency** — `fe_count` = number of `### FE-` headings under
  `## FE Test Scenarios`; `be_count` = number of `### BE-` headings under
  `## BE Test Scenarios`; nothing else counts. `setup_prereqs` mirrors the
  `## Setup` backtick items *when `## Setup` is present* (empty array is valid
  only when `## Setup` is absent — but this diff has env vars, so it must be
  present). `plan_path` exists and is non-empty.
- **Setup inference** — scored as partial credit: 1 point each for
  `SESSION_SECRET`, `DATABASE_URL`, `http://localhost:8000` (3/3 = full).
- **FE/BE classification** correct (the API is not filed under FE, vice versa).
- **Format compliance** — frontmatter + section headers + ≥2 edge cases per
  scenario (the format the `qa-plan-authoring` / `test-plan-format` skills
  enforce — observed from the plan file, not from a skill-load trace).
- **Grounding / no hallucination** — uses real identifiers from the diff
  (`email`, `password`, `/api/login`, `SESSION_SECRET`, `http://localhost:8000`);
  does not invent endpoints/fields absent from the diff.
- **No-execution discipline** — objectively the `git status` no-source-edit check
  in the addendum (a source edit = failure); not a separate subjective signal.
- **No interview** — did not call the `question` tool.
- **No wasted exploration** — minor negative signal if the model dispatched
  triglav / tried to Read the nonexistent repo paths despite the self-containment
  instruction.

**Degeneration floor (structural, not char-count):** a plan is `degenerate` if it
has <1 FE scenario, <1 BE scenario, or <2 edge cases per scenario, or is missing
the JSON gate. A char-count floor (~1500) is kept only as a secondary smoke
signal and is explicitly **un-calibrated until the first run** (Triglav's
~2000-char floor was empirically derived; ours is not yet).

**Variance / determinism:** run **≥2 iterations** per model (provider-default
temperature → FE/BE classification and counts can legitimately vary). Flag
`unreliable` if across iterations: the JSON gate pass/fail flips, `fe_count`/
`be_count` differ, or the Setup-inference hit-set differs.

**Latency:** record-only (no threshold). Veles is `EXPENSIVE` and not
high-fan-out, so latency does not gate the verdict for this scenario.

### `## What this discriminates`

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
- **(Layer 2 only)** can't resolve a real diff / over-relies on triglav.

## Playbook addendum: "Evaluating side-effecting agents (Veles)"

New section in `docs/eval/playbook.md` covering what differs from the read-only
Triglav procedure. It must explicitly **amend the canonical Triglav-specific
steps**, not just add new prose:

- **Step 4 carve-out (scoring).** Veles has no `<results>` block — its structural
  skeleton is the 6-field JSON gate + the plan's frontmatter/section/edge-case
  format. The depth floor is structural (per the scenario), not the Triglav
  ~2000-char figure. Ranking is plan quality, not coverage-substring count.
- **Step 7 carve-out (cleanup).** Step 7's blanket "any change is unexpected"
  does **not** apply to Veles: the plan under `docs/testing/plans/` is *expected*
  output (capture-then-delete it); only a **source** edit is a finding. Scope the
  `.serena/cache/` whitelist to repos that actually gitignore it — for a Layer-2
  private target, surface `.serena/` writes rather than auto-whitelisting.
- **Capture the JSON** — parse the final assistant message as the 6-field JSON.
- **Capture-then-delete the plan, on a guaranteed path** — read `plan_path`
  relative to `TARGET`, store its content in the report, then delete the file in
  a `finally`/trap **and** from the SIGINT/SIGTERM `cleanup()` handler (so a
  crash/`Ctrl-C` cannot leave a leftover). Capture+delete after *each* iteration;
  **run candidates strictly serially** against a target (shared plan dir). End
  the run with a `git status` gate: if anything under `docs/testing/plans/`
  remains, stop and require manual deletion before any commit.
- **Session cleanup by `sessionID`** — delete the spawned session(s) by captured
  ID (Step 3/6 already capture it), not by fragile title-prefix match; verify.
- **Interview→timeout caveat** — a `question` call in headless mode never gets an
  answer; record it as a model failure mode, not an environment anomaly.
- **Anchor run is MANDATORY for Veles** (not "recommended"). Because Veles has
  more environmental surface than read-only Triglav (file writes, capture/delete,
  possible sub-agent dispatch), the playbook Step-5 anchor (`claude-haiku-4-5`)
  is the contemporaneous control that distinguishes a weak model from a cold
  serena cache / throttled provider / environmental interview-hang. A trivial
  FE-only "easy baseline" scenario remains a near-term follow-up, but the
  mandatory anchor covers the environmental-control need now.
- **Layer 2 (private external target).** Run against a **disposable worktree /
  throwaway clone** of the private repo; run cleanup and `git status` against
  *that* target; treat the report + `/tmp` log + script + session store + serena
  cache as sensitive (see Privacy inventory); **never commit the report**; record
  a non-identifying target label in the report header instead of the abs path;
  note triglav enters the loop as both a scoring confound and a leakage channel.
- **Verdict vocabulary** — reuse the existing set (`recommend` / `acceptable` /
  `degenerate` / `unreliable` / `not-tested`); for Veles, `degenerate` covers a
  broken JSON gate, <1 scenario per side, <2 edge cases per scenario, or
  interview-hang.

Also: add `veles` to the playbook's opening agent enumeration and to the
"Adapting a scenario for your own codebase" section.

## Layer 2 recipe (private real repo)

Documented in the Veles README and the playbook's "Adapting a scenario" section:

1. Copy **`TEMPLATE.md`** (whose `## Query` is already a scope placeholder) →
   save as `docs/eval/scenarios/veles/local-<name>.md` (gitignored) **or** outside
   the repo tree (`~/.config/pantheon/eval/…`). The `local-` prefix is
   load-bearing for privacy — a differently-named file under `veles/` is also
   covered by the belt-and-suspenders `.gitignore` rule, but do not rely on it;
   prefer `local-` or an out-of-tree path.
2. Set `**Target codebase:**` to the private repo's absolute path (ideally a
   disposable worktree/clone, see addendum); set `## Query` to a scope instruction
   (PR/branch/range) so Veles resolves the real diff itself via `git`/`gh`.
3. Author `## Expected coverage` by inspecting the real diff (Claude can help
   generate the MUST/NICE list).
4. Run the playbook with the absolute path; report goes to `/tmp` and is itself
   **sensitive** (private code excerpts + paths) — mode-0600, delete after use;
   **never commit the scenario or the report.**

## Out of scope

- No automated test framework / CI for the eval (the playbook is deliberately a
  manual, Claude-judgement runbook).
- No committed benchmark report (model selection happens at run time; reports go
  to `/tmp`).
- No `pantheon.json` change here — applying the eventual winning model is a
  one-line edit documented in the playbook, performed after a run.
- A second "easy baseline" Layer 1 scenario is deferred as a near-term
  follow-up; the **mandatory anchor run** (above) is the environmental control in
  the meantime, so this deferral no longer leaves the stress scenario without a
  control.
- No change to the `qa-plan-authoring` skill's detection patterns (e.g. adding
  `import.meta.env` support) — the Layer 1 diff is written to fit the *current*
  patterns instead.

## In scope (pulled in from review)

- The minimal Node benchmark-script extension (JSON capture + guaranteed plan
  capture/delete) is **in scope** — a Veles run is not executable without it. It
  ships as prose + a minimal snippet in the playbook addendum, consistent with
  the existing playbook style.

## Open questions for implementation

- Exact `## Query` prose wording (must keep the self-containment instruction and
  not invite clarifying questions).
- The exact `.gitignore` pattern for the `veles/`-private-by-default rule
  (ignore-all-then-negate the three public files vs. an explicit allowlist).

## Revision history

- **2026-05-30 (initial):** layered C+D design approved in brainstorming.
- **2026-05-30 (MoA review):** revised after a sequential-thinking + 4-agent
  mixture review (methodology / privacy / technical / consistency). Changes:
  - Diff rewritten so the skill's real Step-5 detection fires (`DATABASE_URL` via
    `os.environ`, literal `http://localhost:8000`); `import.meta.env`/comment-only
    detections removed.
  - `## Expected coverage` tiered MUST/NICE; `source`/`branch` frontmatter no
    longer required (off-contract for an embedded diff).
  - Scoring reframed: JSON contract is a **gate**, plan quality is the **primary
    ranking** signal; scenario-counting rule pinned to `### FE-`/`### BE-`
    headings; Setup inference scored as partial credit; depth floor made
    structural; variance rule + ≥2 iterations added; latency record-only.
  - Isolation made enforced via an explicit self-containment instruction in
    `## Query` (was an unenforced claim).
  - Privacy hardened: full Layer-2 artifact inventory; report itself sensitive;
    `.gitignore` belt-and-suspenders for `veles/`; sessionID-based cleanup;
    `.serena` scoping; disposable worktree/clone for Layer 2; capture-delete on a
    guaranteed (`finally`/trap + SIGINT) path with a `git status` gate.
  - Playbook addendum now explicitly amends Step 4 and Step 7 (not just adds a
    section); anchor run made mandatory for Veles.
  - Added a public `TEMPLATE.md` (Layer-2 scope-placeholder) instead of pretending
    Layer 1 is a light-edit template.
  - Node-script extension moved from "open question" to "in scope".
