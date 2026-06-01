import { SessionAgentRegistry } from '../_shared/session-agent-registry.js';
import { PollerMessage } from './poller.js';

interface DispatchTask {
    name: string;
    prompt: string;
    context?: string;
}
interface DispatchResult {
    name: string;
    status: "success" | "error" | "timeout" | "aborted";
    result: string;
    duration_ms: number;
    error?: string;
}
interface DispatchSpecialist {
    startTask(agentName: string, prompt: string): Promise<string>;
    fetchMessages(sessionId: string): Promise<PollerMessage[]>;
    /**
     * Cancel a previously-started session. Called when `ToolContext.abort`
     * fires so the child session is cleaned up server-side (no orphaned
     * compute, no charges). Implementations should treat this as best-effort:
     * errors must not surface to the caller (the abort path already returns
     * an "aborted" result).
     */
    abortTask(sessionId: string): Promise<void>;
    /**
     * Start a task in the background: create the child session, then fire it via
     * `session.promptAsync` (returns a 204 immediately; the server runs the LLM
     * turn autonomously). Resolves the child session id WITHOUT awaiting the turn.
     * Rejects if session creation or the async-prompt acknowledgement fails.
     */
    startBackground(agentName: string, prompt: string): Promise<string>;
}
interface AgentInfo {
    mode: "primary" | "subagent" | "all";
}
/**
 * Names of `mode: "all"` agents that MAY be dispatched — but ONLY by a
 * primary-mode caller. This is the single narrow relaxation of the otherwise
 * subagent-only rule: it lets the primary coordinator (Perun) dispatch the
 * planning agent (Veles, a `mode: "all"` agent that is also user-switchable)
 * while still blocking Veles→Veles, *→Perun, and any other `primary`/`all`
 * target. Keep this set MINIMAL — every entry widens the anti-recursion surface.
 */
declare const DISPATCHABLE_ALL_AGENTS: ReadonlySet<string>;
/**
 * Anti-recursion guard. Dispatchable targets:
 *   - any strict `subagent` (from any caller), OR
 *   - an allowlisted `all` agent (DISPATCHABLE_ALL_AGENTS) when the CALLER is
 *     `primary`.
 * Everything else throws: a `primary` target, a non-allowlisted `all` target,
 * or an allowlisted `all` target dispatched by a non-primary caller (this last
 * case blocks Veles→Veles self/nested recursion). `callerMode` is resolved by
 * the dispatch tool from `agentRegistry[context.agent].mode`; when omitted
 * (legacy callers / unit tests) the allowlisted-`all` path is closed, so the
 * default stays safe. Shared by `dispatchParallel` and the background path.
 */
declare function validateDispatchable(agentRegistry: Record<string, AgentInfo>, name: string, callerMode?: AgentInfo["mode"]): void;
interface DispatchParallelInput {
    tasks: DispatchTask[];
    agentRegistry: Record<string, AgentInfo>;
    specialist: DispatchSpecialist;
    pollIntervalMs?: number;
    taskTimeoutMs?: number;
    resultMaxBytes?: number;
    /**
     * Optional abort signal threaded through to every in-flight task. When the
     * signal aborts, each task whose poller is still running terminates within
     * one poll-interval with status `"aborted"`, and `abortTask(sessionId)` is
     * called best-effort so the child session is cancelled server-side.
     */
    signal?: AbortSignal;
    /**
     * Optional registry that records (childSessionID → task.name) at dispatch
     * time. Consumed by plugin hooks (e.g. shell.env) that need to know which
     * agent is running in a given session. Registration persists for the
     * OpenCode session lifetime; cleanup is the plugin's session.deleted
     * handler — not unregistered inside dispatch.
     */
    sessionAgentRegistry?: SessionAgentRegistry;
    /**
     * Optional log-scrubber applied to every task result after the untrusted-
     * output neutraliser, before truncation. Receives (text, parentSessionID)
     * and returns redacted text. Used by the QA bindings flow to redact known
     * secret values from Zmora results before they reach the report or TUI.
     *
     * If a `scrubberFactory` is also provided, the factory wins and this field
     * is ignored — the factory yields a pinned-snapshot scrubber, which is the
     * race-safe path.
     */
    scrubber?: (text: string, parentSessionID: string) => string;
    /**
     * Optional factory that produces a per-dispatch scrubber session. Called
     * ONCE at the start of `dispatchParallel`; the returned `scrub(text)` is
     * applied to every task result; `release()` is invoked in a `finally` after
     * all tasks complete (success, failure, or abort). Takes precedence over
     * `scrubber`. This is the only race-safe scrubber path for store-backed
     * implementations — see `DispatchScrubberFactory` for the contract.
     */
    scrubberFactory?: (parentSessionID: string) => {
        scrub: (text: string) => string;
        release: () => void;
    } | undefined;
    /**
     * Parent (Perun) session ID — passed to the scrubber/factory. Required if
     * either is set; ignored otherwise.
     */
    parentSessionID?: string;
    /**
     * Mode of the agent that invoked the dispatch tool (resolved from
     * `agentRegistry[context.agent]`). Passed to `validateDispatchable` so an
     * allowlisted `all` target (Veles) is dispatchable only from a `primary`
     * caller (Perun). Omitted ⇒ allowlisted-`all` dispatch is rejected.
     */
    callerMode?: AgentInfo["mode"];
    /**
     * Optional preflight hook fired ONCE per `dispatchParallel` call, before any
     * specialist session is spawned. The QA plugin uses this to lazily parse the
     * parent plan's `**Bindings:**` section into `QaRunState` so subsequent
     * `execute_recipe` calls can find recipes by name. Implementations must be
     * idempotent and must not throw — preflight errors are swallowed so they
     * cannot break unrelated dispatches.
     */
    preflight?: (input: {
        parentSessionID: string;
        taskNames: readonly string[];
    }) => Promise<void>;
}
declare const DEFAULT_POLL_INTERVAL_MS = 1000;
declare const DEFAULT_TASK_TIMEOUT_MS: number;
declare const DEFAULT_RESULT_MAX_BYTES: number;
declare const DISPATCH_MAX_TASKS = 4;
declare const DISPATCH_CONCURRENCY = 4;
declare function dispatchParallel(input: DispatchParallelInput): Promise<DispatchResult[]>;

export { type AgentInfo, DEFAULT_POLL_INTERVAL_MS, DEFAULT_RESULT_MAX_BYTES, DEFAULT_TASK_TIMEOUT_MS, DISPATCHABLE_ALL_AGENTS, DISPATCH_CONCURRENCY, DISPATCH_MAX_TASKS, type DispatchParallelInput, type DispatchResult, type DispatchSpecialist, type DispatchTask, dispatchParallel, validateDispatchable };
