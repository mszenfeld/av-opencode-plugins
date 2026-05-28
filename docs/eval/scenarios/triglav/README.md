# Triglav evaluation scenarios

Public-safe scenarios that target this repository (`av-opencode-plugins`)
and work out-of-the-box after `git clone`. Used by
[`docs/eval/playbook.md`](../../playbook.md) to compare candidate models for
the Triglav agent.

## What's here

- `prompt-pipeline-render.md` — Multi-file synthesis: how Perun's prompt is
  assembled from per-agent metadata via the placeholder renderer.

(More scenarios may land as we identify failure modes worth a dedicated
test.)

## Writing your own scenario for a private codebase

Do **not** commit scenarios that reference projects outside this repo. Two
safe options:

- Keep your scenario **outside the repo tree** (e.g.
  `~/.config/pantheon/eval/my-scenario.md`) and pass the absolute path to
  the playbook.
- Or keep it **inside the repo tree under a gitignored path**:
  `docs/eval/scenarios/<agent>/local-<name>.md` — the `local-*.md` prefix
  and a `private/` subdirectory under any scenarios folder are both covered
  by `.gitignore`, so they cannot accidentally be `git add`ed.

Workflow:

1. Copy a shipped scenario from this directory as a template.
2. Save the copy at one of the two safe locations above.
3. Edit the following sections:
   - `**Target codebase:**` — absolute path to your repo.
   - `## Query` — your question.
   - `## Expected coverage` — symbols and files Claude can verify by
     inspecting your codebase. Have Claude help generate this list.
   - `## Quality signals` — discriminators that matter for your codebase
     (e.g. a poorly-named codebase may legitimately need serena LSP usage
     as a stronger signal).
   - `## What this discriminates` — the failure modes you want to catch.
4. Run [`docs/eval/playbook.md`](../../playbook.md) with the local path;
   the report goes to `/tmp/` by default.

## Scenario file convention

Section headers are a soft schema — the playbook reads them naturally, no
parser involved:

- `# <Agent>: <short title>` (h1)
- `**Agent:**` / `**Target codebase:**` metadata lines
- `## Query` — verbatim prompt sent to the agent
- `## Expected coverage` — bullet list of symbols / files / phrases the
  answer should mention
- `## Quality signals` — qualitative criteria for grading
  (format / depth / citations / tool usage / hallucination check)
- `## What this discriminates` — failure modes this scenario detects

A scenario is only useful if it can FAIL meaningfully. Always name the
discriminating failure modes in `## What this discriminates` before
shipping a new scenario — if you cannot, the scenario is not yet ready.

## Cross-agent shape note

This README is Triglav-specific, but the convention extends to other agents
in this repo's `docs/eval/scenarios/<agent>/` directories. The section
headers stay the same; the semantics differ:

- **Triglav** (Q&A) — Query in, synthesis out. `## Quality signals`
  evaluates the answer text.
- **Zmora** (execution) — Query is the verbatim QA-scenario block;
  `## Expected coverage` lists the expected pass/fail verdict and critical
  assertions; `## Quality signals` focuses on tool calls (did it actually
  drive the browser / hit the API?).
- **Perun** (orchestration) — Query is a multi-step request; `## Expected
  coverage` names the expected dispatch waves and synthesis points.

The section shape is stable; per-agent quality signals differ.
