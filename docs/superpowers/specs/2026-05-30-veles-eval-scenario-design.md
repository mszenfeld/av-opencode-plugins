# Veles Model-Evaluation Scenario — Design

**Date:** 2026-05-30
**Status:** Approved (design) — pending implementation plan
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
   `{ status, plan_path, fe_count, be_count, setup_prereqs, topic }`. This is a
   gift for scoring — far more deterministic than free text — and is the single
   most load-bearing behaviour (Perun's no-plan flow parses it).
4. **Its domain is web FE/BE flows**, but this repo is a CLI/Node plugin with no
   web app. So *what input we feed Veles* is the pivotal design decision.

### Two Veles-specific landmines for headless eval

- **Side effects.** `docs/testing/plans/` is **not** gitignored (verified), so a
  generated plan dirties the working tree and risks an accidental commit.
  Same-day filenames (`YYYY-MM-DD-<topic>-test-plan.md`) collide across
  iterations. → the harness must capture-then-delete the plan each iteration.
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
| **Purpose** | cheap, deterministic, isolates the Veles model (no triglav in the loop) | production fidelity; triglav deliberately in the loop |
| **Report** | `/tmp` | `/tmp`, never commit (private paths) |

Rationale: mechanical git-resolution (B's only real advantage) is the
least-discriminating part of Veles's job, while B's TS-plugin diff yields
ill-defined "correct" plans. C exercises almost the whole discriminating surface
(FE/BE classification + grounding + Setup inference + scenario generation + JSON
contract) deterministically and public-safely, and isolates the Veles model. D
gives full fidelity when wanted, but is an external dependency, must stay private
(user requirement: must not leak), and re-introduces the triglav confound — so it
is the documented second tier, not the default. Natural workflow: **rank cheaply
on Layer 1, confirm the winner on Layer 2.**

## Privacy guarantee (Layer 2)

User requirement: the real target repo is **private and must not leak anywhere**.
Mechanism already in place and verified via `git check-ignore`:

- `.gitignore` lines 26–27 ignore `docs/eval/scenarios/**/local-*.md` and
  `docs/eval/scenarios/**/private/` — the `**` glob already covers the future
  `veles/` directory.
- Layer 2 scenarios live at `docs/eval/scenarios/veles/local-<name>.md` (or
  outside the repo tree). Reports go to `/tmp`. Neither scenario nor report is
  ever committed. The playbook addendum restates this.

## Files (created / changed)

1. `docs/eval/scenarios/veles/qa-plan-from-diff.md` — **new.** Layer 1 scenario,
   the main deliverable.
2. `docs/eval/scenarios/veles/README.md` — **new.** Mirrors the Triglav README:
   convention, the Layer 2 private recipe, privacy rules, and a Veles entry for
   the cross-agent shape note.
3. `docs/eval/playbook.md` — **edit.** Add a "Evaluating side-effecting agents
   (Veles)" section; add `veles` to the agents enumeration (opening line) and to
   the "Adapting a scenario" section.
4. `docs/eval/scenarios/triglav/README.md` — **small edit.** Add a
   "Veles (planning)" row to the existing cross-agent shape note for
   discoverability.

No separate `TEMPLATE.md`: per the Triglav convention, the Layer 1 scenario *is*
the template that Layer 2 copies and edits.

## Layer 1 scenario content

Header:

```markdown
# Veles: QA plan from a login-feature diff

**Agent:** Veles - Planner
**Target codebase:** this repo (`av-opencode-plugins`) — execution host only;
the diff is embedded in the Query, so Veles does not read this repo's source.
```

### `## Query` (verbatim prompt sent to the agent)

Unambiguous scope (so the model authors directly, never interviews), followed by
a fixed embedded unified diff of a small login feature. Concrete diff to ship
(stable across runs — no `Date.now`/random, no repo dependency):

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
+    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/login`, {
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
+from .db import get_user_by_email           # reads DATABASE_URL
+from .ratelimit import limit                 # 5 requests / minute / IP
+
+router = APIRouter()
+SESSION_SECRET = os.environ["SESSION_SECRET"]
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

The Query instructs: "Generate a QA test plan for the following changes:" + the
diff, with no further scope ambiguity. (Exact prose finalised during
implementation; it must not invite clarifying questions.)

### `## Expected coverage` (verifiable against the saved plan + JSON)

- **Frontmatter** keys present: `source`, `branch`, `base-url`, `detected-tools`.
- **`## Setup`** lists: `SESSION_SECRET` (env), `DATABASE_URL` (db), and a
  base-url / service for the API.
- **FE scenario(s)** reference the `email` and `password` inputs and the
  enabled/disabled `Sign in` submit button; ≥2 edge cases (empty fields keep
  submit disabled; 401 shows the `role="alert"` error).
- **BE scenario(s)** reference `POST /api/login`; 200 + session cookie on valid
  credentials; 401 on invalid; **429 after >5 requests/min**; 400 on missing
  fields; a DB check (user lookup in `users`). ≥2 edge cases.
- **Final message** is the 6-field JSON; `fe_count`/`be_count` match the
  scenarios actually written; `setup_prereqs` echoes the `## Setup` items;
  `plan_path` is under `docs/testing/plans/`; `topic` is a login slug.

### `## Quality signals`

- **JSON contract compliance** — exactly the 6 keys, valid JSON, nothing after
  it. Strongest instruction-following signal (Perun's parse depends on it).
- **Self-consistency** — `fe_count`/`be_count` equal the real scenario count in
  the file; `setup_prereqs` equal the `## Setup` backtick items; `plan_path`
  exists and is non-empty.
- **FE/BE classification** correct (the API is not filed under FE, vice versa).
- **Setup inference** — caught `SESSION_SECRET` / `DATABASE_URL` / base-url from
  the diff.
- **Format compliance** — frontmatter keys + section headers + ≥2 edge cases per
  scenario (per the `qa-plan-authoring` / `test-plan-format` skills).
- **Grounding / no hallucination** — uses real identifiers from the diff
  (`email`, `password`, `/api/login`, `SESSION_SECRET`); does not invent
  endpoints/fields absent from the diff.
- **No-execution discipline** — no source edits, no running the work; only the
  plan markdown is written.
- **Skill usage** — loaded `qa-plan-authoring` (and `test-plan-format`).
- **No interview** — did not call the `question` tool (scope is unambiguous).
- **Depth floor** — a plan with 0 scenarios, or only frontmatter, is degenerate.
  Floor is author judgement (start ~1500 chars or <1 scenario per side); tune
  after the first run, like Triglav's ~2000-char floor.
- **Latency** — record it; Veles is `EXPENSIVE` but not high-fan-out, so latency
  tolerance is higher than Triglav's.

### `## What this discriminates`

- **Breaks the JSON contract** (prose after the JSON, missing/renamed fields,
  invalid JSON) → breaks Perun's parse in production. Primary discriminator.
- **Interview-mode hang** — calls `question` on a clear scope → headless timeout
  (`timeout (interview)`).
- **Starts executing** — edits source / scaffolds the feature instead of
  planning. Veles is a planner.
- **Mis-classifies FE/BE.**
- **Shallow plan** — one vague scenario, no edge cases, ignores rate-limit /
  validation.
- **Self-inconsistent counts** — JSON says `fe_count: 3` but writes 1.
- **Hallucination** — invents endpoints/fields/env not in the diff.
- **(Layer 2 only)** can't resolve a real diff / over-relies on triglav.

## Playbook addendum: "Evaluating side-effecting agents (Veles)"

New section in `docs/eval/playbook.md` covering what differs from the read-only
Triglav procedure:

- **Capture the JSON** — parse the final assistant message as the 6-field JSON.
- **Capture-then-delete the plan** — read `plan_path` relative to `TARGET`,
  store its content in the report, then delete the generated file (because
  `docs/testing/plans/` is not gitignored). Capture+delete after *each* iteration
  so the identical same-day filename is a fresh write next iteration.
- **No-source-edit check** — `git status` in `TARGET`; for Veles a *source* edit
  is a **failure** (distinct from Triglav, where any change is merely flagged).
  The plan file under `docs/testing/plans/` is expected output, not a finding —
  but must still be cleaned up.
- **Interview→timeout caveat** — a `question` call in headless mode never gets an
  answer; record it as a model failure mode, not an environment anomaly.
- **Layer 2 (external target repo)** — run cleanup and `git status` against the
  *target* repo; **never commit the report** (private paths + plan excerpts);
  note that triglav enters the loop as a scoring confound.
- **Verdict vocabulary** — reuse the existing set (`recommend` / `acceptable` /
  `degenerate` / `unreliable` / `not-tested`); for Veles, `degenerate` covers a
  broken JSON contract, 0 scenarios, interview-hang, or sub-floor depth.

Also: add `veles` to the playbook's opening agent enumeration and to the
"Adapting a scenario for your own codebase" section.

## Layer 2 recipe (private real repo)

Documented in the Veles README and the playbook's "Adapting a scenario" section:

1. Copy `qa-plan-from-diff.md` → save as `docs/eval/scenarios/veles/local-<name>.md`
   (gitignored) **or** outside the repo tree (`~/.config/pantheon/eval/…`).
2. Replace `**Target codebase:**` with the private repo's absolute path; replace
   `## Query` with a scope instruction (PR/branch/range) so Veles resolves the
   real diff itself via `git`/`gh`.
3. Author `## Expected coverage` by inspecting the real diff (Claude can help
   generate the list).
4. Run the playbook with the absolute path; report goes to `/tmp`; **never commit
   the scenario or the report.**

## Out of scope

- No automated test framework / CI for the eval (the playbook is deliberately a
  manual, Claude-judgement runbook).
- No committed benchmark report (model selection happens at run time; reports go
  to `/tmp`).
- No `pantheon.json` change here — applying the eventual winning model is a
  one-line edit documented in the playbook, performed after a run.
- An "easy baseline" second Layer 1 scenario is deferred; ship one stress
  scenario first (mirrors how Triglav shipped a single scenario). Revisit if all
  candidates score 100% (playbook Lesson 10).
```

## Open questions for implementation

- Exact `## Query` prose wording (must not invite clarifying questions).
- Final depth-floor number (author judgement; tune after first run).
- Whether the Node benchmark-script extension (JSON capture + plan
  capture/delete) is written inline in the playbook addendum or kept as guidance
  prose — lean toward prose + a minimal snippet, consistent with the existing
  playbook style.
