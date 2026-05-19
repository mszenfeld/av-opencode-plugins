import {
  pollUntilIdle,
  PollerAbortError,
  PollerTimeoutError,
  type PollerMessage,
} from "./poller.js"
import { neutralizeUntrustedOutput } from "./sanitize.js"

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

export const DEFAULT_POLL_INTERVAL_MS = 2000
export const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000
export const DEFAULT_RESULT_MAX_BYTES = 100 * 1024
export const MAX_PARALLEL_TASKS = 10
const TRUNCATION_MARKER = "\n[…truncated…]"

/**
 * UTF-8-safe byte-bounded truncation. Slices the underlying bytes at the cap
 * and decodes with `fatal: false` so a partial trailing multi-byte sequence
 * is dropped rather than rendered as a replacement character (SEC-009 /
 * MAINT-006: prior implementation truncated by UTF-16 code units, which both
 * over-counts ASCII and silently corrupts multi-byte characters at the cut).
 */
function truncateBytes(input: string, maxBytes: number): string {
  const buf = Buffer.from(input, "utf8")
  if (buf.byteLength <= maxBytes) {
    return input
  }
  const sliced = buf.subarray(0, maxBytes)
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced)
  return decoded + TRUNCATION_MARKER
}

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
      `dispatch_parallel: too many tasks (${tasks.length}); maximum is ${MAX_PARALLEL_TASKS}`,
    )
  }

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

  return Promise.all(
    tasks.map((task) =>
      runTask(task, specialist, { pollIntervalMs, taskTimeoutMs, resultMaxBytes, signal }),
    ),
  )
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
    sessionId = await specialist.startTask(task.name, fullPrompt)

    const rawResult = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(sessionId as string),
      timeoutMs: options.taskTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      // Bound in-flight memory in the poller too (SEC-010): the per-poll cap
      // matches the final cap so we never hold an oversized string before the
      // final truncation pass below.
      maxBytes: options.resultMaxBytes,
    })

    // Treat specialist output as untrusted: strip ANSI/control characters and
    // escape HTML-like substrings before the string flows back into the
    // coordinator's prompt context. See SEC-001 / sanitize.ts.
    let result = neutralizeUntrustedOutput(rawResult)

    // SEC-009 / MAINT-006: truncate by UTF-8 byte length, not UTF-16 code
    // units. The `result.length` check was wrong on two axes — it over-counts
    // ASCII (1 char == 1 byte but `length` counted both equally fine, so
    // ASCII payloads under the cap were never truncated incorrectly here,
    // but) it severely under-bounds payloads containing 2-byte UTF-8 chars
    // (Polish/CJK/emoji) and could even split a surrogate pair mid-character.
    result = truncateBytes(result, options.resultMaxBytes)

    return {
      name: task.name,
      status: "success",
      result,
      duration_ms: Date.now() - startTime,
    }
  } catch (err) {
    let status: "timeout" | "error" | "aborted"
    if (err instanceof PollerAbortError) {
      status = "aborted"
      // Best-effort cleanup: cancel the child session server-side so the
      // dispatched agent stops doing work and resources are released. Errors
      // here are swallowed — we are already on the abort path.
      if (sessionId !== undefined) {
        try {
          await specialist.abortTask(sessionId)
        } catch {
          /* swallow: best-effort cleanup */
        }
      }
    } else if (err instanceof PollerTimeoutError) {
      status = "timeout"
    } else {
      status = "error"
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
