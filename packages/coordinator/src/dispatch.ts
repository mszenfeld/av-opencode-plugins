import {
  pollUntilIdle,
  PollerAbortError,
  PollerTimeoutError,
  type PollerMessage,
} from "./poller.js"
import { neutralizeUntrustedOutput } from "./sanitize.js"
import { truncateBytes } from "./truncate-bytes.js"

export interface DispatchTask {
  name: string
  prompt: string
  context?: string
}

export interface DispatchResult {
  name: string
  status: "success" | "error" | "timeout" | "aborted"
  result: string
  duration_ms: number
  error?: string
}

export interface DispatchSpecialist {
  startTask(agentName: string, prompt: string): Promise<string>
  fetchMessages(sessionId: string): Promise<PollerMessage[]>
  /**
   * Cancel a previously-started session. Called when `ToolContext.abort`
   * fires so the child session is cleaned up server-side (no orphaned
   * compute, no charges) — see COMPOSITE-3 / ARCH-001. Implementations
   * should treat this as best-effort: errors must not surface to the
   * caller (the abort path already returns an "aborted" result).
   */
  abortTask(sessionId: string): Promise<void>
}

export interface AgentInfo {
  mode: "primary" | "subagent" | "all"
}

export interface DispatchParallelInput {
  tasks: DispatchTask[]
  agentRegistry: Record<string, AgentInfo>
  specialist: DispatchSpecialist
  pollIntervalMs?: number
  taskTimeoutMs?: number
  resultMaxBytes?: number
  /**
   * Optional abort signal threaded through to every in-flight task. When the
   * signal aborts, each task whose poller is still running terminates within
   * one poll-interval with status `"aborted"`, and `abortTask(sessionId)` is
   * called best-effort so the child session is cancelled server-side.
   */
  signal?: AbortSignal
}

// 1 s tail-latency budget on completion observation. `session.prompt` in the
// OpenCode SDK already blocks for the full LLM turn, so polling is mostly
// confirmatory — 1 s is a sensible compromise between server-load and tail.
export const DEFAULT_POLL_INTERVAL_MS = 1000
export const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000
export const DEFAULT_RESULT_MAX_BYTES = 100 * 1024
export const MAX_PARALLEL_TASKS = 50
export const DISPATCH_CONCURRENCY = 4

export async function dispatchParallel(
  input: DispatchParallelInput,
): Promise<DispatchResult[]> {
  const {
    tasks,
    agentRegistry,
    specialist,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES,
    signal,
  } = input

  if (tasks.length > MAX_PARALLEL_TASKS) {
    throw new Error(
      `dispatch_parallel: tasks.length (${tasks.length}) exceeds DISPATCH_MAX_TASKS (${MAX_PARALLEL_TASKS})`,
    )
  }

  // Anti-recursion: validate every task BEFORE any session spawns.
  for (const task of tasks) {
    const agentInfo = agentRegistry[task.name]
    if (agentInfo === undefined) {
      throw new Error(`Unknown agent: ${task.name}`)
    }
    // Default-deny: only strict "subagent" mode is dispatchable. Both "primary"
    // and "all" modes are rejected to prevent anti-recursion bypass — an "all"
    // agent can be invoked as a primary, so dispatching it from a primary
    // would re-open the recursion door MAINT-001/ARCH-002 closed.
    if (agentInfo.mode !== "subagent") {
      throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${task.name}`)
    }
  }

  // Worker pool: maintain DISPATCH_CONCURRENCY workers draining a shared queue.
  // `next++` is race-free in single-threaded JS between `await` points.
  const results: DispatchResult[] = new Array(tasks.length)
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted === true) {
        // Drain any remaining task slots as never-started aborts so the
        // results array has a defined entry at every index.
        while (next < tasks.length) {
          const i = next++
          const task = tasks[i]!
          results[i] = {
            name: task.name,
            status: "aborted",
            result: "",
            duration_ms: 0,
            error: "aborted before start",
          }
        }
        return
      }
      const i = next++
      if (i >= tasks.length) return
      const task = tasks[i]!
      results[i] = await runTask(task, specialist, {
        pollIntervalMs,
        taskTimeoutMs,
        resultMaxBytes,
        signal,
      })
    }
  }

  const workerCount = Math.min(DISPATCH_CONCURRENCY, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/**
 * Discriminates a `runTask` failure by error class. Kept as a pure helper so
 * the happy-path in `runTask` stays focused (MAINT-008). New poller error
 * types should be added here, not in the caller.
 */
function classifyError(err: unknown): "timeout" | "error" | "aborted" {
  if (err instanceof PollerAbortError) {
    return "aborted"
  }
  if (err instanceof PollerTimeoutError) {
    return "timeout"
  }
  return "error"
}

/**
 * Best-effort server-side cancellation of a dispatched child session. Called
 * from the abort path so the specialist stops doing work and resources are
 * released. Errors are swallowed — the caller is already returning an
 * "aborted" result and we must not mask it (see COMPOSITE-3 / ARCH-001).
 */
async function cleanupOnAbort(
  specialist: DispatchSpecialist,
  sessionId: string | undefined,
): Promise<void> {
  if (sessionId === undefined) {
    return
  }
  try {
    await specialist.abortTask(sessionId)
  } catch {
    /* swallow: best-effort cleanup */
  }
}

async function runTask(
  task: DispatchTask,
  specialist: DispatchSpecialist,
  options: {
    pollIntervalMs: number
    taskTimeoutMs: number
    resultMaxBytes: number
    signal?: AbortSignal
  },
): Promise<DispatchResult> {
  const startTime = Date.now()
  let sessionId: string | undefined

  try {
    const fullPrompt = task.context ? `${task.prompt}\n\n${task.context}` : task.prompt
    const id = await specialist.startTask(task.name, fullPrompt)
    // Mirror into the outer `let` so the catch block's abort-path cleanup can
    // see the session id even when failure occurs after `startTask` resolves.
    sessionId = id

    const rawResult = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(id),
      timeoutMs: options.taskTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      // Bound in-flight memory in the poller too (SEC-010): the per-poll cap
      // matches the final cap so we never hold an oversized string before the
      // final truncation pass below.
      maxBytes: options.resultMaxBytes,
    })

    // Treat specialist output as untrusted (SEC-001), then truncate by UTF-8
    // byte length, not UTF-16 code units (SEC-009 / MAINT-006).
    const result = truncateBytes(neutralizeUntrustedOutput(rawResult), options.resultMaxBytes)

    return {
      name: task.name,
      status: "success",
      result,
      duration_ms: Date.now() - startTime,
    }
  } catch (err) {
    const status = classifyError(err)
    if (status === "aborted") {
      await cleanupOnAbort(specialist, sessionId)
    }
    return {
      name: task.name,
      status,
      result: "",
      duration_ms: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
