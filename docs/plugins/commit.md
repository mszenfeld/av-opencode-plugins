# Commit Plugin

The AppVerk commit plugin adds an OpenCode-native commit workflow with policy enforcement. It is an **absorbed module** that lives directly inside the root package (`src/modules/commit/`) — not a separate workspace under `packages/`. See [AGENTS.md → "Adding a New Absorbed Module"](../../AGENTS.md#adding-a-new-absorbed-module) for the project-wide pattern.

## Install

1. Add the AppVerk root plugin bundle to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.2.8"]
}
```

2. Restart OpenCode. The root AppVerk plugin bundle registers `/commit` automatically.

## Prompt Source

- The `/commit` prompt source lives in `src/commands/commit.md`.
- The build copies it to `dist/commands/commit.md`.
- The content is based on the Claude marketplace `commit` command and adapted to use `av_commit` instead of raw bash commits.

## Project Structure

The commit plugin is an **absorbed module** — its source, tests, and command asset all live in the root package alongside `src/index.ts`. There is no `packages/commit/` workspace; it was absorbed in commit `c2be151` ("refactor: absorb commit workspace into src/modules/commit").

| Path | Role |
|------|------|
| `src/modules/commit/index.ts` | Plugin factory (`AppVerkCommitPlugin`); registers the `av_commit` tool and the `/commit` command. |
| `src/modules/commit/bash-policy.ts` | `classifyBashCommand` workflow rail — blocks raw `git commit` / `git push` through the bash tool. |
| `src/modules/commit/controlled-commit.ts` | Implements the `av_commit` tool (stage selected files, run `git commit` with the supplied message). |
| `src/modules/commit/message-policy.ts` | Validates commit messages (Conventional Commits, rejects `Co-Authored-By` footers). |
| `src/commands/commit.md` | The `/commit` prompt template. Copied to `dist/commands/commit.md` by `scripts/copy-root-assets.mjs`. |
| `dist/modules/commit/*.js` | Build output produced by `tsup --config tsup.root.config.ts`. |
| `tests/modules/commit/*.ts` | Unit and integration tests, run via the root `npm run test`. |
| `src/index.ts` | Root entrypoint; imports `AppVerkCommitPlugin` from `./modules/commit/index.js` and registers it in `defaultPluginFactories`. |

Because there is no per-workspace build script, the commit module builds and tests via the **root** `npm run build:root` / `npm run test`.

## Usage

- Run `/commit` to create a commit for the current repository changes.
- Run `/commit AV-42` to append `Refs: AV-42` to the final message.

## Behavior

- Registers `/commit` through the plugin `config` hook.
- Overwrites any existing `commit` command definition with the AppVerk workflow.
- Loads the command template from the packaged markdown asset when available, with a source fallback in development.
- Blocks direct `git commit` through the `bash` tool.
- Blocks `git push` through the `bash` tool.
- Rejects `Co-Authored-By` footers.
- Stages the selected files passed to `av_commit`, or all changes when no file list is provided.

## Limitations

- Repository hooks still run and can reject the commit.
- If the plugin fails to load, `/commit` will not be available.

### `classifyBashCommand` is defense-in-depth, not a security boundary

The `tool.execute.before` bash gate in `src/modules/commit/bash-policy.ts` (`classifyBashCommand`) is a **workflow rail / defense-in-depth** layer, not a hardened security boundary. Its job is to backstop a forgetful or weakly prompt-injected agent so the `/commit` flow (Conventional Commits, no `Co-Authored-By` footers, no auto-push) stays consistent — it is **not** the last line of defense against a fully compromised agent, which already has far worse primitives available through the bash tool (e.g. `curl … | bash`, reading `~/.ssh`).

The classifier only matches the literal token `git`. Known bypass shapes that the gate does **not** catch:

- Absolute path: `/usr/bin/git commit -m x`
- Shell wrapper: `bash -c "git commit -m x"`
- Alternative front-ends: `hub commit`
- Shell builtins: `command git commit`
- Alias indirection (user-defined `g`, `gc`, etc.)
- Command substitution: `$(echo git) commit`
- Git plumbing subcommands: `commit-tree`, `fast-import`, `update-ref`

This matches the project doctrine in [`docs/plugins/coordinator.md`](./coordinator.md):

> Treat code-enforced rules as the security boundary. The LLM-requested rules are defense in depth — they raise the cost of a successful prompt-injection escalation but are not the last line of defense.

`classifyBashCommand` is a code-enforced *workflow* rail (it deterministically blocks the most common shape: `git commit …` / `git push …`), but the asset it protects is workflow consistency, not secrets/auth. Threat models that need a real boundary on shell execution must rely on sandboxing or permission controls outside this plugin.
