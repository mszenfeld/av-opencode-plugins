# Configuring Pantheon Agents

Pantheon agents Perun, Zmora, Triglav, and Veles can be assigned specific models via a `pantheon.json` configuration file. This document is the canonical reference for that file.

## TL;DR

Create `~/.config/opencode/pantheon.json`:

```jsonc
{
  "agents": {
    "perun":   { "model": "anthropic/claude-opus-4-7" },
    "zmora":   { "model": "anthropic/claude-sonnet-4-6" },
    "triglav": { "model": "opencode/claude-haiku-4-5" },
    "veles":   { "model": "anthropic/claude-opus-4-7" }
  }
}
```

Restart OpenCode. Perun will run on Opus, Zmora on Sonnet, Triglav on Haiku (subscription-routed), Veles on Opus.

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
| `triglav` | `triglav` (subagent) | Read-only codebase explorer. Dispatched up to 4× in parallel (and now in the background) — favor fast/cheap models. | Yes — via `pantheon.json` |
| `veles` | `Veles - Planner` (mode `all`) | Planning specialist. Authors QA test plans (and other work plans) from a diff or request; dispatches read-only helpers. `EXPENSIVE` — inherits the session default model when `agents.veles.model` is unset. | Yes — via `pantheon.json` |

> Internal variants of Zmora (`zmora-fe`, `zmora-be`, `zmora-setup`) are subagents dispatched by Perun. They are not user-facing, but the model you set under `zmora` applies to all three.

> **Triglav model defaults.** When `agents.triglav.model` is not set, Triglav inherits OpenCode's session default model (same pattern as `perun`/`zmora`). Because Triglav is dispatched many-in-parallel and in the background, a fast/cheap model is the natural choice — for example `opencode/claude-haiku-4-5` (subscription) or `opencode/deepseek-v4-flash-free` (zero marginal cost). The OpenCode-subscription provider prefix `opencode/<modelID>` lets you route through the subscription rather than per-token Anthropic billing.

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
