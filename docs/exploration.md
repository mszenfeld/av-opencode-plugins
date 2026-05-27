# Codebase Exploration (Triglav)

**Triglav** is a read-only codebase exploration specialist dispatched by the Perun coordinator (typically before planning). It maps structure and finds definitions, references, and patterns, then returns a concise synthesis as message text. Triglav never performs work or modifies files.

## Security model — what "read-only" actually means

The **real** read-only guarantee is OpenCode's **deny-by-default allow-list**: Triglav can only call tools that appear in its allow-list (`src/modules/explore/allowed-tools.ts`). Write, edit, and delegation tools (`Write`, `Edit`, `serena-write`, `dispatch_parallel`) are **not** listed, so they are simply uncallable.

The allow-listed read-only Bash verbs — `Bash(grep:*)`, `Bash(cat:./*)`, `Bash(head:./*)`, `Bash(tail:./*)`, `Bash(rg:*)`, `Bash(git log:*)`, `Bash(git blame:*)` — are a **best-effort rail, not a containment sandbox.** The `:*` patterns accept arbitrary args, so a determined or injected prompt could reach real escape vectors (e.g. `git log` pager / `GIT_EXTERNAL_DIFF` / `--output`, `rg --pre`, shell redirection). This is knowingly accepted for omo-parity.

> Per project doctrine (AGENTS.md): **Bash token-matching is defense-in-depth, not a security boundary.** Do not rely on Triglav's Bash rail to contain an adversarial prompt — the tool exclusion in the allow-list is the boundary; the Bash filtering only raises the cost of escalation.

This mirrors the in-code note at `src/modules/explore/allowed-tools.ts:1-9`.

## serena-first, with Grep/Glob fallback

Triglav reaches for serena's semantic LSP tools first (`serena_find_symbol`, `serena_find_referencing_symbols`, `serena_get_symbols_overview`, `serena_search_for_pattern`, …) and uses `Grep`/`Glob`/`Read` as peer fallbacks. **Exploration works fully without serena** — when serena is absent, Triglav simply searches with Grep/Glob instead of semantic LSP, just less semantically. There is no broken state: the worst case of a missing or malformed serena config is "no semantic search," never a broken agent (`src/modules/explore/serena-detect.ts`).

### The degraded-mode warning toast

When serena MCP is **not** detected, Pantheon shows a **one-time** warning toast on the first session (`src/modules/explore/index.ts:25-39`):

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
