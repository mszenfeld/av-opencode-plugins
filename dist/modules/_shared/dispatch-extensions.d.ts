import { SessionAgentRegistry } from './session-agent-registry.js';

/**
 * Cross-module wiring for `dispatch_parallel`.
 *
 * The coordinator module owns `dispatchParallel(...)` — the pool, the poller,
 * the abort plumbing. But two pieces of behaviour are owned by other modules:
 *
 *   - The QA plugin owns `SessionAgentRegistry` (so the `shell.env` hook can
 *     resolve `childSessionID → agent name`), and a scrubber that redacts known
 *     secret values from specialist results.
 *   - The QA plugin also owns the bindings-parsing entry point (the QA plan's
 *     `## Setup` → `**Bindings:**` section gets parsed into `QaRunState` so
 *     `execute_recipe` can find recipes by name).
 *
 * If the coordinator imported `../qa/*` directly we would invert the layering:
 * the orchestration module would depend on a feature module. Instead this
 * module is a write-once registry that the QA plugin populates at startup,
 * and the coordinator reads from at `dispatch_parallel` execute time.
 *
 * The QA plugin owns lifetime: it constructs the singletons, registers them
 * here, and clears them inside its own `session.deleted` handler. The
 * coordinator is read-only.
 *
 * Test discipline: each module's unit tests must NOT touch this singleton.
 * Use the `*Hook`s parameters directly (the coordinator's `dispatchParallel`
 * already takes `sessionAgentRegistry`, `scrubber`, `parentSessionID` as
 * inputs — this module is only the wiring at the plugin boundary).
 */

/**
 * Hook invoked by `dispatch_parallel` BEFORE any specialist session is spawned
 * for a given parent (Perun) session. The QA plugin uses this to lazily parse
 * the plan's `**Bindings:**` section and call `QaRunState.storePlan(...)` so
 * that `execute_recipe` can subsequently find recipes by name.
 *
 * Implementations:
 *   - MUST be idempotent — `dispatch_parallel` may fire multiple waves for the
 *     same parent session.
 *   - MUST NOT throw — wrap errors and swallow; a bindings-parse failure must
 *     not break unrelated QA dispatches.
 *   - MUST resolve before any task is started — the bindings need to be in
 *     `QaRunState` BEFORE the first `zmora-setup` task calls `execute_recipe`.
 *
 * Receives the parent session ID so the QA plugin can scope state by parent.
 * Receives the array of task names so the hook can short-circuit when none of
 * the tasks are zmora-setup (no bindings work to do).
 */
type DispatchPreflightHook = (input: {
    parentSessionID: string;
    taskNames: readonly string[];
}) => Promise<void>;
/**
 * Scrubber applied to each specialist task result AFTER the untrusted-output
 * neutraliser, BEFORE truncation. See `dispatch.ts` for the exact ordering.
 *
 * Signature matches `DispatchParallelInput.scrubber`.
 */
type DispatchScrubber = (text: string, parentSessionID: string) => string;
/**
 * Per-dispatch scrubber session. Returned by a `DispatchScrubberFactory` at
 * the start of `dispatchParallel`, with `release()` called in a `finally` once
 * every task in the wave has produced a result.
 *
 *   - `scrub(text)` runs on each task result; the implementation closes over
 *     a snapshot pinned at session-creation time so concurrent mutations to
 *     the underlying secret store cannot expose values mid-dispatch.
 *   - `release()` MUST be called exactly once. Repeated calls should be a
 *     no-op (defensive against double-invocation in error paths).
 */
interface DispatchScrubberSession {
    scrub: (text: string) => string;
    release: () => void;
}
/**
 * Factory that pins a per-dispatch scrubber session. Called ONCE per
 * `dispatchParallel` call, before any specialist session is spawned, and the
 * returned `scrub` is applied to every task result in the wave.
 *
 * The factory pattern lets the QA plugin pin a `BindingSnapshot` at dispatch
 * start so the scrubber operates on a coherent view of bindings even when
 * `execute_recipe` mints new ones (or `clearParent` runs) concurrently —
 * fixes the race-window between snapshot existence and live-state reads
 * (ARCH-004 / CWE-362).
 *
 * MUST NOT throw — wrap and swallow internally. A factory failure must not
 * break unrelated dispatches; if pinning fails, return `undefined` so the
 * dispatch falls back to no scrubbing.
 */
type DispatchScrubberFactory = (parentSessionID: string) => DispatchScrubberSession | undefined;
/**
 * Bundle of dispatch-time extensions. `undefined` fields are no-ops:
 *
 *   - `sessionAgentRegistry`: when set, dispatch records (childSessionID → task.name)
 *     so plugin hooks (e.g. shell.env) can resolve agent identity per session.
 *   - `scrubber`: legacy live-read scrubber. Still applied if `scrubberFactory`
 *     is unset. Prefer `scrubberFactory` for any store-backed scrubber that
 *     would otherwise race against concurrent writes.
 *   - `scrubberFactory`: when set, takes precedence over `scrubber`. Produces
 *     one snapshot-pinned scrubber session per `dispatch_parallel` call.
 *   - `preflight`: when set, runs once per `dispatch_parallel` call before any
 *     session is spawned.
 */
interface DispatchExtensions {
    sessionAgentRegistry?: SessionAgentRegistry;
    scrubber?: DispatchScrubber;
    scrubberFactory?: DispatchScrubberFactory;
    preflight?: DispatchPreflightHook;
}
/**
 * Register extensions for `dispatch_parallel`. Called once by the QA plugin
 * at plugin-init time. Subsequent calls merge — a second registrar may add
 * a scrubber without clearing the registry. Tests can `clearDispatchExtensions()`
 * between cases.
 */
declare function registerDispatchExtensions(extensions: DispatchExtensions): void;
/**
 * Read the current extensions bundle. The returned reference is NOT stable:
 * `registerDispatchExtensions()` replaces the bundle with a fresh object on each
 * call, and `clearDispatchExtensions()` resets it. Callers must re-read after any
 * registration rather than caching the result, and should NOT mutate the bundle.
 */
declare function getDispatchExtensions(): DispatchExtensions;
/**
 * Reset to empty. Only used by tests — production code never clears.
 */
declare function clearDispatchExtensions(): void;

export { type DispatchExtensions, type DispatchPreflightHook, type DispatchScrubber, type DispatchScrubberFactory, type DispatchScrubberSession, clearDispatchExtensions, getDispatchExtensions, registerDispatchExtensions };
