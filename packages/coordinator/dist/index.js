// src/index.ts
import { readFileSync } from "fs";
import path from "path";
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
async function pollUntilIdle(options) {
  const { fetchMessages, timeoutMs, pollIntervalMs } = options;
  const startTime = Date.now();
  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw new PollerTimeoutError(elapsed);
    }
    const messages = await fetchMessages();
    const last = messages[messages.length - 1];
    if (last !== void 0 && last.role === "assistant" && last.finish_reason) {
      return last.content;
    }
    const remaining = timeoutMs - (Date.now() - startTime);
    if (remaining <= 0) {
      throw new PollerTimeoutError(Date.now() - startTime);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
  }
}

// src/dispatch.ts
var DEFAULT_POLL_INTERVAL_MS = 2e3;
var DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1e3;
var DEFAULT_RESULT_MAX_BYTES = 100 * 1024;
var TRUNCATION_MARKER = "\n[\u2026truncated\u2026]";
async function dispatchParallel(input) {
  const {
    tasks,
    agentRegistry,
    specialist,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
    resultMaxBytes = DEFAULT_RESULT_MAX_BYTES
  } = input;
  for (const task of tasks) {
    const agentInfo = agentRegistry[task.name];
    if (agentInfo === void 0) {
      throw new Error(`Unknown agent: ${task.name}`);
    }
    if (agentInfo.mode === "primary") {
      throw new Error(`Cannot dispatch primary agent: ${task.name}`);
    }
  }
  return Promise.all(
    tasks.map((task) => runTask(task, specialist, { pollIntervalMs, taskTimeoutMs, resultMaxBytes }))
  );
}
async function runTask(task, specialist, options) {
  const startTime = Date.now();
  try {
    const fullPrompt = task.context ? `${task.prompt}

${task.context}` : task.prompt;
    const sessionId = await specialist.startTask(task.name, fullPrompt);
    let result = await pollUntilIdle({
      fetchMessages: () => specialist.fetchMessages(sessionId),
      timeoutMs: options.taskTimeoutMs,
      pollIntervalMs: options.pollIntervalMs
    });
    if (result.length > options.resultMaxBytes) {
      result = result.substring(0, options.resultMaxBytes) + TRUNCATION_MARKER;
    }
    return {
      name: task.name,
      status: "success",
      result,
      duration_ms: Date.now() - startTime
    };
  } catch (err) {
    const status = err instanceof PollerTimeoutError ? "timeout" : "error";
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

// src/index.ts
var moduleDir = path.dirname(fileURLToPath(import.meta.url));
function loadAgentPrompt(name) {
  const packaged = path.resolve(moduleDir, "agents", `${name}.md`);
  const source = path.resolve(moduleDir, "../src/agents", `${name}.md`);
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
    description: "Dispatch tasks to specialist agents in parallel. Returns results in the same order as the input tasks. Use this instead of calling Task directly to guarantee parallelism and deterministic ordering.",
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
      const specialist = createSDKSpecialist(client, context.sessionID);
      const agentRegistry = await loadAgentRegistry(client);
      const results = await dispatchParallel({
        tasks: args.tasks,
        agentRegistry,
        specialist
      });
      return JSON.stringify(results, null, 2);
    }
  });
  const assignIssueIdsTool = tool({
    description: "Assign deterministic zero-padded IDs to a list of findings (QA-001, QA-002, ...). Use this instead of mentally tracking issue counters.",
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
      config.agent["perun"] = {
        description: "Pantheon coordinator \u2014 delegates work to specialists, synthesizes results, proposes next steps",
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
    }
  };
}
function toPollerMessage(raw) {
  const role = raw.info.role;
  const text = raw.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
  const finishReason = raw.info.finishReason;
  return {
    role,
    content: text,
    finish_reason: finishReason
  };
}
async function loadAgentRegistry(client) {
  try {
    const result = await client.app.agents();
    const list = result.data ?? [];
    const registry = {};
    for (const agent of list) {
      const name = agent.name;
      const mode = agent.mode === "primary" ? "primary" : "subagent";
      if (name.length > 0) {
        registry[name] = { mode };
      }
    }
    return registry;
  } catch {
    return {};
  }
}
export {
  AppVerkCoordinatorPlugin
};
