// src/index.ts
import { readFileSync } from "fs";
import path2 from "path";
import { fileURLToPath } from "url";
import { tool } from "@opencode-ai/plugin";

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
  let out = s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
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
var DEFAULT_POLL_INTERVAL_MS = 2e3;
var DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1e3;
var DEFAULT_RESULT_MAX_BYTES = 100 * 1024;
var MAX_PARALLEL_TASKS = 10;
var TRUNCATION_MARKER2 = "\n[\u2026truncated\u2026]";
function truncateBytes2(input, maxBytes) {
  const buf = Buffer.from(input, "utf8");
  if (buf.byteLength <= maxBytes) {
    return input;
  }
  const sliced = buf.subarray(0, maxBytes);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced);
  return decoded + TRUNCATION_MARKER2;
}
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
  if (tasks.length > MAX_PARALLEL_TASKS) {
    throw new Error(
      `dispatch_parallel: too many tasks (${tasks.length}); maximum is ${MAX_PARALLEL_TASKS}`
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
  return Promise.all(
    tasks.map(
      (task) => runTask(task, specialist, { pollIntervalMs, taskTimeoutMs, resultMaxBytes, signal })
    )
  );
}
async function runTask(task, specialist, options) {
  const startTime = Date.now();
  let sessionId;
  try {
    const fullPrompt = task.context ? `${task.prompt}

${task.context}` : task.prompt;
    sessionId = await specialist.startTask(task.name, fullPrompt);
    const rawResult = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(sessionId),
      timeoutMs: options.taskTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      signal: options.signal,
      // Bound in-flight memory in the poller too (SEC-010): the per-poll cap
      // matches the final cap so we never hold an oversized string before the
      // final truncation pass below.
      maxBytes: options.resultMaxBytes
    });
    let result = neutralizeUntrustedOutput(rawResult);
    result = truncateBytes2(result, options.resultMaxBytes);
    return {
      name: task.name,
      status: "success",
      result,
      duration_ms: Date.now() - startTime
    };
  } catch (err) {
    let status;
    if (err instanceof PollerAbortError) {
      status = "aborted";
      if (sessionId !== void 0) {
        try {
          await specialist.abortTask(sessionId);
        } catch {
        }
      }
    } else if (err instanceof PollerTimeoutError) {
      status = "timeout";
    } else {
      status = "error";
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
function toPollerMessage(raw) {
  const role = raw.info.role;
  const text = raw.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
  const finishReason = raw.info.role === "assistant" && typeof raw.info.finish === "string" ? raw.info.finish ?? null : null;
  return {
    role,
    content: text,
    finish_reason: finishReason
  };
}
async function loadAgentRegistry(client) {
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
      "- Maximum 10 tasks per call (over-limit calls are rejected before any session is created).",
      '- Each task has a 5-minute hard timeout; on expiry the task is returned with status "timeout" and the partial result is discarded.',
      '- Each successful result is truncated at 100KB (UTF-8 bytes). Truncated results end with the marker "[\u2026truncated\u2026]" \u2014 synthesize what is present, do not retry.',
      "- Anti-recursion pre-flight: every task is validated against the live agent registry BEFORE any session is created. Tasks targeting an unknown agent, a `mode: primary` agent, or a `mode: all` agent are rejected with a thrown error and no work is dispatched.",
      "- Specialist output is treated as untrusted data: ANSI/control characters are stripped and HTML-like substrings are escaped before the result is returned.",
      '- Honors `ToolContext.abort`: when the parent session aborts, in-flight tasks terminate within ~one poll-interval with status "aborted" and the child session is cancelled server-side (best-effort).',
      '- Result shape: each entry has `{ name, status: "success" | "error" | "timeout" | "aborted", result, duration_ms, error? }`, in the same order as the input `tasks` array.'
    ].join("\n"),
    args: {
      tasks: tool.schema.array(
        tool.schema.object({
          name: tool.schema.string().describe("Specialist agent name"),
          prompt: tool.schema.string().describe("Prompt for the specialist"),
          context: tool.schema.string().optional().describe("Optional extra context appended to the prompt")
        })
      ).describe("Array of tasks to dispatch in parallel")
    },
    async execute(args, context) {
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
