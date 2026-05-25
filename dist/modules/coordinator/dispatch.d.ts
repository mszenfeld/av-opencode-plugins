import { SessionAgentRegistry } from '../qa/shell-env-hook.js';
import { PollerMessage } from './poller.js';
import '../qa/bindings-store.js';
import '../qa/secret.js';

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
}
interface AgentInfo {
    mode: "primary" | "subagent" | "all";
}
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
     */
    scrubber?: (text: string, parentSessionID: string) => string;
    /**
     * Parent (Perun) session ID — passed to the scrubber. Required if scrubber
     * is set; ignored otherwise.
     */
    parentSessionID?: string;
}
declare const DEFAULT_POLL_INTERVAL_MS = 1000;
declare const DEFAULT_TASK_TIMEOUT_MS: number;
declare const DEFAULT_RESULT_MAX_BYTES: number;
declare const DISPATCH_MAX_TASKS = 4;
declare const DISPATCH_CONCURRENCY = 4;
declare function dispatchParallel(input: DispatchParallelInput): Promise<DispatchResult[]>;

export { type AgentInfo, DEFAULT_POLL_INTERVAL_MS, DEFAULT_RESULT_MAX_BYTES, DEFAULT_TASK_TIMEOUT_MS, DISPATCH_CONCURRENCY, DISPATCH_MAX_TASKS, type DispatchParallelInput, type DispatchResult, type DispatchSpecialist, type DispatchTask, dispatchParallel };
