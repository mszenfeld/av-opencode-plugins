import {
  pollUntilIdle,
  PollerAbortError,
  PollerTimeoutError,
  type PollerMessage,
} from "./poller.js"
import { neutralizeUntrustedOutput, normalizeVariantSuffix } from "./sanitize.js"
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
   * compute, no charges). Implementations should treat this as best-effort:
   * errors must not surface to the caller (the abort path already returns
   * an "aborted" result).
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
export const DISPATCH_MAX_TASKS = 50
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

  if (tasks.length > DISPATCH_MAX_TASKS) {
    throw new Error(
      `dispatch_parallel: tasks.length (${tasks.length}) exceeds DISPATCH_MAX_TASKS (${DISPATCH_MAX_TASKS})`,
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
    // would re-open the anti-recursion guarantee.
    if (agentInfo.mode !== "subagent") {
      throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${task.name}`)
    }
  }

  // Worker pool: maintain DISPATCH_CONCURRENCY workers draining a shared queue.
  // `nextRef.value++` is race-free in single-threaded JS between `await` points.
  // `nextRef` is passed by reference so the abort-drain helper can advance the
  // shared cursor — keeps the queue invariant ("every index has a result")
  // testable in isolation from the run-loop.
  const results: DispatchResult[] = new Array(tasks.length)
  const nextRef = { value: 0 }

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted === true) {
        // First worker to detect abort drains the remaining slots; later
        // workers see `nextRef.value >= tasks.length` and exit immediately.
        fillUnstartedAsAborted(results, tasks, nextRef)
        return
      }
      const i = nextRef.value++
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

  // Convert the variant-suffix invariant from a prompt-only convention into
  // a code-enforced one. The agent registry still validates input task names
  // as the original variants (zmora-fe / zmora-be); only the OUTPUT
  // `name` and `error` strings are normalised, so prompt drift or partial
  // injection cannot leak `zmora-fe` / `zmora-be` into reports.
  for (const r of results) {
    r.name = normalizeVariantSuffix(r.name)
    if (r.error !== undefined) {
      r.error = normalizeVariantSuffix(r.error)
    }
  }
  return results
}

/**
 * Drain every task slot that the worker pool has not yet claimed and fill it
 * with a "never-started" aborted result. Called from the abort branch of
 * `worker()` so the post-condition "every index in `results` has a defined
 * entry" still holds after the pool short-circuits.
 *
 * Single-writer invariant: only the first worker to observe `signal.aborted`
 * reaches this drain — by the time it returns, `nextRef.value >= tasks.length`,
 * so every subsequent worker takes the `i >= tasks.length` exit. `nextRef.value++`
 * is race-free in single-threaded JS between `await` points (no awaits here).
 *
 * `name: task.name` is the raw variant name; the final normalisation pass
 * in `dispatchParallel` rewrites it to the logical agent name, so we don't
 * normalise here.
 */
function fillUnstartedAsAborted(
  results: DispatchResult[],
  tasks: DispatchTask[],
  nextRef: { value: number },
): void {
  while (nextRef.value < tasks.length) {
    const i = nextRef.value++
    const task = tasks[i]!
    results[i] = {
      name: task.name,
      status: "aborted",
      result: "",
      duration_ms: 0,
      error: "aborted before start",
    }
  }
}

/**
 * Discriminates a `runTask` failure by error class. Kept as a pure helper so
 * the happy-path in `runTask` stays focused. New poller error types should
 * be added here, not in the caller.
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
 * "aborted" result and we must not mask it.
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
      // Bound in-flight memory in the poller too: the per-poll cap matches
      // the final cap so we never hold an oversized string before the final
      // truncation pass below.
      maxBytes: options.resultMaxBytes,
    })

    // Treat specialist output as untrusted, then truncate by UTF-8 byte
    // length, not UTF-16 code units.
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
      error: neutralizeUntrustedOutput(err instanceof Error ? err.message : String(err)),
    }
  }
}
