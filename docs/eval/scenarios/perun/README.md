# Perun evaluation scenarios

Public-safe scenarios for picking the best model for the **Perun** coordinator
agent, run via [`docs/eval/playbook.md`](../../playbook.md). They target this
repository (`av-opencode-plugins`) and run out-of-the-box after `git clone`.

Perun is the **coordinator** (the orchestration role, per the cross-agent shape
note in the triglav/veles READMEs): it decomposes a request into dispatch waves,
delegates each wave to a specialist (Veles to plan, Zmora to execute, Triglav to
explore), and synthesises the results. It does **not** run git, read source, or
load skills itself — that work belongs to the specialists. A coordinator-policy
bash gate enforces this at runtime and rejects forbidden commands with a
`COORDINATOR_POLICY_VIOLATION` marker that surfaces in the assistant message's
`info.error` (which the playbook reads via the SDK).

## What's here

- `role-discipline.md` — does a candidate model **stay in-role (delegate)** or
  **try to do the work itself**? The discriminator the whole policy layer was
  built around (the Kimi-K2.6 "do it myself" failure mode). The headline signal
  is the count of `COORDINATOR_POLICY_VIOLATION` markers in `info.error`.

(More scenarios may land as we identify failure modes worth a dedicated test.)

## How it's run

Run [`docs/eval/playbook.md`](../../playbook.md) with the agent under test set
to `perun` and the scenario path. The playbook spins up an isolated headless
`opencode serve`, sends the `## Query` verbatim, and reads the SDK message data
(including `info.error`) to score against `## Quality signals` — it does not read
app logs. The report goes to `/tmp/` by default.

## Scenario file convention

Section headers are a soft schema (the playbook reads them naturally, no parser):

- `# <Agent>: <short title>` (h1)
- `**Agent:**` / `**Target codebase:**` metadata lines
- `## Query` — verbatim prompt sent to the agent
- `## Expected coverage` — tiered MUST / NICE-TO-HAVE
- `## Quality signals` — gate-then-rank + supporting signals
- `## What this discriminates` — failure modes this scenario detects

A scenario is only useful if it can FAIL meaningfully. Always name the
discriminating failure modes before shipping a new scenario. The convention is
shared across `docs/eval/scenarios/<agent>/`; see the cross-agent shape note in
[`../veles/README.md`](../veles/README.md) for the per-agent semantics.
