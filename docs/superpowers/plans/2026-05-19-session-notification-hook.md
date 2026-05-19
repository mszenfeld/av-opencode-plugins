# Session Notification Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a macOS desktop notification when an OpenCode session reaches an interactive checkpoint — idle, `AskUserQuestion`, or permission request — so the user does not have to watch the terminal.

**Architecture:** Five small modules in `src/hooks/session-notification/` (session state tracker, idle-debounce scheduler, macOS notification shell-out, event-routing orchestrator, and the `Plugin` factory). The factory is registered alongside the existing workspace plugin factories in `src/index.ts`. The root `tsc → cp` build is extended to copy the compiled `src/` tree recursively so the hook's compiled output lands next to its source. Everything else (workspace packages, OpenCode plugin SDK usage) is unchanged.

**Tech Stack:** TypeScript 5.8 with `NodeNext` module resolution; Vitest 3.x for tests (fake timers for the scheduler); `@opencode-ai/plugin` types; `ctx.$` (Bun-style tagged-template shell). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-19-session-notification-hook-design.md`. The plan implements §3 (architecture/layout), §4 (components), §5 (data flow), §6 (ENV config), §7 (error handling), §8 (testing).

---

## File Map

**Create:**
- `src/hooks/session-notification/session-tracker.ts`
- `src/hooks/session-notification/idle-scheduler.ts`
- `src/hooks/session-notification/notification-sender.ts`
- `src/hooks/session-notification/session-notification.ts`
- `src/hooks/session-notification/env-config.ts`
- `src/hooks/session-notification/plugin.ts`
- `tests/hooks/session-notification/session-tracker.test.ts`
- `tests/hooks/session-notification/idle-scheduler.test.ts`
- `tests/hooks/session-notification/notification-sender.test.ts`
- `tests/hooks/session-notification/session-notification.test.ts`
- `tests/hooks/session-notification/env-config.test.ts`

**Modify:**
- `src/index.ts` — append `AppVerkPantheonPlugin` to `defaultPluginFactories`
- `tests/root-plugin.test.ts` — assert Pantheon hook is wired
- `package.json` — `build:root` script (recursive copy) + `files` array (`src/index.js`, `src/index.d.ts` → `src`)

**Read-only reference (do not edit):**
- `docs/superpowers/specs/2026-05-19-session-notification-hook-design.md` — the spec
- `packages/coordinator/src/index.ts` — example of how an existing workspace registers tools/agents (NOT a template — Pantheon uses root `src/`)
- `tsconfig.build.json`, `tsconfig.base.json` — already include `src/**/*.ts`, no changes needed

---

## Task 1: SessionTracker (state machine for main vs subagent sessions)

**Files:**
- Create: `src/hooks/session-notification/session-tracker.ts`
- Test: `tests/hooks/session-notification/session-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/session-notification/session-tracker.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { SessionTracker } from "../../../src/hooks/session-notification/session-tracker.js"

describe("SessionTracker", () => {
  it("treats an unknown session as neither main nor subagent", () => {
    const t = new SessionTracker()
    expect(t.isMain("ses_a")).toBe(false)
    expect(t.isSubagent("ses_a")).toBe(false)
  })

  it("marks the first registered session as main", () => {
    const t = new SessionTracker()
    t.registerSession("ses_a")
    expect(t.isMain("ses_a")).toBe(true)
    expect(t.isSubagent("ses_a")).toBe(false)
  })

  it("marks subsequent registered sessions as subagents", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.registerSession("ses_child")
    expect(t.isMain("ses_child")).toBe(false)
    expect(t.isSubagent("ses_child")).toBe(true)
    expect(t.isMain("ses_main")).toBe(true)
  })

  it("is idempotent for the same main session ID", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.registerSession("ses_main")
    expect(t.isMain("ses_main")).toBe(true)
    expect(t.isSubagent("ses_main")).toBe(false)
  })

  it("markAsSubagent demotes the main session", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.markAsSubagent("ses_main")
    expect(t.isMain("ses_main")).toBe(false)
    expect(t.isSubagent("ses_main")).toBe(true)
  })

  it("deleteSession clears main and subagent state for that ID", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.registerSession("ses_child")
    t.deleteSession("ses_main")
    t.deleteSession("ses_child")
    expect(t.isMain("ses_main")).toBe(false)
    expect(t.isSubagent("ses_child")).toBe(false)
  })

  it("after main is deleted, the next registerSession becomes the new main", () => {
    const t = new SessionTracker()
    t.registerSession("ses_main")
    t.deleteSession("ses_main")
    t.registerSession("ses_next")
    expect(t.isMain("ses_next")).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/session-notification/session-tracker.test.ts`
Expected: FAIL — `Cannot find module '.../session-tracker.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/session-notification/session-tracker.ts`:

```ts
export class SessionTracker {
  private mainSessionId: string | undefined
  private readonly subagents = new Set<string>()

  registerSession(id: string): void {
    if (this.mainSessionId === undefined) {
      this.mainSessionId = id
      return
    }
    if (id === this.mainSessionId) return
    this.subagents.add(id)
  }

  markAsSubagent(id: string): void {
    if (this.mainSessionId === id) {
      this.mainSessionId = undefined
    }
    this.subagents.add(id)
  }

  deleteSession(id: string): void {
    if (this.mainSessionId === id) {
      this.mainSessionId = undefined
    }
    this.subagents.delete(id)
  }

  isMain(id: string): boolean {
    return this.mainSessionId === id
  }

  isSubagent(id: string): boolean {
    return this.subagents.has(id)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/session-notification/session-tracker.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/session-notification/session-tracker.ts tests/hooks/session-notification/session-tracker.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(pantheon): add SessionTracker for main vs subagent session state"
```

---

## Task 2: IdleScheduler (1.5s debounce with cancellation)

**Files:**
- Create: `src/hooks/session-notification/idle-scheduler.ts`
- Test: `tests/hooks/session-notification/idle-scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/session-notification/idle-scheduler.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IdleScheduler } from "../../../src/hooks/session-notification/idle-scheduler.js"

describe("IdleScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("fires onFire after the configured delay", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith("ses_a")
  })

  it("markActivity before the delay cancels the timer", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    await vi.advanceTimersByTimeAsync(500)
    s.markActivity("ses_a")
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it("cancel before the delay cancels the timer", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    s.cancel("ses_a")
    await vi.advanceTimersByTimeAsync(5000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it("cancel after onFire has fired is a no-op", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    await vi.advanceTimersByTimeAsync(1500)
    expect(() => s.cancel("ses_a")).not.toThrow()
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it("markActivity for an unknown session is a no-op", () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    expect(() => s.markActivity("ses_unknown")).not.toThrow()
  })

  it("re-scheduling resets the timer", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    await vi.advanceTimersByTimeAsync(1000)
    s.schedule("ses_a") // reset
    await vi.advanceTimersByTimeAsync(1000) // total 2000 from first schedule, but only 1000 from reset
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500) // now 1500 from reset
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it("tracks multiple sessions independently", async () => {
    const onFire = vi.fn()
    const s = new IdleScheduler(1500, onFire)
    s.schedule("ses_a")
    s.schedule("ses_b")
    s.markActivity("ses_a")
    await vi.advanceTimersByTimeAsync(1500)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith("ses_b")
  })

  it("awaits async onFire without rethrowing", async () => {
    const onFire = vi.fn(async (_id: string) => {
      throw new Error("boom")
    })
    const s = new IdleScheduler(100, onFire)
    s.schedule("ses_a")
    await vi.advanceTimersByTimeAsync(100)
    // Allow the swallowed promise rejection to settle.
    await Promise.resolve()
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/session-notification/idle-scheduler.test.ts`
Expected: FAIL — `Cannot find module '.../idle-scheduler.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/session-notification/idle-scheduler.ts`:

```ts
export type IdleSchedulerFire = (sessionId: string) => void | Promise<void>

export class IdleScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly delayMs: number,
    private readonly onFire: IdleSchedulerFire,
  ) {}

  schedule(sessionId: string): void {
    this.cancel(sessionId)
    const timer = setTimeout(() => {
      this.timers.delete(sessionId)
      // Swallow rejections from async onFire so the timer callback never
      // surfaces unhandled-rejection noise to OpenCode's event loop.
      void Promise.resolve(this.onFire(sessionId)).catch(() => undefined)
    }, this.delayMs)
    this.timers.set(sessionId, timer)
  }

  markActivity(sessionId: string): void {
    this.cancel(sessionId)
  }

  cancel(sessionId: string): void {
    const existing = this.timers.get(sessionId)
    if (existing !== undefined) {
      clearTimeout(existing)
      this.timers.delete(sessionId)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/session-notification/idle-scheduler.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/session-notification/idle-scheduler.ts tests/hooks/session-notification/idle-scheduler.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(pantheon): add IdleScheduler with per-session debounce and cancellation"
```

---

## Task 3: NotificationSender (macOS shell-out with AppleScript escaping)

**Files:**
- Create: `src/hooks/session-notification/notification-sender.ts`
- Test: `tests/hooks/session-notification/notification-sender.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/session-notification/notification-sender.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import {
  NotificationSender,
  escapeAppleScriptText,
  type ShellTag,
} from "../../../src/hooks/session-notification/notification-sender.js"

interface FakeResponse {
  exitCode: number
  stdout: string
}

function createFakeShell(
  responder: (cmd: string) => FakeResponse | "throw",
): { $: ShellTag; calls: string[] } {
  const calls: string[] = []
  const $: ShellTag = (parts, ...values) => {
    let cmd = ""
    for (let i = 0; i < parts.length; i += 1) {
      cmd += parts[i]
      if (i < values.length) cmd += String(values[i])
    }
    calls.push(cmd)
    const response = responder(cmd)
    const promise: Promise<FakeResponse> =
      response === "throw"
        ? Promise.reject(new Error("shell error"))
        : Promise.resolve(response)
    const chain = Object.assign(promise, {
      quiet: () => chain,
      nothrow: () => chain,
    })
    return chain as ReturnType<ShellTag>
  }
  return { $, calls }
}

describe("escapeAppleScriptText", () => {
  it("escapes backslashes before quotes", () => {
    expect(escapeAppleScriptText('a\\b"c')).toBe('a\\\\b\\"c')
  })

  it("escapes a payload that would otherwise inject a shell script", () => {
    const evil = '"; do shell script "rm -rf /"; "'
    const escaped = escapeAppleScriptText(evil)
    expect(escaped).not.toContain('"; do shell script "rm -rf /"; "')
    expect(escaped).toContain('\\"')
  })

  it("leaves benign text unchanged", () => {
    expect(escapeAppleScriptText("Hello world")).toBe("Hello world")
  })
})

describe("NotificationSender", () => {
  it("does nothing when ctx.$ is undefined", async () => {
    const sender = new NotificationSender({})
    await expect(sender.send({ title: "T", message: "M" })).resolves.toBeUndefined()
    await expect(sender.playSound("/sound")).resolves.toBeUndefined()
  })

  it("prefers terminal-notifier when which finds it", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 0, stdout: "/usr/local/bin/terminal-notifier\n" }
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: "T", message: "M" })
    const lastCall = calls[calls.length - 1] ?? ""
    expect(lastCall).toContain("/usr/local/bin/terminal-notifier")
    expect(lastCall).toContain("-title T")
    expect(lastCall).toContain("-message M")
  })

  it("falls back to osascript when terminal-notifier is missing", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 1, stdout: "" }
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: "T", message: "M" })
    const lastCall = calls[calls.length - 1] ?? ""
    expect(lastCall).toContain("/usr/bin/osascript")
    expect(lastCall).toContain('display notification "M" with title "T"')
  })

  it("escapes title and message when shelling out via osascript", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 1, stdout: "" }
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: 'T"X', message: 'M"Y' })
    const lastCall = calls[calls.length - 1] ?? ""
    expect(lastCall).toContain('display notification "M\\"Y" with title "T\\"X"')
  })

  it("does nothing when neither terminal-notifier nor osascript is available", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which ")) return { exitCode: 1, stdout: "" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: "T", message: "M" })
    // Only the two `which` probes; no notification command.
    expect(calls.every((c) => c.startsWith("which "))).toBe(true)
  })

  it("swallows shell errors", async () => {
    const { $ } = createFakeShell((cmd) => {
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 1, stdout: "" }
      return "throw"
    })
    const sender = new NotificationSender({ $ })
    await expect(sender.send({ title: "T", message: "M" })).resolves.toBeUndefined()
  })

  it("caches the probe result across calls", async () => {
    const { $, calls } = createFakeShell((cmd) => {
      if (cmd.startsWith("which terminal-notifier")) return { exitCode: 1, stdout: "" }
      if (cmd.startsWith("which osascript")) return { exitCode: 0, stdout: "/usr/bin/osascript\n" }
      return { exitCode: 0, stdout: "" }
    })
    const sender = new NotificationSender({ $ })
    await sender.send({ title: "T", message: "M" })
    await sender.send({ title: "T", message: "M" })
    const whichCalls = calls.filter((c) => c.startsWith("which "))
    expect(whichCalls).toHaveLength(2) // one for terminal-notifier, one for osascript — not four
  })

  it("playSound runs afplay with the provided path", async () => {
    const { $, calls } = createFakeShell(() => ({ exitCode: 0, stdout: "" }))
    const sender = new NotificationSender({ $ })
    await sender.playSound("/System/Library/Sounds/Glass.aiff")
    expect(calls.some((c) => c.includes("afplay /System/Library/Sounds/Glass.aiff"))).toBe(true)
  })

  it("playSound is a no-op when ctx.$ is undefined", async () => {
    const sender = new NotificationSender({})
    await expect(sender.playSound("/sound")).resolves.toBeUndefined()
  })

  it("logs once when ctx.$ is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const sender = new NotificationSender({})
    await sender.send({ title: "T", message: "M" })
    await sender.send({ title: "T", message: "M" })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/session-notification/notification-sender.test.ts`
Expected: FAIL — `Cannot find module '.../notification-sender.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/session-notification/notification-sender.ts`:

```ts
export interface ShellOutput {
  readonly exitCode: number
  readonly stdout: string | { toString(): string }
}

export type ShellChain = Promise<ShellOutput> & {
  quiet(): ShellChain
  nothrow(): ShellChain
}

export type ShellTag = (parts: TemplateStringsArray, ...values: unknown[]) => ShellChain

export interface NotificationSenderContext {
  readonly $?: ShellTag
}

interface ProbeResult {
  osascriptPath: string | null
  terminalNotifierPath: string | null
}

export function escapeAppleScriptText(input: string): string {
  // Order matters: escape backslashes first, then double quotes.
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export class NotificationSender {
  private probeCache: ProbeResult | undefined
  private warnedNoShell = false

  constructor(private readonly ctx: NotificationSenderContext) {}

  async send(args: { title: string; message: string }): Promise<void> {
    const $ = this.ctx.$
    if (typeof $ !== "function") {
      this.warnOnceNoShell()
      return
    }
    const probe = await this.probe($)
    try {
      if (probe.terminalNotifierPath !== null) {
        await $`${probe.terminalNotifierPath} -title ${args.title} -message ${args.message}`.nothrow().quiet()
        return
      }
      if (probe.osascriptPath !== null) {
        const script =
          `display notification "${escapeAppleScriptText(args.message)}" ` +
          `with title "${escapeAppleScriptText(args.title)}"`
        await $`${probe.osascriptPath} -e ${script}`.nothrow().quiet()
      }
    } catch {
      // Swallow — notification is best-effort.
    }
  }

  async playSound(soundPath: string): Promise<void> {
    const $ = this.ctx.$
    if (typeof $ !== "function") {
      this.warnOnceNoShell()
      return
    }
    try {
      await $`afplay ${soundPath}`.nothrow().quiet()
    } catch {
      // Swallow.
    }
  }

  private async probe($: ShellTag): Promise<ProbeResult> {
    if (this.probeCache !== undefined) return this.probeCache
    const terminalNotifierPath = await whichOrNull($, "terminal-notifier")
    const osascriptPath = await whichOrNull($, "osascript")
    this.probeCache = { osascriptPath, terminalNotifierPath }
    return this.probeCache
  }

  private warnOnceNoShell(): void {
    if (this.warnedNoShell) return
    this.warnedNoShell = true
    console.warn("[pantheon/session-notification] ctx.$ unavailable; notifications disabled")
  }
}

async function whichOrNull($: ShellTag, bin: string): Promise<string | null> {
  try {
    const result = await $`which ${bin}`.nothrow().quiet()
    if (result.exitCode !== 0) return null
    const path = (typeof result.stdout === "string" ? result.stdout : result.stdout.toString()).trim()
    return path.length > 0 ? path : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/session-notification/notification-sender.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/session-notification/notification-sender.ts tests/hooks/session-notification/notification-sender.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(pantheon): add NotificationSender for macOS osascript/terminal-notifier shell-out"
```

---

## Task 4: SessionNotification orchestrator (event routing)

**Files:**
- Create: `src/hooks/session-notification/session-notification.ts`
- Test: `tests/hooks/session-notification/session-notification.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/session-notification/session-notification.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createSessionNotification,
  type SessionNotificationConfig,
} from "../../../src/hooks/session-notification/session-notification.js"
import { SessionTracker } from "../../../src/hooks/session-notification/session-tracker.js"
import { IdleScheduler } from "../../../src/hooks/session-notification/idle-scheduler.js"
import { NotificationSender } from "../../../src/hooks/session-notification/notification-sender.js"

const CONFIG: SessionNotificationConfig = {
  title: "AppVerk",
  idleMessage: "ready",
  questionMessage: "question",
  permissionMessage: "permission",
  idleConfirmationDelayMs: 1500,
  playSound: false,
  soundPath: "/Sound.aiff",
}

interface Harness {
  handler: ReturnType<typeof createSessionNotification>
  tracker: SessionTracker
  scheduler: IdleScheduler
  sender: NotificationSender
  sendSpy: ReturnType<typeof vi.spyOn>
  playSpy: ReturnType<typeof vi.spyOn>
  scheduleSpy: ReturnType<typeof vi.spyOn>
  markActivitySpy: ReturnType<typeof vi.spyOn>
  cancelSpy: ReturnType<typeof vi.spyOn>
}

function buildHarness(config: SessionNotificationConfig = CONFIG): Harness {
  const tracker = new SessionTracker()
  const sender = new NotificationSender({})
  const sendSpy = vi.spyOn(sender, "send").mockResolvedValue(undefined)
  const playSpy = vi.spyOn(sender, "playSound").mockResolvedValue(undefined)
  const scheduler = new IdleScheduler(config.idleConfirmationDelayMs, () => undefined)
  const scheduleSpy = vi.spyOn(scheduler, "schedule")
  const markActivitySpy = vi.spyOn(scheduler, "markActivity")
  const cancelSpy = vi.spyOn(scheduler, "cancel")
  const handler = createSessionNotification({}, config, { tracker, scheduler, sender })
  return { handler, tracker, scheduler, sender, sendSpy, playSpy, scheduleSpy, markActivitySpy, cancelSpy }
}

describe("createSessionNotification", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("registers a session on session.created", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    expect(h.tracker.isMain("ses_main")).toBe(true)
  })

  it("schedules an idle notification for the main session", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.idle", properties: { sessionID: "ses_main" } } })
    expect(h.scheduleSpy).toHaveBeenCalledWith("ses_main")
  })

  it("does not schedule an idle notification for a subagent session", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_child" } } })
    await h.handler({ event: { type: "session.idle", properties: { sessionID: "ses_child" } } })
    expect(h.scheduleSpy).not.toHaveBeenCalled()
  })

  it("marks activity on message.part.delta", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "message.part.delta", properties: { sessionID: "ses_main" } } })
    expect(h.markActivitySpy).toHaveBeenCalledWith("ses_main")
  })

  it("marks activity on message.updated", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "message.updated", properties: { sessionID: "ses_main" } } })
    expect(h.markActivitySpy).toHaveBeenCalledWith("ses_main")
  })

  it("sends a question notification immediately when AskUserQuestion fires", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: "ses_main", tool: "AskUserQuestion" },
      },
    })
    expect(h.sendSpy).toHaveBeenCalledWith({ title: "AppVerk", message: "question" })
  })

  it("matches the question tool name case-insensitively", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: "ses_main", tool: "ask_user_question" },
      },
    })
    expect(h.sendSpy).toHaveBeenCalledTimes(1)
  })

  it("does not send a question notification for subagent sessions", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_child" } } })
    await h.handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: "ses_child", tool: "AskUserQuestion" },
      },
    })
    expect(h.sendSpy).not.toHaveBeenCalled()
  })

  it("treats non-question tool.execute.before as activity", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: "ses_main", tool: "Read" },
      },
    })
    expect(h.markActivitySpy).toHaveBeenCalledWith("ses_main")
    expect(h.sendSpy).not.toHaveBeenCalled()
  })

  it("sends a permission notification on permission.ask", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "permission.ask", properties: { sessionID: "ses_main" } } })
    expect(h.sendSpy).toHaveBeenCalledWith({ title: "AppVerk", message: "permission" })
  })

  it("filters permission events for subagent sessions", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_child" } } })
    await h.handler({ event: { type: "permission.ask", properties: { sessionID: "ses_child" } } })
    expect(h.sendSpy).not.toHaveBeenCalled()
  })

  it("cleans up on session.deleted", async () => {
    const h = buildHarness()
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "session.deleted", properties: { sessionID: "ses_main" } } })
    expect(h.cancelSpy).toHaveBeenCalledWith("ses_main")
    expect(h.tracker.isMain("ses_main")).toBe(false)
  })

  it("plays a sound when playSound is enabled", async () => {
    const h = buildHarness({ ...CONFIG, playSound: true })
    await h.handler({ event: { type: "session.created", properties: { sessionID: "ses_main" } } })
    await h.handler({ event: { type: "permission.ask", properties: { sessionID: "ses_main" } } })
    expect(h.playSpy).toHaveBeenCalledWith("/Sound.aiff")
  })

  it("ignores unknown event types without throwing", async () => {
    const h = buildHarness()
    await expect(
      h.handler({ event: { type: "weird.unknown", properties: { sessionID: "ses_main" } } }),
    ).resolves.toBeUndefined()
  })

  it("ignores events with missing sessionID without throwing", async () => {
    const h = buildHarness()
    await expect(h.handler({ event: { type: "session.idle", properties: undefined } })).resolves.toBeUndefined()
  })

  it("reads sessionID from properties.info as a fallback", async () => {
    const h = buildHarness()
    await h.handler({
      event: { type: "session.created", properties: { info: { sessionID: "ses_main" } } },
    })
    expect(h.tracker.isMain("ses_main")).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/session-notification/session-notification.test.ts`
Expected: FAIL — `Cannot find module '.../session-notification.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/session-notification/session-notification.ts`:

```ts
import { IdleScheduler } from "./idle-scheduler.js"
import { NotificationSender, type NotificationSenderContext } from "./notification-sender.js"
import { SessionTracker } from "./session-tracker.js"

export interface SessionNotificationConfig {
  title: string
  idleMessage: string
  questionMessage: string
  permissionMessage: string
  idleConfirmationDelayMs: number
  playSound: boolean
  soundPath: string
}

export type SessionNotificationEvent = {
  type: string
  properties?: unknown
}

export interface SessionNotificationDeps {
  tracker?: SessionTracker
  scheduler?: IdleScheduler
  sender?: NotificationSender
}

const QUESTION_TOOL_PATTERN = /^(question|ask_user_question|askuserquestion)$/i

const PERMISSION_EVENT_TYPES = new Set([
  "permission.ask",
  "permission.asked",
  "permission.requested",
  "permission.updated",
])

const ACTIVITY_EVENT_TYPES = new Set([
  "message.updated",
  "message.part.updated",
  "message.part.delta",
])

function readSessionId(properties: unknown): string | undefined {
  if (typeof properties !== "object" || properties === null) return undefined
  const obj = properties as Record<string, unknown>
  if (typeof obj.sessionID === "string") return obj.sessionID
  if (typeof obj.sessionId === "string") return obj.sessionId
  const info = obj.info
  if (typeof info === "object" && info !== null) {
    const i = info as Record<string, unknown>
    if (typeof i.sessionID === "string") return i.sessionID
    if (typeof i.sessionId === "string") return i.sessionId
  }
  return undefined
}

function readToolName(properties: unknown): string | undefined {
  if (typeof properties !== "object" || properties === null) return undefined
  const obj = properties as Record<string, unknown>
  if (typeof obj.tool === "string") return obj.tool
  if (typeof obj.toolName === "string") return obj.toolName
  return undefined
}

export function createSessionNotification(
  ctx: NotificationSenderContext,
  config: SessionNotificationConfig,
  deps: SessionNotificationDeps = {},
): (input: { event: SessionNotificationEvent }) => Promise<void> {
  const tracker = deps.tracker ?? new SessionTracker()
  const sender = deps.sender ?? new NotificationSender(ctx)
  const scheduler =
    deps.scheduler ??
    new IdleScheduler(config.idleConfirmationDelayMs, async () => {
      await sender.send({ title: config.title, message: config.idleMessage })
      if (config.playSound) await sender.playSound(config.soundPath)
    })

  return async ({ event }) => {
    try {
      const sessionId = readSessionId(event.properties)

      if (event.type === "session.created") {
        if (sessionId !== undefined) tracker.registerSession(sessionId)
        return
      }

      if (event.type === "session.deleted") {
        if (sessionId !== undefined) {
          tracker.deleteSession(sessionId)
          scheduler.cancel(sessionId)
        }
        return
      }

      if (sessionId === undefined) return

      if (event.type === "session.idle") {
        if (tracker.isMain(sessionId)) scheduler.schedule(sessionId)
        return
      }

      if (ACTIVITY_EVENT_TYPES.has(event.type)) {
        scheduler.markActivity(sessionId)
        return
      }

      if (event.type === "tool.execute.before") {
        const toolName = readToolName(event.properties)
        if (toolName !== undefined && QUESTION_TOOL_PATTERN.test(toolName)) {
          if (tracker.isMain(sessionId)) {
            await sender.send({ title: config.title, message: config.questionMessage })
            if (config.playSound) await sender.playSound(config.soundPath)
          }
          return
        }
        scheduler.markActivity(sessionId)
        return
      }

      if (event.type === "tool.execute.after") {
        scheduler.markActivity(sessionId)
        return
      }

      if (PERMISSION_EVENT_TYPES.has(event.type)) {
        if (tracker.isMain(sessionId)) {
          await sender.send({ title: config.title, message: config.permissionMessage })
          if (config.playSound) await sender.playSound(config.soundPath)
        }
      }
    } catch (err) {
      console.error("[pantheon/session-notification]", err)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/session-notification/session-notification.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/session-notification/session-notification.ts tests/hooks/session-notification/session-notification.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(pantheon): add session-notification event-routing orchestrator"
```

---

## Task 5: ENV config reader (pure function over `process.env`)

**Files:**
- Create: `src/hooks/session-notification/env-config.ts`
- Test: `tests/hooks/session-notification/env-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/session-notification/env-config.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_SESSION_NOTIFICATION_CONFIG,
  readConfigFromEnv,
} from "../../../src/hooks/session-notification/env-config.js"

describe("readConfigFromEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns defaults for an empty env", () => {
    expect(readConfigFromEnv({})).toEqual(DEFAULT_SESSION_NOTIFICATION_CONFIG)
  })

  it("applies title override", () => {
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_TITLE: "CustomTitle" })
    expect(c.title).toBe("CustomTitle")
  })

  it("applies all message overrides", () => {
    const c = readConfigFromEnv({
      AV_PANTHEON_NOTIFY_IDLE_MSG: "idle!",
      AV_PANTHEON_NOTIFY_QUESTION_MSG: "ask!",
      AV_PANTHEON_NOTIFY_PERMISSION_MSG: "perm!",
    })
    expect(c.idleMessage).toBe("idle!")
    expect(c.questionMessage).toBe("ask!")
    expect(c.permissionMessage).toBe("perm!")
  })

  it("parses a valid delay value", () => {
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "2500" })
    expect(c.idleConfirmationDelayMs).toBe(2500)
  })

  it("falls back to the default and warns on a non-numeric delay", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "abc" })
    expect(c.idleConfirmationDelayMs).toBe(DEFAULT_SESSION_NOTIFICATION_CONFIG.idleConfirmationDelayMs)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("falls back to the default and warns on a negative delay", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_DELAY_MS: "-100" })
    expect(c.idleConfirmationDelayMs).toBe(DEFAULT_SESSION_NOTIFICATION_CONFIG.idleConfirmationDelayMs)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("enables sound when AV_PANTHEON_NOTIFY_SOUND=1", () => {
    expect(readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND: "1" }).playSound).toBe(true)
  })

  it("leaves sound disabled for any other value", () => {
    expect(readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND: "true" }).playSound).toBe(false)
    expect(readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND: "" }).playSound).toBe(false)
  })

  it("applies a sound path override", () => {
    const c = readConfigFromEnv({ AV_PANTHEON_NOTIFY_SOUND_PATH: "/tmp/ding.aiff" })
    expect(c.soundPath).toBe("/tmp/ding.aiff")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/session-notification/env-config.test.ts`
Expected: FAIL — `Cannot find module '.../env-config.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/session-notification/env-config.ts`:

```ts
import type { SessionNotificationConfig } from "./session-notification.js"

export const DEFAULT_SESSION_NOTIFICATION_CONFIG: SessionNotificationConfig = {
  title: "AppVerk",
  idleMessage: "Agent is ready for input",
  questionMessage: "Agent is asking a question",
  permissionMessage: "Agent needs permission",
  idleConfirmationDelayMs: 1500,
  playSound: false,
  soundPath: "/System/Library/Sounds/Glass.aiff",
}

export function readConfigFromEnv(env: Record<string, string | undefined>): SessionNotificationConfig {
  const config: SessionNotificationConfig = { ...DEFAULT_SESSION_NOTIFICATION_CONFIG }

  if (typeof env.AV_PANTHEON_NOTIFY_TITLE === "string") {
    config.title = env.AV_PANTHEON_NOTIFY_TITLE
  }
  if (typeof env.AV_PANTHEON_NOTIFY_IDLE_MSG === "string") {
    config.idleMessage = env.AV_PANTHEON_NOTIFY_IDLE_MSG
  }
  if (typeof env.AV_PANTHEON_NOTIFY_QUESTION_MSG === "string") {
    config.questionMessage = env.AV_PANTHEON_NOTIFY_QUESTION_MSG
  }
  if (typeof env.AV_PANTHEON_NOTIFY_PERMISSION_MSG === "string") {
    config.permissionMessage = env.AV_PANTHEON_NOTIFY_PERMISSION_MSG
  }
  if (typeof env.AV_PANTHEON_NOTIFY_DELAY_MS === "string") {
    const parsed = Number.parseInt(env.AV_PANTHEON_NOTIFY_DELAY_MS, 10)
    if (Number.isFinite(parsed) && parsed >= 0) {
      config.idleConfirmationDelayMs = parsed
    } else {
      console.warn(
        `[pantheon/session-notification] invalid AV_PANTHEON_NOTIFY_DELAY_MS="${env.AV_PANTHEON_NOTIFY_DELAY_MS}"; using default ${DEFAULT_SESSION_NOTIFICATION_CONFIG.idleConfirmationDelayMs}ms`,
      )
    }
  }
  if (env.AV_PANTHEON_NOTIFY_SOUND === "1") {
    config.playSound = true
  }
  if (typeof env.AV_PANTHEON_NOTIFY_SOUND_PATH === "string") {
    config.soundPath = env.AV_PANTHEON_NOTIFY_SOUND_PATH
  }

  return config
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/session-notification/env-config.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/session-notification/env-config.ts tests/hooks/session-notification/env-config.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(pantheon): add env-driven config reader for session-notification"
```

---

## Task 6: Plugin factory (AppVerkPantheonPlugin)

**Files:**
- Create: `src/hooks/session-notification/plugin.ts`

(No new test file — the factory is exercised end-to-end in the root packaging test added in Task 7. The pieces it composes are already independently tested in Tasks 1-5.)

- [ ] **Step 1: Write the implementation**

Create `src/hooks/session-notification/plugin.ts`:

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { readConfigFromEnv } from "./env-config.js"
import type { NotificationSenderContext } from "./notification-sender.js"
import { createSessionNotification } from "./session-notification.js"

export const AppVerkPantheonPlugin: Plugin = async (ctx) => {
  if (process.env.AV_PANTHEON_NOTIFY === "0") {
    return {}
  }
  const config = readConfigFromEnv(process.env)
  // OpenCode's PluginInput.$ is Bun's `$`, whose parameter type is tighter
  // than our structural ShellTag. The cast is safe at runtime — both shapes
  // expose the same tagged-template shell with `.quiet()` / `.nothrow()`.
  const handler = createSessionNotification(ctx as unknown as NotificationSenderContext, config)
  return { event: handler }
}
```

- [ ] **Step 2: Typecheck the new file**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/session-notification/plugin.ts
AV_COMMIT_SKILL=1 git commit -m "feat(pantheon): add AppVerkPantheonPlugin factory wiring ENV config to handler"
```

---

## Task 7: Wire into root, fix build script, add packaging test

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json` (`build:root` script, `files` array)
- Modify: `tests/root-plugin.test.ts`

This task is split into three sequential micro-changes inside one commit. Do them in order — `build:root` must change before `npm run test` runs, because `npm run test` invokes `build:root` and the current single-file `cp` would silently drop the new `src/hooks/` tree.

- [ ] **Step 1: Update `build:root` to copy the compiled tree recursively**

In `package.json`, change the `build:root` script from:

```json
"build:root": "tsc -p tsconfig.build.json && cp .tmp-build/src/index.js src/index.js && cp .tmp-build/src/index.d.ts src/index.d.ts && rm -rf .tmp-build",
```

to:

```json
"build:root": "tsc -p tsconfig.build.json && cp -R .tmp-build/src/. src/ && rm -rf .tmp-build",
```

- [ ] **Step 2: Update `files` array so the published tarball ships the whole `src/`**

In `package.json`, replace the two existing `src/index.*` entries:

```json
"files": [
  "src/index.js",
  "src/index.d.ts",
  ...
],
```

with a single entry for the directory:

```json
"files": [
  "src",
  ...
],
```

Keep the existing `packages/*/dist` entries untouched.

- [ ] **Step 3: Wire `AppVerkPantheonPlugin` into the merged plugin**

In `src/index.ts`, add the import alongside the other plugin imports (top of the file):

```ts
import { AppVerkPantheonPlugin } from "./hooks/session-notification/plugin.js"
```

Then append it to `defaultPluginFactories`:

```ts
const defaultPluginFactories: Plugin[] = [
  AppVerkCommitPlugin,
  AppVerkPythonDeveloperPlugin,
  AppVerkCodeReviewPlugin,
  AppVerkFrontendDeveloperPlugin,
  AppVerkSkillRegistryPlugin,
  AppVerkQAPlugin,
  AppVerkSwiftDeveloperPlugin,
  AppVerkCoordinatorPlugin,
  AppVerkPantheonPlugin,
]
```

- [ ] **Step 4: Add a packaging test in `tests/root-plugin.test.ts`**

Append to the existing `describe("AppVerkPlugins", …)` block (use the same `loadRootModule` helper that the other tests in the file already use):

```ts
  it("registers the Pantheon session-notification event hook", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    expect(typeof plugin.event).toBe("function")
    // Smoke: feed a synthetic event; must not throw.
    await expect(
      plugin.event!({ event: { type: "session.idle", properties: { sessionID: "ses_unknown" } } } as never),
    ).resolves.toBeUndefined()
  })

  it("disables the Pantheon hook when AV_PANTHEON_NOTIFY=0", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const previous = process.env.AV_PANTHEON_NOTIFY
    process.env.AV_PANTHEON_NOTIFY = "0"
    try {
      const plugin = await AppVerkPlugins({} as never)
      // Other plugins may still register an event handler; we only assert this
      // call does not throw, since the Pantheon plugin should now be a no-op.
      if (typeof plugin.event === "function") {
        await expect(
          plugin.event({ event: { type: "session.idle", properties: { sessionID: "ses_x" } } } as never),
        ).resolves.toBeUndefined()
      }
    } finally {
      if (previous === undefined) delete process.env.AV_PANTHEON_NOTIFY
      else process.env.AV_PANTHEON_NOTIFY = previous
    }
  })
```

ENV is read inside the `AppVerkPantheonPlugin` factory body on every invocation, so no `vi.resetModules()` is needed — the env override picks up immediately.

- [ ] **Step 5: Build the root, then run all tests**

Run: `npm run build:root`
Expected: succeeds; `src/index.js`, `src/index.d.ts`, and `src/hooks/session-notification/*.js`, `src/hooks/session-notification/*.d.ts` exist on disk.

Run: `npm run check`
Expected: typecheck passes, all tests pass (root + every workspace), build runs clean. Pay attention to the existing `verify-dist-sync` step — it must still succeed; if it now flags `src/hooks/**`, extend `scripts/verify-dist-sync.mjs` so it includes the new subtree (mirroring the policy already applied to `src/index.js`).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/index.js src/index.d.ts src/hooks/session-notification package.json tests/root-plugin.test.ts scripts/verify-dist-sync.mjs
AV_COMMIT_SKILL=1 git commit -m "feat(pantheon): wire AppVerkPantheonPlugin into root and recursive build copy"
```

(If `scripts/verify-dist-sync.mjs` did not need editing, drop it from the `git add`.)

---

## Task 8: Documentation

**Files:**
- Create: `docs/plugins/pantheon.md`
- Modify: `README.md` — add a "Pantheon (session notifications)" subsection under the existing plugin list

- [ ] **Step 1: Create the plugin doc**

Create `docs/plugins/pantheon.md`:

```markdown
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
```

- [ ] **Step 2: Add a README pointer**

In `README.md`, find the plugin list / table and append a row referencing Pantheon (style consistent with the existing entries, e.g. `[Pantheon (session notifications)](docs/plugins/pantheon.md)`).

- [ ] **Step 3: Commit**

```bash
git add docs/plugins/pantheon.md README.md
AV_COMMIT_SKILL=1 git commit -m "docs(pantheon): document session-notification hook and configuration ENV"
```

---

## Final verification

After Task 8, perform a manual smoke test on macOS (not automated):

1. `npm run build` — ensures everything compiles and dist outputs are fresh.
2. Open OpenCode in this repo. Wait for `session.idle` after a short turn.
3. Confirm a macOS banner with title `AppVerk` and message `Agent is ready for input` appears within ~1.5s.
4. Trigger an `AskUserQuestion` via an agent — confirm an immediate banner with message `Agent is asking a question`.
5. Trigger a permission prompt (e.g. an unallowed bash command) — confirm an immediate banner.
6. Set `AV_PANTHEON_NOTIFY_SOUND=1` and repeat (1); confirm Glass.aiff plays.
7. Set `AV_PANTHEON_NOTIFY=0` and repeat (1); confirm no banner appears.

Record results in the PR description.
