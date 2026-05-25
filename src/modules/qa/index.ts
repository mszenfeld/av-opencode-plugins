import { tool, type Plugin } from "@opencode-ai/plugin"
import { buildQATesterAgent } from "./prompt-builder.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import { loadModuleAsset } from "../_shared/load-asset.js"
import { BindingsStore } from "./bindings-store.js"
import { QaRunState } from "./qa-run-state.js"
import { SessionAgentRegistry, makeShellEnvHook } from "./shell-env-hook.js"
import { makeExecuteRecipeHandler } from "./execute-recipe.js"
import { makeRecordInputHandler } from "./record-input.js"

export { buildQATesterAgent }
export { FE_TOOLS, BE_TOOLS, SETUP_TOOLS, SHARED_TOOLS, toolsForVariant } from "./allowed-tools.js"

function loadCommandMarkdown(name: string): string {
  return loadModuleAsset(import.meta.url, `../../commands/${name}`)
}

const VARIANTS = ["fe", "be", "setup"] as const

const COMMANDS = [
  {
    name: "create-qa-plan",
    description:
      "Analyze code changes and generate a detailed QA test plan with FE and BE scenarios.",
    file: "create-qa-plan.md",
  },
  {
    name: "run-qa",
    description:
      "Execute a QA test plan — Perun dispatches one zmora variant per scenario through dispatch_parallel.",
    file: "run-qa.md",
  },
]

export const AppVerkQAPlugin: Plugin = async ({ client }) => {
  // Plugin-process singletons. Live for the OpenCode server lifetime — bindings,
  // recipe attempt counters, and child→agent associations are all keyed by
  // parent session ID, so cross-run isolation is preserved by the keying scheme.
  const store = new BindingsStore()
  const state = new QaRunState()
  const registry = new SessionAgentRegistry()

  // Cache child→parent lookups positively: once resolved, the mapping never
  // changes for the life of a session (sessions don't re-parent). Skipping the
  // SDK round-trip is a pure perf win for the hot `shell.env` path.
  const parentIDCache = new Map<string, string>()
  async function resolveParentID(sessionID: string): Promise<string | undefined> {
    const cached = parentIDCache.get(sessionID)
    if (cached !== undefined) return cached
    try {
      const result = await client.session.get({ path: { id: sessionID } })
      const parentID = result.data?.parentID
      if (typeof parentID === "string" && parentID.length > 0) {
        parentIDCache.set(sessionID, parentID)
        return parentID
      }
      return undefined
    } catch {
      return undefined
    }
  }

  const recordInputHandler = makeRecordInputHandler({ store, resolveParentID })
  const executeRecipeHandler = makeExecuteRecipeHandler({
    store,
    state,
    resolveParentID,
    runBash: async (cmd, env) => {
      // Bash execution via Node child_process. Inherit process env merged with
      // composed env (composed wins for overlap so binding/input values mask
      // any host-env collision). Timeout enforcement lives in the handler
      // (Promise.race), so this just runs and returns.
      const { spawn } = await import("node:child_process")
      return await new Promise((resolve) => {
        const child = spawn("bash", ["-c", cmd], {
          env: { ...process.env, ...env },
          stdio: ["ignore", "pipe", "pipe"],
        })
        let stdout = ""
        let stderr = ""
        child.stdout.on("data", (d: Buffer) => {
          stdout += d.toString()
        })
        child.stderr.on("data", (d: Buffer) => {
          stderr += d.toString()
        })
        child.on("close", (code) => {
          resolve({ exitCode: code ?? -1, stdout, stderr })
        })
        child.on("error", (err) => {
          resolve({ exitCode: -1, stdout, stderr: stderr + err.message })
        })
      })
    },
    processEnv: process.env,
    nowMs: () => Date.now(),
  })

  const shellEnvHook = makeShellEnvHook({ store, registry, resolveParentID })

  return {
    config: async (config) => {
      config.agent ??= {}
      for (const stack of VARIANTS) {
        // Per-variant lazy cache: build the markdown once per variant at first access.
        let cached: string | undefined
        config.agent[`zmora-${stack}`] = {
          description: `Zmora — ${stack.toUpperCase()} QA scenarios (internal variant of zmora)`,
          get prompt() {
            cached ??= buildQATesterAgent(stack).prompt
            return cached
          },
          mode: "subagent",
          // Plugin-provided tools are opt-in per agent. Only zmora-setup may
          // execute recipes; record_input is Perun-only (registered in the
          // coordinator agent's frontmatter, not in any zmora variant).
          tools: {
            execute_recipe: stack === "setup",
            record_input: false,
          },
        }
      }

      // Inject model AFTER registration so we don't merge it into every literal
      // above — the non-null assertion is safe because the loop above just set
      // each `zmora-${stack}` key. The model string is also restricted to a
      // printable-ASCII allow-list by `MODEL_REGEX` in pantheon-config/schema.ts,
      // so no control characters can reach this TUI sink (CWE-117).
      const zmoraModel = loadPantheonConfig().agents.zmora?.model
      if (zmoraModel !== undefined) {
        for (const stack of VARIANTS) {
          config.agent[`zmora-${stack}`]!.model = zmoraModel
        }
      }

      config.command ??= {}
      for (const c of COMMANDS) {
        let cached: string | undefined
        config.command[c.name] = {
          description: c.description,
          get template() {
            cached ??= loadCommandMarkdown(c.file)
            return cached
          },
        }
      }
    },
    tool: {
      execute_recipe: tool({
        description: [
          "Execute a single binding recipe declared in the plan's **Bindings:** section. Atomically: validates recipe AST, runs via bash with composed env (host env + previously-bound inputs), validates output, registers the value in the bindings store. Returns status only — the value never appears in the LLM context.",
          "",
          "Available only to zmora-setup. Other zmora variants see the tool disabled in their AgentConfig.",
          "",
          "Result shape (JSON-stringified):",
          "- `{ status: \"ok\" }` — binding minted and stored.",
          "- `{ status: \"need_info\", missing: string[] }` — recipe inputs are not yet bound; Perun must collect them first.",
          "- `{ status: \"recipe_failed\", reason, stderr_tail }` — bash exit non-zero, timeout, or output validation failed. `stderr_tail` is scrubbed of secrets and truncated to 200 chars.",
          "- `{ status: \"unknown_binding\" }` — `binding_name` is not in the parent run's plan.",
        ].join("\n"),
        args: {
          binding_name: tool.schema
            .string()
            .describe(
              "Name of the binding to provision, e.g. \"QA_BIND_TOKEN\". Must start with QA_BIND_ and match the plan's **Bindings:** declaration.",
            ),
        },
        async execute(args, ctx) {
          const result = await executeRecipeHandler(
            { binding_name: args.binding_name },
            { sessionID: ctx.sessionID },
          )
          return JSON.stringify(result)
        },
      }),
      record_input: tool({
        description: [
          "Record a user-pasted NAME=value input into the bindings store for use by subsequent execute_recipe calls (as recipe inputs) and Zmora shell invocations (via the shell.env hook). Validates the name (denylist + identifier regex) and value charset.",
          "",
          "Available only to Perun, invoked when parsing user replies during mid-run dialog. The value is stored as type=secret, source=user-paste — it is scrubbed from any specialist stderr that propagates back through the plugin.",
          "",
          "Result shape (JSON-stringified):",
          "- `{ status: \"ok\" }` — recorded (also returned for duplicates, idempotent).",
          "- `{ status: \"rejected\", reason }` — name failed denylist/regex check, or value failed charset/length validation.",
        ].join("\n"),
        args: {
          name: tool.schema
            .string()
            .describe(
              "Env var name (regular identifier, not necessarily QA_BIND_*), e.g. \"TEST_USER_EMAIL\". Must match /^[A-Z_][A-Z0-9_]*$/ and not be in the process-control denylist (PATH, NODE_OPTIONS, ...).",
            ),
          value: tool.schema
            .string()
            .describe(
              "Value pasted by the user. Stored as type=secret, source=user-paste. Max 4096 chars; restricted charset (no control bytes).",
            ),
        },
        async execute(args, ctx) {
          const result = await recordInputHandler(
            { name: args.name, value: args.value },
            { sessionID: ctx.sessionID },
          )
          return JSON.stringify(result)
        },
      }),
    },
    "shell.env": shellEnvHook,
  }
}

export default AppVerkQAPlugin
