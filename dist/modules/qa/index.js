import { tool } from "@opencode-ai/plugin";
import { buildQATesterAgent } from "./prompt-builder.js";
import { loadPantheonConfig } from "../pantheon-config/index.js";
import { loadModuleAsset } from "../_shared/load-asset.js";
import { BindingsStore } from "./bindings-store.js";
import { QaRunState } from "./qa-run-state.js";
import { SessionAgentRegistry, makeShellEnvHook } from "./shell-env-hook.js";
import { makeExecuteRecipeHandler } from "./execute-recipe.js";
import { makeRecordInputHandler } from "./record-input.js";
import { FE_TOOLS, BE_TOOLS, SETUP_TOOLS, SHARED_TOOLS, toolsForVariant } from "./allowed-tools.js";
function loadCommandMarkdown(name) {
  return loadModuleAsset(import.meta.url, `../../commands/${name}`);
}
const VARIANTS = ["fe", "be", "setup"];
const TTL_MS = 60 * 60 * 1e3;
const SWEEP_INTERVAL_MS = 5 * 60 * 1e3;
const COMMANDS = [
  {
    name: "create-qa-plan",
    description: "Analyze code changes and generate a detailed QA test plan with FE and BE scenarios.",
    file: "create-qa-plan.md"
  },
  {
    name: "run-qa",
    description: "Execute a QA test plan \u2014 Perun dispatches one zmora variant per scenario through dispatch_parallel.",
    file: "run-qa.md"
  }
];
const AppVerkQAPlugin = async ({ client }) => {
  const store = new BindingsStore();
  const state = new QaRunState();
  const registry = new SessionAgentRegistry();
  const parentIDCache = /* @__PURE__ */ new Map();
  async function resolveParentID(sessionID) {
    const cached = parentIDCache.get(sessionID);
    if (cached !== void 0) return cached;
    try {
      const result = await client.session.get({ path: { id: sessionID } });
      const parentID = result.data?.parentID;
      if (typeof parentID === "string" && parentID.length > 0) {
        parentIDCache.set(sessionID, parentID);
        return parentID;
      }
      return void 0;
    } catch {
      return void 0;
    }
  }
  const recordInputHandler = makeRecordInputHandler({ store, resolveParentID });
  const executeRecipeHandler = makeExecuteRecipeHandler({
    store,
    state,
    resolveParentID,
    runBash: async (cmd, env) => {
      const { spawn } = await import("node:child_process");
      return await new Promise((resolve) => {
        const child = spawn("bash", ["-c", cmd], {
          env: { ...process.env, ...env },
          stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          stdout += d.toString();
        });
        child.stderr.on("data", (d) => {
          stderr += d.toString();
        });
        child.on("close", (code) => {
          resolve({ exitCode: code ?? -1, stdout, stderr });
        });
        child.on("error", (err) => {
          resolve({ exitCode: -1, stdout, stderr: stderr + err.message });
        });
      });
    },
    processEnv: process.env,
    nowMs: () => Date.now()
  });
  const shellEnvHook = makeShellEnvHook({ store, registry, resolveParentID });
  const sweepTimer = setInterval(() => {
    try {
      store.sweepExpired(Date.now(), TTL_MS);
    } catch {
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  return {
    config: async (config) => {
      config.agent ??= {};
      for (const stack of VARIANTS) {
        let cached;
        config.agent[`zmora-${stack}`] = {
          description: `Zmora \u2014 ${stack.toUpperCase()} QA scenarios (internal variant of zmora)`,
          get prompt() {
            cached ??= buildQATesterAgent(stack).prompt;
            return cached;
          },
          mode: "subagent",
          // Plugin-provided tools are opt-in per agent. Only zmora-setup may
          // execute recipes; record_input is Perun-only (registered in the
          // coordinator agent's frontmatter, not in any zmora variant).
          tools: {
            execute_recipe: stack === "setup",
            record_input: false
          }
        };
      }
      const zmoraModel = loadPantheonConfig().agents.zmora?.model;
      if (zmoraModel !== void 0) {
        for (const stack of VARIANTS) {
          config.agent[`zmora-${stack}`].model = zmoraModel;
        }
      }
      config.command ??= {};
      for (const c of COMMANDS) {
        let cached;
        config.command[c.name] = {
          description: c.description,
          get template() {
            cached ??= loadCommandMarkdown(c.file);
            return cached;
          }
        };
      }
    },
    tool: {
      execute_recipe: tool({
        description: [
          "Execute a single binding recipe declared in the plan's **Bindings:** section. Atomically: validates recipe AST, runs via bash with composed env (host env + previously-bound inputs), validates output, registers the value in the bindings store. Returns status only \u2014 the value never appears in the LLM context.",
          "",
          "Available only to zmora-setup. Other zmora variants see the tool disabled in their AgentConfig.",
          "",
          "Result shape (JSON-stringified):",
          '- `{ status: "ok" }` \u2014 binding minted and stored.',
          '- `{ status: "need_info", missing: string[] }` \u2014 recipe inputs are not yet bound; Perun must collect them first.',
          '- `{ status: "recipe_failed", reason, stderr_tail }` \u2014 bash exit non-zero, timeout, or output validation failed. `stderr_tail` is scrubbed of secrets and truncated to 200 chars.',
          '- `{ status: "unknown_binding" }` \u2014 `binding_name` is not in the parent run\'s plan.'
        ].join("\n"),
        args: {
          binding_name: tool.schema.string().describe(
            `Name of the binding to provision, e.g. "QA_BIND_TOKEN". Must start with QA_BIND_ and match the plan's **Bindings:** declaration.`
          )
        },
        async execute(args, ctx) {
          const result = await executeRecipeHandler(
            { binding_name: args.binding_name },
            { sessionID: ctx.sessionID }
          );
          return JSON.stringify(result);
        }
      }),
      record_input: tool({
        description: [
          "Record a user-pasted NAME=value input into the bindings store for use by subsequent execute_recipe calls (as recipe inputs) and Zmora shell invocations (via the shell.env hook). Validates the name (denylist + identifier regex) and value charset.",
          "",
          "Available only to Perun, invoked when parsing user replies during mid-run dialog. The value is stored as type=secret, source=user-paste \u2014 it is scrubbed from any specialist stderr that propagates back through the plugin.",
          "",
          "Result shape (JSON-stringified):",
          '- `{ status: "ok" }` \u2014 recorded (also returned for duplicates, idempotent).',
          '- `{ status: "rejected", reason }` \u2014 name failed denylist/regex check, or value failed charset/length validation.'
        ].join("\n"),
        args: {
          name: tool.schema.string().describe(
            'Env var name (regular identifier, not necessarily QA_BIND_*), e.g. "TEST_USER_EMAIL". Must match /^[A-Z_][A-Z0-9_]*$/ and not be in the process-control denylist (PATH, NODE_OPTIONS, ...).'
          ),
          value: tool.schema.string().describe(
            "Value pasted by the user. Stored as type=secret, source=user-paste. Max 4096 chars; restricted charset (no control bytes)."
          )
        },
        async execute(args, ctx) {
          const result = await recordInputHandler(
            { name: args.name, value: args.value },
            { sessionID: ctx.sessionID }
          );
          return JSON.stringify(result);
        }
      })
    },
    "shell.env": shellEnvHook,
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return;
      const deletedID = event.properties?.info?.id;
      if (typeof deletedID !== "string" || deletedID.length === 0) return;
      store.clearParent(deletedID);
      state.clearRun(deletedID);
      registry.unregister(deletedID);
      parentIDCache.delete(deletedID);
      for (const [childID, parentID] of parentIDCache.entries()) {
        if (parentID === deletedID) parentIDCache.delete(childID);
      }
    }
  };
};
var qa_default = AppVerkQAPlugin;
export {
  AppVerkQAPlugin,
  BE_TOOLS,
  FE_TOOLS,
  SETUP_TOOLS,
  SHARED_TOOLS,
  buildQATesterAgent,
  qa_default as default,
  toolsForVariant
};
