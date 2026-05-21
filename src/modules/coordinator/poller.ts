import { truncateBytes } from "./truncate-bytes.js"

export interface PollerMessage {
  role: string
  content: string
  finish_reason?: string | null | undefined
}

export interface PollUntilIdleOptions {
  fetchMessages: () => Promise<PollerMessage[]>
  timeoutMs: number
  pollIntervalMs: number
  /**
   * Optional abort signal. When the signal aborts during polling (or during
   * the inter-poll sleep), `pollUntilIdle` throws `PollerAbortError` within
   * one poll-interval — see COMPOSITE-3 / ARCH-001. This is how the
   * coordinator surfaces `ToolContext.abort` to in-flight child sessions.
   */
  signal?: AbortSignal
  /**
   * Optional byte-level cap on the polled assistant content (UTF-8 bytes).
   * When set, `pollUntilIdle` truncates the LAST message's content using a
   * UTF-8-safe slice before returning it as the result. Scope is limited to
   * `messages[last].content` — the full transcript array returned by
   * `fetchMessages` is still allocated in full by the SDK on each poll, so
   * this is not a true mid-stream / full-transcript memory bound. See
   * COMPOSITE-3 / SEC-010.
   */
  maxBytes?: number
}

export class PollerTimeoutError extends Error {
  readonly kind = "timeout" as const
  readonly elapsedMs: number

  constructor(elapsedMs: number) {
    super(`pollUntilIdle: timeout after ${elapsedMs}ms`)
    this.name = "PollerTimeoutError"
    this.elapsedMs = elapsedMs
  }
}

export class PollerAbortError extends Error {
  readonly kind = "abort" as const
  readonly elapsedMs: number

  constructor(elapsedMs: number) {
    super(`pollUntilIdle: aborted after ${elapsedMs}ms`)
    this.name = "PollerAbortError"
    this.elapsedMs = elapsedMs
  }
}

export async function pollUntilIdle(options: PollUntilIdleOptions): Promise<string> {
  const { fetchMessages, timeoutMs, pollIntervalMs, signal, maxBytes } = options
  const startTime = Date.now()

  while (true) {
    if (signal?.aborted === true) {
      throw new PollerAbortError(Date.now() - startTime)
    }

    const elapsed = Date.now() - startTime
    if (elapsed >= timeoutMs) {
      throw new PollerTimeoutError(elapsed)
    }

    const messages = await fetchMessages()
    const last: PollerMessage | undefined = messages[messages.length - 1]

    if (last !== undefined && last.role === "assistant" && last.finish_reason) {
      return maxBytes === undefined ? last.content : truncateBytes(last.content, maxBytes)
    }

    // SEC-010: bound the size of the LAST assistant message between polls.
    // NOTE: This is NOT a full mid-stream / transcript-wide cap — `fetchMessages`
    // still returns the entire `messages` array, which the SDK allocates in
    // full before we ever see it. The truncation here only prevents the
    // in-progress assistant turn (the one we will eventually surface as the
    // result) from growing unboundedly across successive polls; it does not
    // bound `totalBytes` across earlier transcript entries.
    if (
      maxBytes !== undefined &&
      last !== undefined &&
      last.role === "assistant" &&
      Buffer.byteLength(last.content, "utf8") > maxBytes
    ) {
      last.content = truncateBytes(last.content, maxBytes)
    }

    const remaining = timeoutMs - (Date.now() - startTime)
    if (remaining <= 0) {
      throw new PollerTimeoutError(Date.now() - startTime)
    }

    await sleepOrAbort(Math.min(pollIntervalMs, remaining), signal, startTime)
  }
}

/**
 * Sleep for `ms`, but reject early with `PollerAbortError` if `signal` aborts
 * during the wait. Using `addEventListener` (not a polling check) means we
 * react to aborts immediately rather than waiting out the full poll interval.
 */
function sleepOrAbort(ms: number, signal: AbortSignal | undefined, startTime: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new PollerAbortError(Date.now() - startTime))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(new PollerAbortError(Date.now() - startTime))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
