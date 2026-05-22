import {
  pollUntilIdle,
  PollerAbortError,
  PollerTimeoutError
} from "./poller.js";
import { neutralizeUntrustedOutput, normalizeVariantSuffix } from "./sanitize.js";
import { truncateBytes } from "./truncate-bytes.js";
const DEFAULT_POLL_INTERVAL_MS = 1e3;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1e3;
const DEFAULT_RESULT_MAX_BYTES = 100 * 1024;
const DISPATCH_MAX_TASKS = 50;
const DISPATCH_CONCURRENCY = 4;
async function dispatchParallel(input) {
  const {
    tasks,
    agentRegistry,
    specialist,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES,
    signal
  } = input;
  if (tasks.length > DISPATCH_MAX_TASKS) {
    throw new Error(
      `dispatch_parallel: tasks.length (${tasks.length}) exceeds DISPATCH_MAX_TASKS (${DISPATCH_MAX_TASKS})`
    );
  }
  for (const task of tasks) {
    const agentInfo = agentRegistry[task.name];
    if (agentInfo === void 0) {
      throw new Error(`Unknown agent: ${task.name}`);
    }
    if (agentInfo.mode !== "subagent") {
      throw new Error(`Cannot dispatch ${agentInfo.mode} agent: ${task.name}`);
    }
  }
  const results = new Array(tasks.length);
  const nextRef = { value: 0 };
  async function worker() {
    while (true) {
      if (signal?.aborted === true) {
        fillUnstartedAsAborted(results, tasks, nextRef);
        return;
      }
      const i = nextRef.value++;
      if (i >= tasks.length) return;
      const task = tasks[i];
      results[i] = await runTask(task, specialist, {
        pollIntervalMs,
        taskTimeoutMs,
        resultMaxBytes,
        signal
      });
    }
  }
  const workerCount = Math.min(DISPATCH_CONCURRENCY, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  for (const r of results) {
    r.name = normalizeVariantSuffix(r.name);
    if (r.error !== void 0) {
      r.error = normalizeVariantSuffix(r.error);
    }
  }
  return results;
}
function fillUnstartedAsAborted(results, tasks, nextRef) {
  while (nextRef.value < tasks.length) {
    const i = nextRef.value++;
    const task = tasks[i];
    results[i] = {
      name: task.name,
      status: "aborted",
      result: "",
      duration_ms: 0,
      error: "aborted before start"
    };
  }
}
function classifyError(err) {
  if (err instanceof PollerAbortError) {
    return "aborted";
  }
  if (err instanceof PollerTimeoutError) {
    return "timeout";
  }
  return "error";
}
async function cleanupOnAbort(specialist, sessionId) {
  if (sessionId === void 0) {
    return;
  }
  try {
    await specialist.abortTask(sessionId);
  } catch {
  }
}
async function runTask(task, specialist, options) {
  const startTime = Date.now();
  let sessionId;
  try {
    const fullPrompt = task.context ? `${task.prompt}

${task.context}` : task.prompt;
    const id = await specialist.startTask(task.name, fullPrompt);
    sessionId = id;
    const rawResult = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(id),
      timeoutMs: options.taskTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      // Bound in-flight memory in the poller too: the per-poll cap matches
      // the final cap so we never hold an oversized string before the final
      // truncation pass below.
      maxBytes: options.resultMaxBytes
    });
    const result = truncateBytes(neutralizeUntrustedOutput(rawResult), options.resultMaxBytes);
    return {
      name: task.name,
      status: "success",
      result,
      duration_ms: Date.now() - startTime
    };
  } catch (err) {
    const status = classifyError(err);
    if (status === "aborted") {
      await cleanupOnAbort(specialist, sessionId);
    }
    return {
      name: task.name,
      status,
      result: "",
      duration_ms: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
export {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  DISPATCH_CONCURRENCY,
  DISPATCH_MAX_TASKS,
  dispatchParallel
};
