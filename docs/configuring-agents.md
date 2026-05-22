# Configuring Pantheon Agents

Pantheon agents (Perun, Zmora) can be assigned specific Anthropic models via a `pantheon.json` configuration file. This document is the canonical reference for that file.

## TL;DR

Create `~/.config/opencode/pantheon.json`:

```jsonc
{
  "agents": {
    "perun": { "model": "anthropic/claude-opus-4-7" },
    "zmora": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

Restart OpenCode. Perun will run on Opus, Zmora on Sonnet.

## Where the file lives

Pantheon looks in two places, in this order:

1. **User-global:** `~/.config/opencode/pantheon.json` — applies to every project.
2. **Per-project walk-up:** starting at the current working directory, Pantheon checks each ancestor for `<dir>/.opencode/pantheon.json`, walking upward and **stopping at your home directory**. The closest file wins.

### Closest wins (per agent)

If both files exist, they are merged per agent name. The **closer** file's entry replaces the user-global entry for the same agent — but agents only present in the user-global file are still applied.

Example:

```jsonc
// ~/.config/opencode/pantheon.json (user-global)
{
  "agents": {
    "perun": { "model": "anthropic/claude-opus-4-7" },
    "zmora": { "model": "anthropic/claude-haiku-4-5-20251001" }
  }
}
```

```jsonc
// /my-project/.opencode/pantheon.json (project-local)
{
  "agents": {
    "zmora": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

Effective configuration when running inside `/my-project`:

| Agent | Model | Source |
|---|---|---|
| `perun` | `anthropic/claude-opus-4-7` | user-global |
| `zmora` | `anthropic/claude-sonnet-4-6` | project-local (overrides user-global) |

## Available agents

| Pantheon key | Registered as | Description |
|---|---|---|
| `perun` | `Perun - Coordinator` (primary) | The coordinator. Delegates work to specialists. |
| `zmora` | `zmora-fe` + `zmora-be` (subagents) | QA tester. Both variants share the same model — set once via `zmora`. |

> Internal variants of Zmora (`zmora-fe`, `zmora-be`) are subagents dispatched by Perun. They are not user-facing, but the model you set under `zmora` applies to both.

## Schema

```typescript
{
  "agents": {
    [agentName: string]: {
      "model": string  // "<providerID>/<modelID>", e.g. "anthropic/claude-opus-4-7"
    }
  }
}
```

Model strings follow OpenCode's native convention: `<providerID>/<modelID>` (exactly one slash). The same value you would put in `opencode.json` `agent.<name>.model`.

JSONC support: comments (`//` and `/* */`) and trailing commas are allowed.

## Precedence vs. `opencode.json`

OpenCode resolves an agent's effective model from several layers:

1. OpenCode built-in default (`config.model`)
2. **`pantheon.json` via the Pantheon plugin** ← this file
3. User-supplied `agent.<name>.model` in `opencode.json` ← **highest**

If you set the same agent's model in both `pantheon.json` and `opencode.json`, `opencode.json` wins. This is by design — `pantheon.json` is an opinionated layer, not a hard override.

## When no config exists

Pantheon falls back to OpenCode's default model. The first time you open a session after starting OpenCode without `pantheon.json`, you'll see a one-time TUI toast:

> **Pantheon** — pantheon.json not found — using default models

If your `pantheon.json` exists but fails to parse, you'll see a warning toast instead. Check the OpenCode console output for the specific parse error.

## Restart required

Changes to `pantheon.json` only take effect after restarting OpenCode. There is no hot-reload in the current version.

## FAQ

**Q: What model strings are valid?**
A: Anything in the form `<providerID>/<modelID>` with exactly one slash. Examples:
- `anthropic/claude-opus-4-7`
- `anthropic/claude-sonnet-4-6`
- `anthropic/claude-haiku-4-5-20251001`

**Q: I set `agent.zmora.model` in `opencode.json` but it's not used. Why?**
A: The OpenCode registry key is `zmora-fe` / `zmora-be`, not `zmora`. The `zmora` key only exists inside `pantheon.json` as the logical agent name. To override in `opencode.json`, set `agent."zmora-fe".model` and `agent."zmora-be".model` separately.

**Q: I added a section like `dispatch` or `logging` to `pantheon.json`. What happens?**
A: The current loader ignores unknown top-level sections (with a debug log). Future Pantheon versions may add such sections — your file is forward-compatible.

**Q: The walk-up scares me. Will Pantheon read configs from outside my home directory?**
A: No. The walk stops at your home directory. If your `cwd` is outside `$HOME` entirely (uncommon), the walk continues to the filesystem root — in that case, audit the paths it would visit before adding any sensitive content.

## See also

- [Spec — Pantheon Per-Agent Model Configuration](superpowers/specs/2026-05-22-pantheon-per-agent-model-design.md)
- `AGENTS.md` — repository contributor guide
