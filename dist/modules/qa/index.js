import { tool } from "@opencode-ai/plugin";
import { buildQATesterAgent } from "./prompt-builder.js";
import { loadPantheonConfig } from "../pantheon-config/index.js";
import { loadModuleAsset } from "../_shared/load-asset.js";
import { registerDispatchExtensions } from "../_shared/dispatch-extensions.js";
import { BindingsStore } from "./bindings-store.js";
import { QaRunState } from "./qa-run-state.js";
import { SessionAgentRegistry, makeShellEnvHook } from "./shell-env-hook.js";
import { makeExecuteRecipeHandler } from "./execute-recipe.js";
import { makeRecordInputHandler } from "./record-input.js";
import { parseBindings } from "./binding-parser.js";
import { scrubSecrets } from "./scrubber.js";
import { makeRunBash } from "./run-bash.js";
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
  const recordInputHandler = makeRecordInputHandler({ store, state, resolveParentID });
  const executeRecipeHandler = makeExecuteRecipeHandler({
    store,
    state,
    resolveParentID,
    // `makeRunBash` owns wall-clock timeout enforcement: AbortController +
    // `spawn`'s `signal` so an over-budget recipe is actually killed
    // (PERF-001 / CWE-404). Default timeout (30s) lives in run-bash.ts.
    runBash: makeRunBash(),
    processEnv: process.env,
    nowMs: () => Date.now()
  });
  const shellEnvHook = makeShellEnvHook({ store, registry, resolveParentID });
  registerDispatchExtensions({
    sessionAgentRegistry: registry,
    scrubberFactory: (parentSessionID) => {
      try {
        const snapshot = store.pinSnapshot(parentSessionID);
        return {
          scrub: (text) => scrubSecrets(text, parentSessionID, store, snapshot),
          release: () => store.releaseSnapshot(snapshot.id)
        };
      } catch {
        return void 0;
      }
    }
  });
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
          // execute recipes; record_input and parse_plan are Perun-only
          // (registered in Perun's frontmatter, not in any zmora variant).
          tools: {
            execute_recipe: stack === "setup",
            record_input: false,
            parse_plan: false
          }
        };
      }
      const zmoraModel = loadPantheonConfig().agents.zmora?.model;
      if (zmoraModel !== void 0) {
        for (const stack of VARIANTS) {
          const agent = config.agent[`zmora-${stack}`];
          if (agent === void 0) continue;
          agent.model = zmoraModel;
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
      parse_plan: tool({
        description: [
          "Parse a QA plan's `## Setup` \u2192 `**Bindings:**` subsection into the plugin's per-run state. Perun MUST call this exactly once per QA run, after reading the plan and BEFORE the first `dispatch_parallel` that includes a zmora-setup task. Without this call `execute_recipe` returns `{status:\"unknown_binding\"}` for every recipe.",
          "",
          "The plan text is parsed in-process \u2014 the binding values themselves are NEVER produced here, only the recipe AST. Value materialisation happens later in `execute_recipe`.",
          "",
          "Result shape (JSON-stringified):",
          '- `{ status: "ok", bindings: string[] }` \u2014 bindings stored; `bindings` lists the names parsed (e.g. `["QA_BIND_TOKEN"]`). Empty array means the plan has no `## Setup` / `**Bindings:**` subsection \u2014 Perun should proceed to dispatch without any zmora-setup tasks.',
          '- `{ status: "error", reason }` \u2014 parse/validation failed (invalid binding name, recipe AST rejection, etc.). Surface `reason` to the user verbatim and abort the QA run.',
          "",
          "Idempotent: calling twice with the same plan replaces the stored plan (later wins). Safe to call again on resume."
        ].join("\n"),
        args: {
          plan: tool.schema.string().describe(
            "Full text of the QA plan markdown. Perun passes the contents read via `Read` \u2014 do not summarise or trim."
          )
        },
        async execute(args, ctx) {
          const parentID = await resolveParentID(ctx.sessionID) ?? ctx.sessionID;
          const parsed = parseBindings(args.plan);
          if (parsed.status !== "ok") {
            return JSON.stringify({ status: "error", reason: parsed.reason });
          }
          state.storePlan(parentID, parsed.bindings);
          return JSON.stringify({
            status: "ok",
            bindings: parsed.bindings.map((b) => b.name)
          });
        }
      }),
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
      registry.unregister(deletedID);
      store.clearParent(deletedID);
      state.clearRun(deletedID);
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
