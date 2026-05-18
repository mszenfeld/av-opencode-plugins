import { pollUntilIdle, type PollerMessage } from "./poller.js"

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
  createSession(agentName: string): Promise<string>
  sendPrompt(sessionId: string, prompt: string): Promise<void>
  fetchMessages(sessionId: string): Promise<PollerMessage[]>
}

export interface AgentInfo {
  mode: "primary" | "subagent" | string
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

  // Pre-flight validation — must run BEFORE any session creation
  for (const task of tasks) {
    const agentInfo = agentRegistry[task.name]
    if (agentInfo === undefined) {
      throw new Error(`Unknown agent: ${task.name}`)
    }
    if (agentInfo.mode === "primary") {
      throw new Error(`Cannot dispatch primary agent: ${task.name}`)
    }
  }

  // Launch all tasks in parallel; use allSettled so one failure doesn't abort others
  const settled = await Promise.allSettled(
    tasks.map(async (task): Promise<DispatchResult> => {
      const startTime = Date.now()

      const sessionId = await specialist.createSession(task.name)
      const fullPrompt = task.context
        ? `${task.prompt}\n\n${task.context}`
        : task.prompt

      await specialist.sendPrompt(sessionId, fullPrompt)

      let result = await pollUntilIdle({
        fetchMessages: () => specialist.fetchMessages(sessionId),
        timeoutMs: taskTimeoutMs,
        pollIntervalMs,
      })

      if (result.length > resultMaxBytes) {
        result = result.substring(0, resultMaxBytes) + "\n[…truncated…]"
      }

      const duration_ms = Date.now() - startTime
      return { name: task.name, status: "success", result, duration_ms }
    }),
  )

  return settled.map((outcome, index): DispatchResult => {
    if (outcome.status === "fulfilled") {
      return outcome.value
    }

    const reason = outcome.reason as unknown
    const errorMessage = String(reason)
    const isTimeout = /timeout/i.test(errorMessage)
    const task = tasks[index]
    const name = task !== undefined ? task.name : `task-${index}`

    return {
      name,
      status: isTimeout ? "timeout" : "error",
      result: "",
      duration_ms: 0,
      error: errorMessage,
    }
  })
}
