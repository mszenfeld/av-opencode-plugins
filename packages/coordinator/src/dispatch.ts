import { pollUntilIdle, PollerTimeoutError, type PollerMessage } from "./poller.js"

export interface DispatchTask {
  name: string
  prompt: string
  context?: string
}

export interface DispatchResult {
  name: string
  status: "success" | "error" | "timeout"
  result: string
  duration_ms: number
  error?: string
}

export interface DispatchSpecialist {
  startTask(agentName: string, prompt: string): Promise<string>
  fetchMessages(sessionId: string): Promise<PollerMessage[]>
}

export interface AgentInfo {
  mode: "primary" | "subagent"
}

export interface DispatchParallelInput {
  tasks: DispatchTask[]
  agentRegistry: Record<string, AgentInfo>
  specialist: DispatchSpecialist
  pollIntervalMs?: number
  taskTimeoutMs?: number
  resultMaxBytes?: number
}

export const DEFAULT_POLL_INTERVAL_MS = 2000
export const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000
export const DEFAULT_RESULT_MAX_BYTES = 100 * 1024
const TRUNCATION_MARKER = "\n[…truncated…]"

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
  } = input

  for (const task of tasks) {
    const agentInfo = agentRegistry[task.name]
    if (agentInfo === undefined) {
      throw new Error(`Unknown agent: ${task.name}`)
    }
    if (agentInfo.mode === "primary") {
      throw new Error(`Cannot dispatch primary agent: ${task.name}`)
    }
  }

  return Promise.all(
    tasks.map((task) => runTask(task, specialist, { pollIntervalMs, taskTimeoutMs, resultMaxBytes })),
  )
}

async function runTask(
  task: DispatchTask,
  specialist: DispatchSpecialist,
  options: { pollIntervalMs: number; taskTimeoutMs: number; resultMaxBytes: number },
): Promise<DispatchResult> {
  const startTime = Date.now()

  try {
    const fullPrompt = task.context ? `${task.prompt}\n\n${task.context}` : task.prompt
    const sessionId = await specialist.startTask(task.name, fullPrompt)

    let result = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(sessionId),
      timeoutMs: options.taskTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
    })

    if (result.length > options.resultMaxBytes) {
      result = result.substring(0, options.resultMaxBytes) + TRUNCATION_MARKER
    }

    return {
      name: task.name,
      status: "success",
      result,
      duration_ms: Date.now() - startTime,
    }
  } catch (err) {
    const status: "timeout" | "error" = err instanceof PollerTimeoutError ? "timeout" : "error"
    return {
      name: task.name,
      status,
      result: "",
      duration_ms: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
