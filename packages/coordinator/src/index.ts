import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { tool, type Plugin } from "@opencode-ai/plugin"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import { dispatchParallel, type DispatchSpecialist, type AgentInfo } from "./dispatch.js"
import { assignIssueIds } from "./assign-issue-ids.js"
import type { PollerMessage } from "./poller.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function loadAgentPrompt(name: string): string {
  const packaged = path.resolve(moduleDir, "agents", `${name}.md`)
  const source = path.resolve(moduleDir, "../src/agents", `${name}.md`)
  try {
    return readFileSync(packaged, "utf8")
  } catch {
    return readFileSync(source, "utf8")
  }
}

let cachedPerunPrompt: string | undefined
function getPerunPrompt(): string {
  if (cachedPerunPrompt === undefined) {
    cachedPerunPrompt = loadAgentPrompt("perun")
  }
  return cachedPerunPrompt
}

export const AppVerkCoordinatorPlugin: Plugin = async (input) => {
  const { client } = input

  const dispatchParallelTool = tool({
    description:
      "Dispatch tasks to specialist agents in parallel. Returns results in the same order as the input tasks. Use this instead of calling Task directly to guarantee parallelism and deterministic ordering.",
    args: {
      tasks: tool.schema
        .array(
          tool.schema.object({
            name: tool.schema.string().describe("Specialist agent name"),
            prompt: tool.schema.string().describe("Prompt for the specialist"),
            context: tool.schema
              .string()
              .optional()
              .describe("Optional extra context appended to the prompt"),
          }),
        )
        .describe("Array of tasks to dispatch in parallel"),
    },
    async execute(args, context) {
      const specialist = createSDKSpecialist(client, context.sessionID)
      const agentRegistry = await loadAgentRegistry(client)
      const results = await dispatchParallel({
        tasks: args.tasks,
        agentRegistry,
        specialist,
      })
      return JSON.stringify(results, null, 2)
    },
  })

  const assignIssueIdsTool = tool({
    description:
      "Assign deterministic zero-padded IDs to a list of findings (QA-001, QA-002, ...). Use this instead of mentally tracking issue counters.",
    args: {
      findings: tool.schema
        .array(
          tool.schema
            .object({
              severity: tool.schema.string(),
              title: tool.schema.string(),
            })
            .passthrough(),
        )
        .describe("Findings to assign IDs to"),
      prefix: tool.schema.string().describe('ID prefix, e.g. "QA"'),
      startAt: tool.schema.number().optional().describe("Starting number (default 1)"),
    },
    async execute(args) {
      const result = assignIssueIds({
        findings: args.findings,
        prefix: args.prefix,
        startAt: args.startAt,
      })
      return JSON.stringify(result, null, 2)
    },
  })

  return {
    config: async (config) => {
      config.agent = config.agent ?? {}
      config.agent["perun"] = {
        description:
          "Pantheon coordinator — delegates work to specialists, synthesizes results, proposes next steps",
        mode: "primary",
        get prompt() {
          return getPerunPrompt()
        },
      }
    },
    tool: {
      dispatch_parallel: dispatchParallelTool,
      assign_issue_ids: assignIssueIdsTool,
    },
  }
}

type SDKClient = ReturnType<typeof createOpencodeClient>

function createSDKSpecialist(client: SDKClient, parentSessionID: string): DispatchSpecialist {
  return {
    async startTask(agentName: string, prompt: string): Promise<string> {
      const created = await client.session.create({
        body: {
          parentID: parentSessionID,
          title: `[perun] dispatch to ${agentName}`,
        },
      })
      const sessionId: string = created.data?.id ?? ""
      if (sessionId.length === 0) {
        throw new Error(`createSession returned no session id for agent ${agentName}`)
      }

      await client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: agentName,
          parts: [{ type: "text", text: prompt }],
        },
      })

      return sessionId
    },
    async fetchMessages(sessionId: string): Promise<PollerMessage[]> {
      const result = await client.session.messages({ path: { id: sessionId } })
      const list = result.data ?? []
      return list.map(toPollerMessage)
    },
  }
}

function toPollerMessage(raw: {
  info: { role: string; finishReason?: string | null }
  parts: Array<{ type: string; text?: string }>
}): PollerMessage {
  const role: string = raw.info.role
  const text = raw.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")
  const finishReason: string | null | undefined = raw.info.finishReason
  return {
    role,
    content: text,
    finish_reason: finishReason,
  }
}

async function loadAgentRegistry(client: SDKClient): Promise<Record<string, AgentInfo>> {
  try {
    const result = await client.app.agents()
    const list = result.data ?? []
    const registry: Record<string, AgentInfo> = {}
    for (const agent of list) {
      const name = agent.name
      const mode = agent.mode === "primary" ? "primary" : "subagent"
      if (name.length > 0) {
        registry[name] = { mode }
      }
    }
    return registry
  } catch {
    return {}
  }
}
