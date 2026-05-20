# Commit Plugin

The AppVerk commit plugin adds an OpenCode-native commit workflow with policy enforcement.

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
