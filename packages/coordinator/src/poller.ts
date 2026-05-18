export interface PollerMessage {
  role: string
  content: string
  finish_reason?: string | null | undefined
}

export interface PollUntilIdleOptions {
  fetchMessages: () => Promise<PollerMessage[]>
  timeoutMs: number
  pollIntervalMs: number
}

export async function pollUntilIdle(options: PollUntilIdleOptions): Promise<string> {
  const { fetchMessages, timeoutMs, pollIntervalMs } = options
  const startTime = Date.now()

  while (true) {
    const elapsed = Date.now() - startTime
    if (elapsed >= timeoutMs) {
      throw new Error(`pollUntilIdle: timeout after ${elapsed}ms`)
    }

    const messages = await fetchMessages()
    const last: PollerMessage | undefined = messages[messages.length - 1]

    if (last !== undefined && last.role === "assistant" && last.finish_reason) {
      return last.content
    }

    const remaining = timeoutMs - (Date.now() - startTime)
    if (remaining <= 0) {
      const elapsedNow = Date.now() - startTime
      throw new Error(`pollUntilIdle: timeout after ${elapsedNow}ms`)
    }

    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)))
  }
}
