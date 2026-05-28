# Triglav: Perun prompt-pipeline render

**Agent:** triglav
**Target codebase:** this repo (`av-opencode-plugins`)

## Query

How is Perun's system prompt assembled from agent metadata? List the exact
files and functions involved and explain the placeholder rendering flow.
Cite file paths.

## Expected coverage

A correct, thorough answer should mention:

- `getPerunPrompt` (in `src/modules/coordinator/index.ts`) — the cached entry
  point
- `buildPerunPrompt` (in `src/modules/agent-registry/perun-prompt-builder.ts`) —
  the renderer
- `getAgentMetadataRegistry` / `registerAgentMetadata` — registry surface
- The four placeholders rendered into `src/agents/perun.md`:
  - `{SPECIALISTS_TABLE}`
  - `{KEY_TRIGGERS}`
  - `{DELEGATION_TABLE}`
  - `{USE_AVOID:<agent>}`
- The metadata-contributing files:
  `src/modules/explore/triglav.metadata.ts`,
  `src/modules/qa/zmora.metadata.ts`,
  `src/modules/agent-registry/fix-auto.metadata.ts`
- The cache: `cachedPerunPrompt` (template loaded + rendered once per
  process)

## Quality signals

- **Format compliance** — the answer should end with a `<results>` block per
  Triglav's prompt skeleton (the prompt template enforces this; failure to
  comply is a strong instruction-following signal).
- **Min depth** — answers under ~2000 chars usually indicate degeneration
  (model emitted only the `<analysis>` preamble and stopped). Real coverage
  of this scenario needs more than that.
- **Citations** — file paths required; `file:line` pairs are a quality
  bonus.
- **Tool usage** — Triglav is designed to drive serena's LSP tools, but on a
  well-named TypeScript codebase Grep/Glob can substitute. A correct answer
  with **zero** exploration tool calls is a red flag (model answered from
  priors — risky under Perun's Delegation Trust Rule).
- **Hallucination check** — every cited file path / symbol should be
  verifiable in the repo. Reject answers that invent paths.

## What this discriminates

Multi-file synthesis across `src/modules/agent-registry/`,
`src/modules/coordinator/`, `src/modules/explore/`, `src/modules/qa/`, and
`src/agents/perun.md`. Good detector for:

- Models that ignore tools and answer from priors (observed:
  `github-copilot/gpt-5.4-mini` used 0–1 tool calls and produced ~2.6k-char
  skeletal answers in our benchmarks).
- Models that produce only the `<analysis>` preamble and stop without
  `<results>` (observed: occasional `opencode/claude-haiku-4-5`
  degenerations at ~800 chars, ~10 s of work — short-circuit failure mode).
- Models with weak instruction-following for the Triglav output skeleton.
- Models too slow to be useful at the high fan-out Triglav runs at
  (observed: `opencode-go/qwen3.5-plus` completes correctly but at roughly
  3× the latency of the other contenders).

This scenario is self-contained and works against the public repo straight
from `git clone` — no external project, no secrets, no MCP setup beyond
serena (optional; Triglav falls back to Grep/Glob if serena is absent).
