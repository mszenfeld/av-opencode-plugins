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
| OpenCode session store | delete by captured `sessionID` (more precise than the playbook's title-prefix sweep); verify |
| target repo `.serena/cache/` | unlike the eval host (where `.serena/` is gitignored noise), a private repo may not ignore it — surface it, don't auto-whitelist |
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
