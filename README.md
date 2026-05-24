<p align="center">
  <img src="docs/assets/image.png" alt="" width="280" />
  <br />
  <img src="docs/assets/text.png" alt="Pantheon — AI Harness" width="380" />
</p>

<p align="center">
  <em>An OpenCode-based harness for orchestrating AI agents.</em>
</p>

---

Pantheon provides a coordinator agent that delegates work to specialists, a QA agent for executing test plans, and per-agent model configuration.

## Primary agents

- **Perun** — the coordinator. Delegates work to specialists, computes dispatch waves with dependency awareness, and synthesizes results.

## Subagents

- **Zmora** — QA tester. Executes FE and BE test scenarios on demand, dispatched by Perun.

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
