# Pantheon — Session Notifications (`@AppVerkPantheonPlugin`)

Pantheon is the harness-level home for cross-cutting concerns. Its first
inhabitant is a session-notification hook that surfaces three OpenCode events
as native macOS banners:

- `session.idle` — the agent finished a turn and is waiting for input. A 1.5s
  confirmation delay suppresses notifications when the agent immediately
  resumes (e.g. between tool calls).
- `AskUserQuestion` tool fired — the agent is explicitly asking the user a
  question. Sent immediately.
- Permission events (`permission.ask`, `permission.asked`,
  `permission.requested`, `permission.updated`) — the agent needs the user
  to allow or deny a command. Sent immediately.

Subagents spawned via `dispatch_parallel` (`@perun` coordinator) do **not**
trigger notifications — the user cannot interact with them directly.

## Requirements

- macOS. The hook is a no-op on other platforms.
- `osascript` (always present on macOS) for the visual banner.
- `terminal-notifier` (optional) — if installed, used in preference to
  `osascript` because clicking the banner focuses the originating terminal.
- `afplay` (always present on macOS) when sounds are enabled.

## Configuration

All knobs are environment variables; nothing in `opencode.json` changes.

| Variable | Default | Effect |
|---|---|---|
| `AV_PANTHEON_NOTIFY` | `1` | Set to `0` to disable the entire hook. |
| `AV_PANTHEON_NOTIFY_TITLE` | `AppVerk` | Banner title. |
| `AV_PANTHEON_NOTIFY_IDLE_MSG` | `Agent is ready for input` | Message for idle. |
| `AV_PANTHEON_NOTIFY_QUESTION_MSG` | `Agent is asking a question` | Message for `AskUserQuestion`. |
| `AV_PANTHEON_NOTIFY_PERMISSION_MSG` | `Agent needs permission` | Message for permission events. |
| `AV_PANTHEON_NOTIFY_DELAY_MS` | `1500` | Idle confirmation delay in ms. |
| `AV_PANTHEON_NOTIFY_SOUND` | `0` | Set to `1` to enable a sound after each notification. |
| `AV_PANTHEON_NOTIFY_SOUND_PATH` | `/System/Library/Sounds/Glass.aiff` | Path to the sound file. |

Invalid numeric values fall back to the default and emit a one-time warning.

## Out of scope (today)

- Linux / Windows
- Slack / Discord / email
- Notifications for `dispatch_parallel` task timeouts or errors
- Per-event sound files
- A config file (`opencode.json` or otherwise)

See `docs/superpowers/specs/2026-05-19-session-notification-hook-design.md` for the full design.
