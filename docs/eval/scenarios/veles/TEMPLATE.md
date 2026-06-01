<!-- PRIVATE-BY-DEFAULT TEMPLATE — read before use.
     1. Copy this file to docs/eval/scenarios/veles/local-<name>.md (gitignored)
        OR to a path OUTSIDE this repo tree (e.g. ~/.config/pantheon/eval/).
        Within veles/ a blanket .gitignore rule already ignores any new file
        regardless of name, but the `local-` prefix is still good practice
        (and is the load-bearing protection in other scenario directories).
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

> Generate a QA test plan for YOUR_SCOPE — a PR number (`PR #123`), a branch
> (`feature/xyz`), `last N commits`, or a commit range (`SHA1...SHA2`). Default
> diff source: open PR on the current branch, else branch diff vs main. Save the
> plan and end with the required JSON result object.

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
