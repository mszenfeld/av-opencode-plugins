// src/index.ts
import { readFileSync } from "fs";
import path2 from "path";
import { fileURLToPath } from "url";
import { tool } from "@opencode-ai/plugin";

// src/truncate-bytes.ts
var TRUNCATION_MARKER = "\n[\u2026truncated\u2026]";
function truncateBytes(input, maxBytes) {
  const buf = Buffer.from(input, "utf8");
  if (buf.byteLength <= maxBytes) {
    return input;
  }
  const sliced = buf.subarray(0, maxBytes);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced);
  return decoded + TRUNCATION_MARKER;
}

// src/poller.ts
var PollerTimeoutError = class extends Error {
  kind = "timeout";
  elapsedMs;
  constructor(elapsedMs) {
    super(`pollUntilIdle: timeout after ${elapsedMs}ms`);
    this.name = "PollerTimeoutError";
    this.elapsedMs = elapsedMs;
  }
};
var PollerAbortError = class extends Error {
  kind = "abort";
  elapsedMs;
  constructor(elapsedMs) {
    super(`pollUntilIdle: aborted after ${elapsedMs}ms`);
    this.name = "PollerAbortError";
    this.elapsedMs = elapsedMs;
  }
};
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

// src/sanitize.ts
import path from "path";
function neutralizeUntrustedOutput(s) {
  if (s.length === 0) {
    return s;
  }
  let out = s.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "");
  out = out.replace(/\x9D[\s\S]*?(?:\x07|\x1b\\)/g, "");
  out = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  out = out.replace(/\x9B[0-9;?]*[a-zA-Z]/g, "");
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
  out = out.replace(/[‪-‮⁦-⁩]/g, "");
  out = out.replace(/[​-‍﻿]/g, "");
  out = out.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return out;
}
var PLAN_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
var PLAN_SUFFIX = /-test-plan$/;
var VALID_TOPIC = /^[a-z0-9-]+$/i;
function deriveReportPath(planPath, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`deriveReportPath: invalid date "${today}", expected YYYY-MM-DD`);
  }
  const base = path.posix.basename(planPath).replace(/\.md$/, "");
  const withoutDate = base.replace(PLAN_DATE_PREFIX, "");
  const topic = withoutDate.replace(PLAN_SUFFIX, "");
  if (topic.length === 0) {
    throw new Error(`deriveReportPath: empty topic derived from "${planPath}"`);
  }
  if (!VALID_TOPIC.test(topic)) {
    throw new Error(
      `deriveReportPath: invalid topic "${topic}" (allowed: a-z, 0-9, -)`
    );
  }
  return path.posix.join("docs/testing/reports", `${today}-${topic}-report.md`);
}

// src/dispatch.ts
var DEFAULT_POLL_INTERVAL_MS = 1e3;
var DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1e3;
var DEFAULT_RESULT_MAX_BYTES = 100 * 1024;
var DISPATCH_MAX_TASKS = 50;
var DISPATCH_CONCURRENCY = 4;
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
  let next = 0;
  async function worker() {
    while (true) {
      if (signal?.aborted === true) {
        while (next < tasks.length) {
          const i2 = next++;
          const task2 = tasks[i2];
          results[i2] = {
            name: task2.name,
            status: "aborted",
            result: "",
            duration_ms: 0,
            error: "aborted before start"
          };
        }
        return;
      }
      const i = next++;
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
  return results;
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
      // Bound in-flight memory in the poller too (SEC-010): the per-poll cap
      // matches the final cap so we never hold an oversized string before the
      // final truncation pass below.
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

// src/assign-issue-ids.ts
function assignIssueIds(input) {
  const { findings, prefix, startAt = 1 } = input;
  return findings.map((finding, index) => ({
    ...finding,
    id: `${prefix}-${String(startAt + index).padStart(3, "0")}`
  }));
}

// src/sdk-specialist.ts
function createSDKSpecialist(client, parentSessionID) {
  return {
    async startTask(agentName, prompt) {
      const created = await client.session.create({
        body: {
          parentID: parentSessionID,
          title: `[perun] dispatch to ${agentName}`
        }
      });
      const sessionId = created.data?.id ?? "";
      if (sessionId.length === 0) {
        throw new Error(`createSession returned no session id for agent ${agentName}`);
      }
      await client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: agentName,
          parts: [{ type: "text", text: prompt }]
        }
      });
      return sessionId;
    },
    async fetchMessages(sessionId) {
      const result = await client.session.messages({ path: { id: sessionId } });
      const list = result.data ?? [];
      return list.map(toPollerMessage);
    },
    async abortTask(sessionId) {
      await client.session.abort({ path: { id: sessionId } });
    }
  };
}
function isAssistant(message) {
  return message.role === "assistant";
}
function toPollerMessage(raw) {
  const role = raw.info.role;
  const text = raw.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
  const finishReason = isAssistant(raw.info) && typeof raw.info.finish === "string" ? raw.info.finish : null;
  return {
    role,
    content: text,
    finish_reason: finishReason
  };
}
var AGENT_REGISTRY_TTL_MS = 6e4;
var registryCache = /* @__PURE__ */ new WeakMap();
async function loadAgentRegistry(client) {
  const now = Date.now();
  const cached = registryCache.get(client);
  if (cached !== void 0 && cached.expiresAt > now) {
    return cached.promise;
  }
  const promise = fetchAgentRegistry(client);
  registryCache.set(client, { promise, expiresAt: now + AGENT_REGISTRY_TTL_MS });
  promise.catch(() => {
    if (registryCache.get(client)?.promise === promise) {
      registryCache.delete(client);
    }
  });
  return promise;
}
async function fetchAgentRegistry(client) {
  let list;
  try {
    const result = await client.app.agents();
    list = result.data ?? [];
  } catch (err) {
    throw new Error(
      `dispatch_parallel: failed to load agent registry from SDK: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const registry = {};
  for (const agent of list) {
    const name = agent.name;
    if (name.length > 0) {
      registry[name] = { mode: agent.mode };
    }
  }
  return registry;
}

// src/index.ts
var moduleDir = path2.dirname(fileURLToPath(import.meta.url));
function loadAgentPrompt(name) {
  const packaged = path2.resolve(moduleDir, "agents", `${name}.md`);
  const source = path2.resolve(moduleDir, "../src/agents", `${name}.md`);
  try {
    return readFileSync(packaged, "utf8");
  } catch {
    return readFileSync(source, "utf8");
  }
}
var cachedPerunPrompt;
function getPerunPrompt() {
  if (cachedPerunPrompt === void 0) {
    cachedPerunPrompt = loadAgentPrompt("perun");
  }
  return cachedPerunPrompt;
}
var AppVerkCoordinatorPlugin = async (input) => {
  const { client } = input;
  const dispatchParallelTool = tool({
    description: [
      "Dispatch tasks to specialist agents in parallel. Returns results in the same order as the input tasks. Use this instead of calling Task directly to guarantee parallelism and deterministic ordering.",
      "",
      "Guarantees and limits:",
      "- Maximum 50 tasks per call (over-limit calls are rejected before any session is created).",
      "- Internally throttled to a 4-worker pool: tasks beyond the first 4 wait until a slot frees up. Result order is preserved.",
      '- Each task has a 5-minute hard timeout; on expiry the task is returned with status "timeout" and the partial result is discarded.',
      '- Each successful result is truncated at 100KB (UTF-8 bytes). Truncated results end with the marker "[\u2026truncated\u2026]" \u2014 synthesize what is present, do not retry.',
      "- Anti-recursion pre-flight: every task is validated against the live agent registry BEFORE any session is created. Tasks targeting an unknown agent, a `mode: primary` agent, or a `mode: all` agent are rejected with a thrown error and no work is dispatched.",
      "- Specialist output is treated as untrusted data: ANSI/control characters are stripped and HTML-like substrings are escaped before the result is returned.",
      '- Honors `ToolContext.abort`: when the parent session aborts, in-flight tasks terminate within ~one poll-interval with status "aborted" and the child session is cancelled server-side (best-effort).',
      '- Result shape: each entry has `{ name, status: "success" | "error" | "timeout" | "aborted", result, duration_ms, error? }`, in the same order as the input `tasks` array.'
    ].join("\n"),
    args: {
      // `agent` + `summary` are both REQUIRED, primitive top-level args.
      // The OpenCode TUI's GenericTool renderer (the path used for every
      // plugin-supplied tool) shows `{tool} {input(input)}`, where the
      // `input()` helper formats only primitive top-level args. `tasks` is
      // an array, so without these two strings the call line collapses to a
      // bare `dispatch_parallel`. Splitting into `agent` and `summary` lets
      // reviewers see "who" and "what" as two distinct columns inline.
      agent: tool.schema.string().min(1).max(60).describe(
        'REQUIRED. Display label for the dispatched agent(s). Free-form, but follow this convention so reviewers can scan the TUI line:\n- single agent: bare name (e.g. "code-reviewer")\n- N copies of one agent: "name \xD7N" (e.g. "code-reviewer \xD73")\n- different agents: comma-joined names (e.g. "code-reviewer, security-auditor")\n- mixed + duplicates: combine the two (e.g. "code-reviewer \xD72, security-auditor")\nHard cap 60 chars. Do not include prompts, goals, or PII \u2014 `summary` is the place for that.\n\nException for logical agents with multiple variants: when a logical agent is implemented as multiple registered names (e.g. `qa-tester` \u2192 `qa-tester-fe` + `qa-tester-be`), use the logical name in `agent`, not the variant names. Document the mapping in the dispatching agent\'s prompt.'
      ),
      summary: tool.schema.string().min(1).max(80).describe(
        'REQUIRED. One-line description of what is being delegated (e.g. "run login plan", "security/perf/quality review of PR #123", "QA-003 missing CSRF token"). Rendered next to `agent` in the OpenCode TUI. Hard cap 80 chars; do not include prompts or PII.'
      ),
      tasks: tool.schema.array(
        tool.schema.object({
          name: tool.schema.string().describe("Specialist agent name"),
          prompt: tool.schema.string().describe("Prompt for the specialist"),
          context: tool.schema.string().optional().describe("Optional extra context appended to the prompt")
        })
      ).describe("Array of tasks to dispatch in parallel")
    },
    async execute(args, context) {
      context.metadata({
        title: `${args.agent} \u2014 ${args.summary}`,
        metadata: {
          tasks: args.tasks.map((t) => ({ name: t.name, prompt: t.prompt }))
        }
      });
      if (context.sessionID.length === 0) {
        throw new Error("dispatch_parallel: missing context.sessionID \u2014 cannot parent child sessions");
      }
      const specialist = createSDKSpecialist(client, context.sessionID);
      const agentRegistry = await loadAgentRegistry(client);
      const results = await dispatchParallel({
        tasks: args.tasks,
        agentRegistry,
        specialist,
        // Thread the harness abort signal end-to-end: poller checks it at each
        // iteration and during the inter-poll sleep, and child sessions are
        // cancelled server-side when it fires (COMPOSITE-3 / ARCH-001).
        signal: context.abort
      });
      return JSON.stringify(results, null, 2);
    }
  });
  const assignIssueIdsTool = tool({
    description: [
      "Assign deterministic zero-padded IDs to a list of findings (QA-001, QA-002, ...). Use this instead of mentally tracking issue counters.",
      "",
      "Guarantees:",
      "- IDs are zero-padded to a minimum of 3 digits (e.g. `<PREFIX>-001`, `<PREFIX>-042`, `<PREFIX>-123`). Counters above 999 widen automatically (`<PREFIX>-1000`).",
      "- IDs are assigned in the order findings appear in the input array \u2014 the caller is responsible for sorting (e.g. by severity) BEFORE calling this tool.",
      "- Output preserves every input field and adds an `id` property; findings are not deduplicated, reordered, or filtered.",
      "- `startAt` (default 1) lets you continue numbering across multiple reports without collisions."
    ].join("\n"),
    args: {
      findings: tool.schema.array(
        tool.schema.object({
          severity: tool.schema.string(),
          title: tool.schema.string()
        }).passthrough()
      ).describe("Findings to assign IDs to"),
      prefix: tool.schema.string().describe('ID prefix, e.g. "QA"'),
      startAt: tool.schema.number().optional().describe("Starting number (default 1)")
    },
    async execute(args) {
      const result = assignIssueIds({
        findings: args.findings,
        prefix: args.prefix,
        startAt: args.startAt
      });
      return JSON.stringify(result, null, 2);
    }
  });
  return {
    config: async (config) => {
      config.agent = config.agent ?? {};
      config.agent["Perun - Coordinator"] = {
        description: "Delegates work to specialists, synthesizes results, proposes next steps",
        mode: "primary",
        get prompt() {
          return getPerunPrompt();
        }
      };
    },
    // IMPORTANT: Tool names "dispatch_parallel" and "assign_issue_ids" must exactly match
    // the `allowed-tools` frontmatter in `src/agents/perun.md`. If you rename either tool,
    // update both places. There is no programmatic linking — keep them in sync manually.
    tool: {
      dispatch_parallel: dispatchParallelTool,
      assign_issue_ids: assignIssueIdsTool
    }
  };
};
export {
  AppVerkCoordinatorPlugin,
  createSDKSpecialist,
  deriveReportPath,
  loadAgentRegistry,
  neutralizeUntrustedOutput,
  toPollerMessage
};
