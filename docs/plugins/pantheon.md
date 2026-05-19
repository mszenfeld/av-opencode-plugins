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

## How the confirmation delay works

Idle banners are debounced by `AV_PANTHEON_NOTIFY_DELAY_MS` (default `1500`ms)
so the user only sees them when the agent is genuinely waiting for input, not
during normal between-tool-call quiet moments.

When `session.idle` is received the hook schedules a timer; if any of the
following events arrive for the same session before the timer fires, the
pending idle banner is **cancelled**:

- A subsequent `session.idle` — the new event resets the debounce window
  (scheduling internally cancels the existing timer first).
- Model-generation deltas: `message.updated`, `message.part.updated`,
  `message.part.delta` — the model is still streaming a response.
- Tool execution events: `tool.execute.before` and `tool.execute.after` —
  the agent is actively invoking a tool. (The `AskUserQuestion` variant of
  `tool.execute.before` is special-cased: it fires a question banner
  immediately and does **not** schedule or cancel anything.)
- `session.deleted` — the session went away before the timer elapsed.

`AskUserQuestion` and permission events (`permission.ask`,
`permission.asked`, `permission.requested`, `permission.updated`) bypass the
debounce entirely and fire immediately, because they signal explicit
user-wait states rather than transient idle gaps.

Notifications only fire for the user-facing **main** session. Idle, question,
and permission events emitted by `dispatch_parallel` subagents are tracked
but never produce banners.

## Requirements

- Designed for and supported on macOS only. The hook does not check
  `process.platform`; instead it probes for `osascript` / `terminal-notifier`
  via `which`. On Linux / Windows those probes typically fail and the hook
  silently no-ops. A non-Mac host that happens to expose a Mac-style
  `osascript` wrapper on `PATH` will still attempt to use it.
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

See `docs/superpowers/specs/2026-05-19-session-notification-hook-design.md` for the design and `docs/superpowers/plans/2026-05-19-session-notification-hook.md` for the implementation plan.
