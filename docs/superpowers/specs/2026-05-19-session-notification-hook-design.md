# Pantheon — Session Notification Hook MVP Design

**Status:** Draft — pending implementation plan
**Date:** 2026-05-19
**Branch:** `feature/harness`
**Spec author:** Marian Szenfeld + Claude (brainstorming session)

---

## 1. Context

### 1.1 What we are doing

Add a macOS desktop notification when an OpenCode session reaches an interactive checkpoint — idle (agent finished a turn), question (`AskUserQuestion` tool fires), or permission request. Today the user has no signal that OpenCode wants attention apart from looking at the terminal; with long-running agent turns (especially `@perun` dispatching specialists) this means lost wall-clock time waiting on a session that has already paused.

Inspired by `code-yeongyu/oh-my-openagent` (OMO), which ships an elaborate `session-notification` hook spanning ~10 files. We are taking the same idea but trimming aggressively for our scale and platform reality.

### 1.2 Why a dedicated package, not `src/hooks/`

This is the first cross-cutting harness concern beyond the workflow plugins (`commit`, `qa`, `code-review`, `frontend-developer`, …). We are establishing **Pantheon** as the harness brand — a place that hosts cross-cutting features (notifications, telemetry, lifecycle hooks, monitoring) separate from self-contained workflow plugins. Creating `packages/pantheon` now sets that boundary clearly; future cross-cutting features land alongside without polluting workflow packages or root `src/`.

### 1.3 Why now

- @perun + `dispatch_parallel` from the prior MVP makes turns visibly longer (waiting on parallel specialists). The cost of missing an idle/question event is higher than before.
- We just established the Pantheon brand via the coordinator MVP (`docs/superpowers/specs/2026-05-18-pantheon-coordinator-mvp-design.md`). Adding the first non-coordinator member of the Pantheon now reinforces the structural decision while it is fresh.

### 1.4 What we are NOT doing in this MVP

- **Not Linux/Windows.** macOS only via `osascript` + optional `terminal-notifier`. AppVerk is a Mac shop; cross-platform parity with OMO is YAGNI for now.
- **Not a config file.** ENV-driven knobs only — no `~/.config/appverk/pantheon.json`, no opencode.json schema changes.
- **Not failure/timeout notifications** for long-running `dispatch_parallel` tasks. Limited to idle / question / permission.
- **Not migrating any existing package into `packages/pantheon`.** `coordinator` and other workspaces stay as they are. Migration is a separate, later decision.
- **Not changing `dispatch_parallel`.** Subagent filtering uses a first-session-wins heuristic; no cross-package coupling between `coordinator` and `pantheon` for MVP.

---

## 2. Decisions Made (with reasoning)

| Decision | Choice | Reason |
|---|---|---|
| Triggers | **session.idle + AskUserQuestion tool + permission events** | Cover the three places where the user actually needs to know "OpenCode wants you now". Long-running task errors deferred. |
| Platform | **macOS only** | Whole team on Darwin. Linux/Windows parity is uncommitted scope and triples the test surface per sender. |
| Packaging | **New `packages/pantheon` workspace** | Establishes harness-hub boundary. Workflow plugins stay separate; cross-cutting concerns live in Pantheon. |
| Per-trigger messages | **Yes** — distinct title/message per event type | Lets user act without looking at terminal (idle vs question vs permission convey different urgency). |
| Confirmation delay | **Yes — 1.5s** before sending `session.idle` notification | OMO-proven anti-flicker: prevents spam between tool calls when the LLM resumes within ~1s. |
| Subagent filter | **Yes — first-session-wins** | User cannot interact with `dispatch_parallel` children directly; notifications for them are pure noise. First `session.created` event in the runtime = main; later sessions = subagents. |
| Sound | **Optional, off by default** | Glass.aiff via `afplay` when `playSound: true`. Visual banner is always-on; sound is opt-in. |
| Configuration | **ENV vars only** | OpenCode plugin SDK has no config standard. ENV is zero-plumbing, easy to document, sufficient for 4 knobs. |
| File granularity | **4 modules** (`session-tracker`, `idle-scheduler`, `notification-sender`, `session-notification`) | Each has one responsibility and is testable in isolation. OMO's ~10-file split is unnecessary at our scope. |

---

## 3. Architecture

### 3.1 High-level

```
OpenCode emits event (session.idle, tool.execute.before, permission.ask, …)
                            │
                            ▼
              ┌─────────────────────────┐
              │ AppVerkPantheonPlugin   │  ← root re-export, src/index.ts merges
              │ packages/pantheon/      │
              │ src/index.ts            │
              └────────────┬────────────┘
                           │
                  ctx.event handler
                           │
                           ▼
              ┌─────────────────────────┐
              │ session-notification.ts │  ← orchestrator: routes by event.type
              └─┬────────────┬──────────┘
                │            │             │
                ▼            ▼             ▼
        ┌───────────┐  ┌───────────┐  ┌──────────────────┐
        │ session-  │  │ idle-     │  │ notification-    │
        │ tracker   │  │ scheduler │  │ sender           │
        │           │  │           │  │                  │
        │ main vs   │  │ 1.5s      │  │ osascript /      │
        │ subagent  │  │ debounce  │  │ terminal-notifier│
        └───────────┘  └───────────┘  └──────────────────┘
```

### 3.2 What lives where

| Concern | Module | Form |
|---|---|---|
| Routing events to the right action | `session-notification.ts` | Pure switch over `event.type` |
| Tracking which session is the user's main one | `session-tracker.ts` | In-memory state machine |
| Anti-flicker: delay-and-cancel for `session.idle` | `idle-scheduler.ts` | Timer map keyed by sessionID |
| Shelling out to macOS notification commands | `notification-sender.ts` | `ctx.$` invocations with AppleScript escaping |

### 3.3 File layout

```
packages/pantheon/
  package.json                # @appverk/opencode-pantheon, workspace pkg
  tsconfig.json
  tsup.config.ts              # ESM build → dist/
  src/
    index.ts                  # AppVerkPantheonPlugin: Plugin
    hooks/
      session-notification.ts        # main orchestrator
      idle-scheduler.ts
      notification-sender.ts
      session-tracker.ts
  tests/
    hooks/
      session-notification.test.ts
      idle-scheduler.test.ts
      notification-sender.test.ts
      session-tracker.test.ts
  dist/                       # built output, committed (repo convention)
```

Root wiring:
- `src/index.ts`: add `import { AppVerkPantheonPlugin } from "../packages/pantheon/dist/index.js"` and append to `defaultPluginFactories`.
- Root `package.json` `files`: add `packages/pantheon/dist`.
- Root build scripts: pantheon already covered by `npm run build` workspace recursion; verify `npm run build:root` includes it.
- `tests/root-plugin.test.ts`: assert pantheon hook is present in the merged plugin's `event` slot.

---

## 4. Components

### 4.1 `session-tracker.ts`

**Responsibility:** decide whether a given sessionID is the user's main session.

**Public surface:**
```ts
export class SessionTracker {
  registerSession(id: string): void   // first call: marks main; subsequent: marks subagent
  markAsSubagent(id: string): void    // explicit override
  deleteSession(id: string): void
  isMain(id: string): boolean
  isSubagent(id: string): boolean
}
```

**Logic:** internal `mainSessionId: string | undefined` + `subagents: Set<string>`. `registerSession` sets `mainSessionId` if undefined; otherwise adds to `subagents`. `markAsSubagent` is an escape hatch; not used by MVP code paths but available for the future case where `dispatch_parallel` explicitly registers child IDs.

### 4.2 `idle-scheduler.ts`

**Responsibility:** schedule a "fire after delay unless activity arrives" timer per session.

**Public surface:**
```ts
export class IdleScheduler {
  constructor(delayMs: number, onFire: (sessionId: string) => void | Promise<void>)
  schedule(sessionId: string): void
  markActivity(sessionId: string): void
  cancel(sessionId: string): void
}
```

**Logic:** `Map<sessionId, NodeJS.Timeout>`. `schedule` clears any existing timer for that session and starts a new one. `markActivity` clears without firing. `cancel` ditto. When the timer fires, the entry is removed and `onFire(sessionId)` is invoked.

### 4.3 `notification-sender.ts`

**Responsibility:** invoke macOS notification commands; escape inputs safely.

**Public surface:**
```ts
export async function sendMacOSNotification(
  ctx: PluginInput,
  args: { title: string; message: string }
): Promise<void>

export async function playMacOSSound(
  ctx: PluginInput,
  soundPath: string
): Promise<void>
```

**Logic:**
1. Cache platform detection on first call (avoid `which` on every event).
2. `sendMacOSNotification`:
   - Try `terminal-notifier` (if `which terminal-notifier` succeeded once) — preferred because it focuses the originating terminal on click.
   - Fallback `osascript -e 'display notification "<escaped>" with title "<escaped>"'`.
   - Escape function: `s => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')`.
3. `playMacOSSound`: `afplay <path>` via `ctx.$`.
4. All commands run with `.nothrow().quiet()` — failures are swallowed (notification is best-effort).
5. If `typeof ctx.$ !== "function"` or `which osascript` returned nothing: log once on first call, then return early (no-op).

### 4.4 `session-notification.ts`

**Responsibility:** wire the three sub-modules to OpenCode `event` callbacks.

**Public surface:**
```ts
export interface SessionNotificationConfig {
  title?: string
  idleMessage?: string
  questionMessage?: string
  permissionMessage?: string
  idleConfirmationDelayMs?: number
  playSound?: boolean
  soundPath?: string
}

export function createSessionNotification(
  ctx: PluginInput,
  config?: SessionNotificationConfig,
): (input: { event: { type: string; properties?: unknown } }) => Promise<void>
```

**Routing table:**

| `event.type` | Action |
|---|---|
| `session.created` | `tracker.registerSession(id)` |
| `session.deleted` | `tracker.deleteSession(id)` + `scheduler.cancel(id)` |
| `session.idle` | if `tracker.isMain(id)` → `scheduler.schedule(id)` |
| `message.updated`, `message.part.updated`, `message.part.delta` | `scheduler.markActivity(id)` |
| `tool.execute.before` with toolName matching `/^(question|ask_user_question|askuserquestion)$/i` | immediate `sender.sendMacOSNotification({title, message: questionMessage})` + optional sound, **only if** `tracker.isMain(id)` |
| `tool.execute.before` / `tool.execute.after` (other tools) | `scheduler.markActivity(id)` |
| `permission.ask`, `permission.asked`, `permission.requested`, `permission.updated` | immediate notify with `permissionMessage`, only if `tracker.isMain(id)` |

`onFire` passed to `IdleScheduler` invokes `sender.sendMacOSNotification({title, message: idleMessage})` + optional sound.

---

## 5. Data Flow

### 5.1 Idle path (with anti-flicker)

```
LLM completes a tool sequence → OpenCode emits session.idle
  → orchestrator: tracker.isMain(id) === true
  → idleScheduler.schedule(id)
  → [no activity for 1.5s]
  → timer fires → onFire(id)
  → sender.sendMacOSNotification({title: "AppVerk", message: "Agent is ready for input"})
  → osascript displays banner
```

### 5.2 Idle cancelled (LLM resumes within delay window)

```
session.idle → idleScheduler.schedule(id, 1.5s)
  → 200ms later: message.part.delta event
  → orchestrator: scheduler.markActivity(id) → clearTimeout
  → no notification sent
```

### 5.3 Question path (immediate)

```
LLM invokes AskUserQuestion → tool.execute.before with toolName="AskUserQuestion"
  → orchestrator: matches QUESTION_TOOLS regex
  → tracker.isMain(id) === true
  → sender.sendMacOSNotification({title: "AppVerk", message: "Agent is asking a question"})
  → (playMacOSSound if playSound: true)
```

### 5.4 Permission path (immediate)

```
OpenCode permission system prompts user → emits permission.ask
  → orchestrator: matches permission events
  → tracker.isMain(id) === true
  → sender.sendMacOSNotification({title: "AppVerk", message: "Agent needs permission"})
  → (sound if enabled)
```

### 5.5 Subagent filter path

```
[earlier] OpenCode emits session.created for the user's first session
  → tracker.registerSession(mainID) → mainSessionId = mainID
[later] @perun dispatch_parallel spawns child session via SDK
  → OpenCode emits session.created for childID
  → tracker.registerSession(childID) → mainSessionId already set → child added to subagents
  → session.idle later fires for childID → tracker.isMain(childID) === false → skip
```

Note: we do **not** read `parentSessionID` metadata from the event. The
first-session-wins heuristic is sufficient because the user's session is
always created before any `dispatch_parallel` child.

---

## 6. Configuration

Environment variables are the sole configuration mechanism for MVP.

| ENV | Default | Effect |
|---|---|---|
| `AV_PANTHEON_NOTIFY` | `1` (on) | `0` disables the entire hook — no events processed, immediate return |
| `AV_PANTHEON_NOTIFY_TITLE` | `"AppVerk"` | Notification banner title |
| `AV_PANTHEON_NOTIFY_IDLE_MSG` | `"Agent is ready for input"` | Message for `session.idle` |
| `AV_PANTHEON_NOTIFY_QUESTION_MSG` | `"Agent is asking a question"` | Message for `AskUserQuestion` |
| `AV_PANTHEON_NOTIFY_PERMISSION_MSG` | `"Agent needs permission"` | Message for permission events |
| `AV_PANTHEON_NOTIFY_DELAY_MS` | `1500` | Idle confirmation delay |
| `AV_PANTHEON_NOTIFY_SOUND` | `0` (off) | `1` enables `afplay` after each notification |
| `AV_PANTHEON_NOTIFY_SOUND_PATH` | `"/System/Library/Sounds/Glass.aiff"` | Sound file path |

Invalid numeric values (e.g. `AV_PANTHEON_NOTIFY_DELAY_MS=abc`) fall back to the default with a one-time log warning.

ENV reading happens once at `createSessionNotification` construction. Subsequent ENV changes within a session are not picked up — by design, behaviour stays stable for the session.

---

## 7. Error Handling

**Top-level invariant:** the hook never crashes OpenCode. The exported event handler wraps all logic in try/catch and logs but does not rethrow.

| Failure | Behaviour |
|---|---|
| `typeof ctx.$ !== "function"` | log once, no-op thereafter |
| `which osascript` returns nothing | log once, set platform=unsupported, no-op all sender calls |
| Shell command failure (osascript fails, afplay fails) | swallow via `.nothrow().quiet()` |
| AppleScript-special characters in title/message | escape `\` and `"` before interpolation; test verifies no shell-injection path |
| `event.properties` missing or malformed | early return for that event only |
| `event.type` unknown | ignored |
| Subagent state corrupt (e.g. `session.deleted` for unknown ID) | silently ignore |
| Invalid ENV value | fall back to default, one-time log warning |

**Specific test:** feed `title = '"; do shell script "rm -rf /"; "'` through `sendMacOSNotification` and assert the resulting `ctx.$` invocation receives the escaped literal, not interpolated shell.

---

## 8. Testing

### 8.1 Per-module unit tests

| Module | Coverage |
|---|---|
| `session-tracker.test.ts` | first registerSession sets main; subsequent registers mark subagent; markAsSubagent explicit path; deleteSession clears state; isMain/isSubagent return correctly across lifecycle |
| `idle-scheduler.test.ts` | (vi.useFakeTimers) schedule fires onFire after delay; markActivity cancels before fire; cancel after fire is a no-op; multiple sessions tracked independently; rapid re-schedule resets timer |
| `notification-sender.test.ts` | osascript invoked with escaped args; AppleScript-injection payload escaped not executed; terminal-notifier preferred when available; afplay invoked for sound; ctx.$ undefined → no-op + one log; osascript missing → no-op + one log; shell error swallowed |
| `session-notification.test.ts` | full event routing matrix: idle schedules, activity events cancel, AskUserQuestion immediate, permission immediate, subagent sessions filtered, session.deleted cleans up; ENV `AV_PANTHEON_NOTIFY=0` disables everything |

### 8.2 Packaging test

In `tests/root-plugin.test.ts`: add a case asserting `AppVerkPlugins` registers an `event` handler that does not throw when fed a synthetic `session.idle` event with the env disable flag set.

### 8.3 Coverage target

Match repo convention (≥80% per workspace).

### 8.4 Smoke test (manual)

Before merging the implementation PR: install the built plugin locally, open OpenCode, run a short turn, wait for `session.idle`, confirm a macOS banner appears. Document this step in the PR description.

---

## 9. Out of Scope (explicit non-goals)

- Linux/Windows notification senders
- Slack / Discord / email backends
- Configuration via `opencode.json` or JSON config file
- Per-event sound files
- Click-to-focus on the originating terminal (terminal-notifier supports it; the macOS `osascript` fallback does not — we accept the inconsistency)
- Notifications for `dispatch_parallel` task timeouts/failures
- Telemetry of which notifications fire (would belong to a separate Pantheon module)
- Localization (English-only strings; user can override per-message via ENV)

---

## 10. Migration / Compatibility

Net-additive change. No existing plugin is modified beyond `src/index.ts` adding the import + factory entry. No tool, command, or agent surface changes. No user-facing breaking changes.

Backwards compatibility for downstream `AppVerkPlugins` consumers: identical (still a single `Plugin` factory; the merged plugin gains one more `event` handler in the merge chain).

---

## 11. Future considerations (deferred, not committed)

- Linux/Windows senders if team composition changes
- Failure notifications for long-running `dispatch_parallel` tasks
- Lifecycle telemetry (count notifications per session, time-to-attention) — a separate Pantheon module
- Migration of `packages/coordinator` into `packages/pantheon/agents/perun` (separate decision, not blocked by this MVP)
