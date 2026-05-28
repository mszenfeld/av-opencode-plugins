import { randomUUID } from "node:crypto";
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_RESULT_MAX_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
  validateDispatchable
} from "./dispatch.js";
import { PollerAbortError, PollerTimeoutError, pollUntilIdle } from "./poller.js";
import { neutralizeUntrustedOutput, normalizeVariantSuffix } from "./sanitize.js";
import { truncateBytes } from "./truncate-bytes.js";
const BACKGROUND_MAX_CONCURRENT = 4;
async function startBackgroundTask(input) {
  const { store, specialist, agentRegistry, parentSessionId, agent, prompt, context } = input;
  validateDispatchable(agentRegistry, agent);
  if (store.countRunningByParent(parentSessionId) >= BACKGROUND_MAX_CONCURRENT) {
    throw new Error(
      `dispatch_background: max ${BACKGROUND_MAX_CONCURRENT} background tasks running for this session \u2014 collect one (wait_background / poll_background) before firing more`
    );
  }
  const fullPrompt = context ? `${prompt}

${context}` : prompt;
  const childSessionId = await specialist.startBackground(agent, fullPrompt);
  const id = `bg_${randomUUID().slice(0, 8)}`;
  store.register({ id, childSessionId, parentSessionId, agent, startedAt: Date.now() });
  return { id, agent, status: "running" };
}
async function collectBackground(input) {
  return Promise.all(input.ids.map((id) => collectOne(id, input)));
}
async function collectOne(id, input) {
  const {
    store,
    specialist,
    block,
    timeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES,
    signal,
    scrubber,
    parentSessionId
  } = input;
  const task = store.get(id);
  if (task === void 0) {
    return { id, agent: "", status: "not_found" };
  }
  const agent = normalizeVariantSuffix(task.agent);
  const finalize = (text) => {
    const neutralized = neutralizeUntrustedOutput(text);
    const scrubbed = scrubber !== void 0 && parentSessionId !== void 0 ? scrubber(neutralized, parentSessionId) : neutralized;
    return truncateBytes(scrubbed, resultMaxBytes);
  };
  if (!block) {
    const messages = await specialist.fetchMessages(task.childSessionId);
    const last = messages[messages.length - 1];
    if (last !== void 0 && last.role === "assistant" && last.finish_reason) {
      return {
        id,
        agent,
        status: "success",
        result: finalize(last.content),
        duration_ms: Date.now() - task.startedAt
      };
    }
    return { id, agent, status: "running" };
  }
  try {
    const raw = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(task.childSessionId),
      timeoutMs,
      pollIntervalMs,
      signal,
      maxBytes: resultMaxBytes
    });
    store.remove(id);
    return { id, agent, status: "success", result: finalize(raw), duration_ms: Date.now() - task.startedAt };
  } catch (err) {
    store.remove(id);
    if (err instanceof PollerAbortError) {
      try {
        await specialist.abortTask(task.childSessionId);
      } catch {
      }
      return { id, agent, status: "aborted", result: "", duration_ms: Date.now() - task.startedAt, error: "aborted" };
    }
    if (err instanceof PollerTimeoutError) {
      return { id, agent, status: "timeout", result: "", duration_ms: Date.now() - task.startedAt, error: "timeout" };
    }
    return {
      id,
      agent,
      status: "error",
      result: "",
      duration_ms: Date.now() - task.startedAt,
      error: neutralizeUntrustedOutput(err instanceof Error ? err.message : String(err))
    };
  }
}
export {
  BACKGROUND_MAX_CONCURRENT,
  collectBackground,
  startBackgroundTask
};
