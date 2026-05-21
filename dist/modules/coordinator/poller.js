import { truncateBytes } from "./truncate-bytes.js";
class PollerTimeoutError extends Error {
  kind = "timeout";
  elapsedMs;
  constructor(elapsedMs) {
    super(`pollUntilIdle: timeout after ${elapsedMs}ms`);
    this.name = "PollerTimeoutError";
    this.elapsedMs = elapsedMs;
  }
}
class PollerAbortError extends Error {
  kind = "abort";
  elapsedMs;
  constructor(elapsedMs) {
    super(`pollUntilIdle: aborted after ${elapsedMs}ms`);
    this.name = "PollerAbortError";
    this.elapsedMs = elapsedMs;
  }
}
async function pollUntilIdle(options) {
  const { fetchMessages, timeoutMs, pollIntervalMs, signal, maxBytes } = options;
  const startTime = Date.now();
  while (true) {
    if (signal?.aborted === true) {
      throw new PollerAbortError(Date.now() - startTime);
    }
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw new PollerTimeoutError(elapsed);
    }
    const messages = await fetchMessages();
    const last = messages[messages.length - 1];
    if (last !== void 0 && last.role === "assistant" && last.finish_reason) {
      return maxBytes === void 0 ? last.content : truncateBytes(last.content, maxBytes);
    }
    if (maxBytes !== void 0 && last !== void 0 && last.role === "assistant" && Buffer.byteLength(last.content, "utf8") > maxBytes) {
      last.content = truncateBytes(last.content, maxBytes);
    }
    const remaining = timeoutMs - (Date.now() - startTime);
    if (remaining <= 0) {
      throw new PollerTimeoutError(Date.now() - startTime);
    }
    await sleepOrAbort(Math.min(pollIntervalMs, remaining), signal, startTime);
  }
}
function sleepOrAbort(ms, signal, startTime) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new PollerAbortError(Date.now() - startTime));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new PollerAbortError(Date.now() - startTime));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export {
  PollerAbortError,
  PollerTimeoutError,
  pollUntilIdle
};
