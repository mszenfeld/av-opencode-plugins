# Configuring Pantheon Agents

Pantheon agents Perun and Zmora can be assigned specific Anthropic models via a `pantheon.json` configuration file. This document is the canonical reference for that file. (Triglav is also a registered agent but is **not** model-configurable via `pantheon.json` — see [Available agents](#available-agents).)

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

| Pantheon key | Registered as | Description | Model-configurable? |
|---|---|---|---|
| `perun` | `Perun - Coordinator` (primary) | The coordinator. Delegates work to specialists. | Yes — via `pantheon.json` |
| `zmora` | `zmora-fe` + `zmora-be` + `zmora-setup` (subagents) | QA tester. Three internal variants (`zmora-fe`, `zmora-be`, `zmora-setup`) share the same model — set once via `zmora`. | Yes — via `pantheon.json` |
| `triglav` | `triglav` (subagent) | Read-only codebase explorer. | No — model is fixed / inherited |

> Internal variants of Zmora (`zmora-fe`, `zmora-be`, `zmora-setup`) are subagents dispatched by Perun. They are not user-facing, but the model you set under `zmora` applies to all three.

> **Triglav is not model-configurable via `pantheon.json`.** Unlike `perun` and `zmora`, the explore plugin does not read a `triglav` model entry from `pantheon.json`, so adding one has no effect — its model is fixed / inherited from OpenCode's default. The `triglav` key is included above for completeness as a registered agent, not as a configurable one.

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

Model strings follow OpenCode's native convention: `<providerID>/<modelID>`. Aggregator providers like OpenRouter use a three-segment form (`openrouter/openai/gpt-5.5`), and that is accepted too. The same value you would put in `opencode.json` `agent.<name>.model`.

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

If your `pantheon.json` exists but fails to parse, you'll see a warning toast instead. The toast contains a short summary; the full diagnostic (every malformed file, parse offset, and invalid field) is written to the OpenCode console via `console.error` — check the terminal where OpenCode is running.

## Restart required

Changes to `pantheon.json` only take effect after restarting OpenCode. There is no hot-reload in the current version.
