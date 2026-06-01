# Codebase Exploration (Triglav)

**Triglav** is a read-only codebase exploration specialist dispatched by the Perun coordinator (typically before planning). It maps structure and finds definitions, references, and patterns, then returns a concise synthesis as message text. Triglav never performs work or modifies files.

## Security model — what "read-only" actually means

The **real** read-only guarantee is OpenCode's **deny-by-default allow-list**: Triglav can only call tools that appear in its allow-list (`src/modules/explore/allowed-tools.ts`). Write, edit, and delegation tools (`Write`, `Edit`, `serena-write`, `dispatch_parallel`) are **not** listed, so they are simply uncallable.

The allow-listed read-only Bash verbs — `Bash(grep:./*)`, `Bash(cat:./*)`, `Bash(head:./*)`, `Bash(tail:./*)`, `Bash(rg:./*)`, `Bash(git --no-pager log:*)`, `Bash(git --no-pager blame:*)` — are a **best-effort rail, not a containment sandbox.** `grep`/`rg`/`cat`/`head`/`tail` are scoped to `./*` and `git` is forced through `--no-pager` (neutralizing the pager / `GIT_EXTERNAL_DIFF` spawn vector), but the `git`/`--no-pager` patterns still accept arbitrary args, so a determined or injected prompt could reach real escape vectors (e.g. `--output`, `rg --pre`, shell redirection). This is knowingly accepted for omo-parity.

> Per project doctrine (AGENTS.md): **Bash token-matching is defense-in-depth, not a security boundary.** Do not rely on Triglav's Bash rail to contain an adversarial prompt — the tool exclusion in the allow-list is the boundary; the Bash filtering only raises the cost of escalation.

This mirrors the in-code note at `src/modules/explore/allowed-tools.ts:1-15`.

## serena-first, with Grep/Glob fallback

Triglav reaches for serena's semantic LSP tools first (`serena_find_symbol`, `serena_find_referencing_symbols`, `serena_get_symbols_overview`, `serena_search_for_pattern`, …) and uses `Grep`/`Glob`/`Read` as peer fallbacks. **Exploration works fully without serena** — when serena is absent, Triglav simply searches with Grep/Glob instead of semantic LSP, just less semantically. There is no broken state: the worst case of a missing or malformed serena config is "no semantic search," never a broken agent (`src/modules/_shared/serena-detect.ts`, now shared by both `triglav` and `Veles - Planner`).

### The degraded-mode warning toast

When serena MCP is **not** detected, Pantheon shows a **one-time** warning toast on the first session (`src/modules/explore/index.ts`, `event` handler):

> Triglav registered but serena MCP not found — exploration runs in degraded mode (Grep/Glob). Install serena for semantic search.

This toast is **advisory, not an error.** Triglav still works — it falls back to Grep/Glob. The toast only appears once per process and is suppressed entirely once serena is configured.

## Installing serena for semantic search

To enable semantic (LSP-backed) exploration, add the serena MCP server to your OpenCode config. For example, in `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "serena": {
      "type": "local",
      "command": ["uvx", "--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server"]
    }
  }
}
```

Detection treats serena as available unless its entry is missing, non-object, or has `"enabled": false`. Restart OpenCode after editing the config; the degraded-mode toast will no longer appear and Triglav will prefer serena's semantic tools.

## Model selection

Triglav is model-configurable via `pantheon.json` (same mechanism as `perun` and `zmora`). See [`configuring-agents.md`](configuring-agents.md) for the file's location, precedence rules, and full schema, and [`eval/playbook.md`](eval/playbook.md) for the manual procedure to compare candidate models for an agent. The key:

```jsonc
{ "agents": { "triglav": { "model": "<providerID>/<modelID>" } } }
```

When `agents.triglav.model` is absent, Triglav inherits OpenCode's session default model — same fallback as Perun and Zmora.

### Why a fast/cheap model fits this role

Triglav's workload is **retrieval + light synthesis**, not deep reasoning:
- Semantic precision is offloaded to serena's deterministic LSP (or Grep/Glob in degraded mode), not the model.
- Perun fires Triglav **up to 4 in parallel** via `dispatch_parallel`, and now also via `dispatch_background` for within-turn overlap. That fan-out makes Triglav the highest-volume specialist in Pantheon — exactly the place where model latency and cost dominate end-to-end UX.
- Reasoning tokens belong in the orchestrator (Perun) that *plans* on Triglav's output, not in the scout that *gathers* it.

This is why the analogous omo `explore` agent is pinned to small/fast models (`gpt-5.4-mini-fast`, `qwen3.5-plus`, `claude-haiku-4-5`) at low temperature with no extended-thinking budget — and the same trade-off applies here.

### Recommended model strings

Practical picks for Triglav, ordered roughly by cost:

| Setting | Notes |
|---|---|
| `opencode/claude-haiku-4-5` | Strong default. Drives serena's LSP tools heavily and synthesizes thoroughly. Billed through the OpenCode subscription rather than per-token Anthropic. |
| `opencode/deepseek-v4-flash-free` | Zero marginal cost. Comparable accuracy in practice; tends to lean on `Grep`/`Glob` rather than serena, which is fine for well-named codebases. |
| `opencode-go/deepseek-v4-flash` | Fast and thorough; subscription-billed via `opencode-go`. |

Slower or weaker fits observed in practice:

- `opencode-go/qwen3.5-plus` — completes correctly but several times slower than the picks above, which negates the parallel-/background-dispatch benefit.
- `github-copilot/gpt-5.4-mini` — tends to skip serena entirely and produce thin, lightly-explored answers; risky under the Delegation Trust Rule (Perun does not re-do a search Triglav has reported on).

If your codebase has poor naming or heavy dynamic dispatch — where Grep is genuinely unreliable — favor a model that drives serena consistently (the Anthropic picks above).
