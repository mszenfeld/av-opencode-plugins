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
  `http://localhost:8000` (a literal localhost URL, so the `qa-plan-authoring`
  skill's service-URL detection fires).
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
