# Pantheon — Agent Harness

> **Status:** Early / WIP. Migrating from a bundle of OpenCode plugins to a dedicated agent harness. The surface described here is the supported one; legacy plugins remain in the repository but are not documented here.

Pantheon is an OpenCode-based harness for orchestrating AI agents on AppVerk workflows. The harness today provides a coordinator agent that delegates work to specialists, a QA agent for executing test plans, and per-agent model configuration.

## What you get today

- **`@perun`** — the Pantheon coordinator. Primary agent. Delegates work to specialist subagents, computes dispatch waves with dependency awareness, and synthesizes results.
- **`@zmora`** — QA tester. Executes a single QA scenario (FE or BE). Internally split into two subagent variants (`zmora-fe`, `zmora-be`) routed by scenario prefix; users interact with the logical `zmora` name via Perun.
- **`pantheon.json`** — per-agent model configuration. User-global and per-project, closest-wins. See [Configuring agents](#configuring-agents).

The QA workflow is exposed via two slash commands:

- `/create-qa-plan` — analyzes recent changes and generates a structured QA plan.
- `/run-qa` — executes a plan via Perun, dispatching each scenario to the appropriate Zmora variant.

## Installation

Add to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.3.0"
  ]
}
```

Restart OpenCode after installation or any config change.

## Upgrading from v0.2.x

`v0.3.0` renames the QA subagent registry keys:

| Before (v0.2.x) | After (v0.3.0) |
|---|---|
| `qa-tester-fe` | `zmora-fe` |
| `qa-tester-be` | `zmora-be` |

This is a hard rename — there is no compatibility shim, and the loader does not emit a warning when the old keys are present. If your personal `opencode.json` overrides the model for these agents, e.g.:

```json
{
  "agent": {
    "qa-tester-fe": { "model": "anthropic/claude-sonnet-4-6" },
    "qa-tester-be": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

…those entries become inert on upgrade. You have two options:

1. **Rename in place** — change the keys to `agent."zmora-fe".model` and `agent."zmora-be".model`.
2. **Migrate to `pantheon.json`** (recommended) — a single `agents.zmora.model` entry covers both subagent variants:
   ```jsonc
   // ~/.config/opencode/pantheon.json
   {
     "agents": {
       "zmora": { "model": "anthropic/claude-sonnet-4-6" }
     }
   }
   ```

See [`docs/configuring-agents.md`](docs/configuring-agents.md) for the full `pantheon.json` reference.

## Quick start

```text
/create-qa-plan
/run-qa
```

Perun reads the most recent plan from `docs/testing/plans/`, dispatches each FE/BE scenario to the right Zmora variant, and aggregates results into `docs/testing/reports/`.

## Configuring agents

Per-agent model selection lives in `pantheon.json`:

```jsonc
// ~/.config/opencode/pantheon.json
{
  "agents": {
    "perun": { "model": "anthropic/claude-opus-4-7" },
    "zmora": { "model": "anthropic/claude-sonnet-4-6" },
  },
}
```

The full reference (locations, precedence, schema, FAQ) is in [`docs/configuring-agents.md`](docs/configuring-agents.md).

## Documentation

- [`docs/configuring-agents.md`](docs/configuring-agents.md) — per-agent model configuration via `pantheon.json`.
- [`AGENTS.md`](AGENTS.md) — repository contributor guide.

## Repository layout

- `src/agents/` — agent prompts (e.g. `perun.md`).
- `src/modules/coordinator/` — Perun plugin: `dispatch_parallel`, `assign_issue_ids`, `compute_waves` tools.
- `src/modules/qa/` — Zmora plugin (`zmora-fe`, `zmora-be` variants); `/create-qa-plan`, `/run-qa` commands.
- `src/modules/pantheon-config/` — library: `pantheon.json` loader and merge logic.
- `src/hooks/session-notification/` — macOS desktop notifications for session events.
- `packages/*` — legacy workspace plugins still bundled (pending removal as the harness matures).
