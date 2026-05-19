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

### 1.2 Why root `src/`, not a new workspace package

This hook is the first **harness-level** concern beyond the workflow plugins (`commit`, `qa`, `code-review`, `frontend-developer`, …). Two structural options were considered:

- **New workspace** (`packages/pantheon/` with its own `package.json`, `tsup`, `dist`) — consistent with current repo convention but adds ceremony (config files, build orchestration, `files` array entry) that pays off only when there are several cross-cutting features to host.
- **Root `src/hooks/`** — lives next to the existing `src/index.ts`, which is already the harness entry point that merges all workspace plugins. Zero new build infra, just additional files.

We chose **root `src/`** as a deliberate start of a slow migration. Workflow plugins (`commit`, `qa`, etc.) stay in `packages/` for now; new harness code lands in `src/`. Over time the harness identity (Pantheon) accumulates in `src/`, and packages can migrate inward at their own pace.

### 1.3 Why now

- @perun + `dispatch_parallel` from the prior MVP makes turns visibly longer (waiting on parallel specialists). The cost of missing an idle/question event is higher than before.
- We just established the Pantheon brand via the coordinator MVP (`docs/superpowers/specs/2026-05-18-pantheon-coordinator-mvp-design.md`). Adding the first non-coordinator member of the Pantheon now reinforces the structural decision while it is fresh.

### 1.4 What we are NOT doing in this MVP

- **Not Linux/Windows.** macOS only via `osascript` + optional `terminal-notifier`. AppVerk is a Mac shop; cross-platform parity with OMO is YAGNI for now.
- **Not a config file.** ENV-driven knobs only — no `~/.config/appverk/pantheon.json`, no opencode.json schema changes.
- **Not failure/timeout notifications** for long-running `dispatch_parallel` tasks. Limited to idle / question / permission.
- **Not migrating any existing workspace into `src/`.** `coordinator`, `commit`, `qa`, … stay in `packages/`. Migration is a separate, gradual decision.
- **Not changing `dispatch_parallel`.** Subagent filtering uses a first-session-wins heuristic; no cross-package coupling between `coordinator` and the new hook for MVP.
- **Not introducing a bundler for root.** Root keeps `tsc → copy` pattern; we extend the copy to handle subdirectories.

---

## 2. Decisions Made (with reasoning)

| Decision | Choice | Reason |
|---|---|---|
| Triggers | **session.idle + AskUserQuestion tool + permission events** | Cover the three places where the user actually needs to know "OpenCode wants you now". Long-running task errors deferred. |
| Platform | **macOS only** | Whole team on Darwin. Linux/Windows parity is uncommitted scope and triples the test surface per sender. |
| Location | **Root `src/hooks/`** | First step of slow migration toward `src/`-centric harness. New workspace would be ceremony for one hook. |
| Per-trigger messages | **Yes** — distinct title/message per event type | Lets user act without looking at terminal (idle vs question vs permission convey different urgency). |
| Confirmation delay | **Yes — 1.5s** before sending `session.idle` notification | OMO-proven anti-flicker: prevents spam between tool calls when the LLM resumes within ~1s. |
| Subagent filter | **Yes — first-session-wins** | User cannot interact with `dispatch_parallel` children directly; notifications for them are pure noise. First `session.created` event in the runtime = main; later sessions = subagents. |
| Sound | **Optional, off by default** | Glass.aiff via `afplay` when `playSound: true`. Visual banner is always-on; sound is opt-in. |
| Configuration | **ENV vars only** | OpenCode plugin SDK has no config standard. ENV is zero-plumbing, easy to document, sufficient for 4 knobs. |
| File granularity | **4 modules** (`session-tracker`, `idle-scheduler`, `notification-sender`, `session-notification`) | Each has one responsibility and is testable in isolation. OMO's ~10-file split is unnecessary at our scope. |
| Plugin shape | **Standalone `AppVerkPantheonPlugin` factory** | Registered alongside other plugin factories in `defaultPluginFactories` (`src/index.ts`). Mirrors the existing pattern; no special-casing. |

---

## 3. Architecture

### 3.1 High-level

```
OpenCode emits event (session.idle, tool.execute.before, permission.ask, …)
                            │
                            ▼
              ┌─────────────────────────┐
              │ AppVerkPantheonPlugin   │  ← src/hooks/session-notification/plugin.ts
              │   (factory)             │     wired into src/index.ts defaultPluginFactories
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
| Plugin factory + ENV reading | `src/hooks/session-notification/plugin.ts` | `Plugin` async factory returning `{ event: handler }` |
| Routing events to the right action | `session-notification.ts` | Pure switch over `event.type` |
| Tracking which session is the user's main one | `session-tracker.ts` | In-memory state machine |
| Anti-flicker: delay-and-cancel for `session.idle` | `idle-scheduler.ts` | Timer map keyed by sessionID |
| Shelling out to macOS notification commands | `notification-sender.ts` | `ctx.$` invocations with AppleScript escaping |

### 3.3 File layout

```
src/
  index.ts                                # MODIFIED: import + register factory
  index.js                                # rebuilt
  index.d.ts                              # rebuilt
  hooks/
    session-notification/
      plugin.ts                           # AppVerkPantheonPlugin factory + ENV read
      session-notification.ts             # orchestrator
      idle-scheduler.ts
      notification-sender.ts
      session-tracker.ts
      (compiled .js + .d.ts after build)

tests/
  root-plugin.test.ts                     # MODIFIED: assert event handler present
  hooks/
    session-notification/
      session-notification.test.ts
      idle-scheduler.test.ts
      notification-sender.test.ts
      session-tracker.test.ts
```

### 3.4 Build pipeline change

Current `build:root` only copies the entry file:

```
tsc -p tsconfig.build.json
cp .tmp-build/src/index.js src/index.js
cp .tmp-build/src/index.d.ts src/index.d.ts
rm -rf .tmp-build
```

This is incompatible with `src/hooks/`: `tsc` produces `.tmp-build/src/hooks/**/*.js` but they are never copied back, so the runtime `src/index.js` would try to `import "./hooks/session-notification/plugin.js"` from a non-existent path.

**Change:** replace the two single-file `cp`s with a recursive copy of the compiled tree:

```
tsc -p tsconfig.build.json
cp -R .tmp-build/src/. src/
rm -rf .tmp-build
```

`.tmp-build/src/` contains only compiled outputs (`.js`, `.d.ts`) — `tsc` does not emit source files, so this overlay never overwrites `.ts` sources. New built files land at `src/hooks/session-notification/*.{js,d.ts}` next to their sources.

**Also update:** `tsconfig.build.json` `"include"`. The current value `["src/index.ts"]` works only because TypeScript follows imports transitively; we leave it as-is — the new files are pulled in automatically when `src/index.ts` imports them. No change needed there.

**Root `package.json` `files` array:** currently lists `src/index.js` and `src/index.d.ts` plus `packages/*/dist` entries. Replace `src/index.js` / `src/index.d.ts` with `src` (whole directory) so the published tarball includes hook files.

**`verify-dist-sync.mjs`:** existing script checks that committed `dist/` matches built output. Verify it tolerates the new directory; extend if necessary as part of implementation.

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

### 4.5 `plugin.ts`

**Responsibility:** read ENV, construct config, wire `createSessionNotification` into a `Plugin` factory.

**Public surface:**
```ts
export const AppVerkPantheonPlugin: Plugin = async (ctx) => {
  if (process.env.AV_PANTHEON_NOTIFY === "0") return {}    // hard off
  const config = readConfigFromEnv()
  const handler = createSessionNotification(ctx, config)
  return { event: handler }
}
```

`readConfigFromEnv` parses the ENV table from §6 with default fallbacks and validation (`Number.isFinite` for numeric values; on invalid, log warning + use default).

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
| `AV_PANTHEON_NOTIFY` | `1` (on) | `0` disables the entire hook — factory returns empty `{}` |
| `AV_PANTHEON_NOTIFY_TITLE` | `"AppVerk"` | Notification banner title |
| `AV_PANTHEON_NOTIFY_IDLE_MSG` | `"Agent is ready for input"` | Message for `session.idle` |
| `AV_PANTHEON_NOTIFY_QUESTION_MSG` | `"Agent is asking a question"` | Message for `AskUserQuestion` |
| `AV_PANTHEON_NOTIFY_PERMISSION_MSG` | `"Agent needs permission"` | Message for permission events |
| `AV_PANTHEON_NOTIFY_DELAY_MS` | `1500` | Idle confirmation delay |
| `AV_PANTHEON_NOTIFY_SOUND` | `0` (off) | `1` enables `afplay` after each notification |
| `AV_PANTHEON_NOTIFY_SOUND_PATH` | `"/System/Library/Sounds/Glass.aiff"` | Sound file path |

Invalid numeric values (e.g. `AV_PANTHEON_NOTIFY_DELAY_MS=abc`) fall back to the default with a one-time log warning.

ENV reading happens once at factory construction (`plugin.ts`). Subsequent ENV changes within a session are not picked up — by design, behaviour stays stable for the session.

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

| Test file | Coverage |
|---|---|
| `tests/hooks/session-notification/session-tracker.test.ts` | first registerSession sets main; subsequent registers mark subagent; markAsSubagent explicit path; deleteSession clears state; isMain/isSubagent return correctly across lifecycle |
| `tests/hooks/session-notification/idle-scheduler.test.ts` | (vi.useFakeTimers) schedule fires onFire after delay; markActivity cancels before fire; cancel after fire is a no-op; multiple sessions tracked independently; rapid re-schedule resets timer |
| `tests/hooks/session-notification/notification-sender.test.ts` | osascript invoked with escaped args; AppleScript-injection payload escaped not executed; terminal-notifier preferred when available; afplay invoked for sound; ctx.$ undefined → no-op + one log; osascript missing → no-op + one log; shell error swallowed |
| `tests/hooks/session-notification/session-notification.test.ts` | full event routing matrix: idle schedules, activity events cancel, AskUserQuestion immediate, permission immediate, subagent sessions filtered, session.deleted cleans up; ENV `AV_PANTHEON_NOTIFY=0` causes factory to return empty config |

### 8.2 Packaging test

In `tests/root-plugin.test.ts`: add a case asserting `AppVerkPlugins` registers an `event` handler that does not throw when fed a synthetic `session.idle` event with the env disable flag set.

### 8.3 Coverage target

Match repo convention (≥80%).

### 8.4 Smoke test (manual)

Before merging the implementation PR: build root (`npm run build:root`), open OpenCode, run a short turn, wait for `session.idle`, confirm a macOS banner appears. Document this step in the PR description.

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
- Migrating existing workspace packages into `src/` (that is a separate long-running project)
- Replacing the root `tsc` build with `tsup` (the recursive `cp` keeps the existing pipeline intact)

---

## 10. Migration / Compatibility

Net-additive change. Modifications limited to:

- `src/index.ts` — adds one import + appends `AppVerkPantheonPlugin` to `defaultPluginFactories`.
- `package.json` — `build:root` script (replace single-file `cp`s with recursive `cp -R`); `files` array (`src/index.js` + `src/index.d.ts` → `src`).
- `tests/root-plugin.test.ts` — one new case.

No tool, command, or agent surface changes. No user-facing breaking changes. Existing workspace plugin builds remain untouched.

Backwards compatibility for downstream `AppVerkPlugins` consumers: identical signature (still a single `Plugin` factory; merged plugin gains one more `event` handler in the merge chain).

---

## 11. Future considerations (deferred, not committed)

- Linux/Windows senders if team composition changes
- Failure notifications for long-running `dispatch_parallel` tasks
- Lifecycle telemetry (count notifications per session, time-to-attention) — a separate harness module under `src/hooks/` or `src/telemetry/`
- Migration of workspace packages (`coordinator`, `commit`, `qa`, …) into `src/` — driven by need, not on a schedule
- Replacing root `tsc → cp` with a bundler (`tsup` or `esbuild`) once `src/` has enough modules to justify the dependency
