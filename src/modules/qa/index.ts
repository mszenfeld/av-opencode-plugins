import { tool, type Plugin } from "@opencode-ai/plugin"
import { buildQATesterAgent } from "./prompt-builder.js"
import { loadPantheonConfig } from "../pantheon-config/index.js"
import { loadModuleAsset } from "../_shared/load-asset.js"
import { registerDispatchExtensions } from "../_shared/dispatch-extensions.js"
import { BindingsStore } from "./bindings-store.js"
import { QaRunState } from "./qa-run-state.js"
import { SessionAgentRegistry, makeShellEnvHook } from "./shell-env-hook.js"
import { makeExecuteRecipeHandler } from "./execute-recipe.js"
import { makeRecordInputHandler } from "./record-input.js"
import { parseBindings } from "./binding-parser.js"
import { scrubSecrets } from "./scrubber.js"
import { makeRunBash } from "./run-bash.js"

export { buildQATesterAgent }
export { FE_TOOLS, BE_TOOLS, SETUP_TOOLS, SHARED_TOOLS, toolsForVariant } from "./allowed-tools.js"

function loadCommandMarkdown(name: string): string {
  return loadModuleAsset(import.meta.url, `../../commands/${name}`)
}

const VARIANTS = ["fe", "be", "setup"] as const

const TTL_MS = 60 * 60 * 1000  // 1 hour
const SWEEP_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes

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

  const recordInputHandler = makeRecordInputHandler({ store, state, resolveParentID })
  const executeRecipeHandler = makeExecuteRecipeHandler({
    store,
    state,
    resolveParentID,
    // `makeRunBash` owns wall-clock timeout enforcement: AbortController +
    // `spawn`'s `signal` so an over-budget recipe is actually killed
    // (PERF-001 / CWE-404). Default timeout (30s) lives in run-bash.ts.
    runBash: makeRunBash(),
    processEnv: process.env,
    nowMs: () => Date.now(),
  })

  const shellEnvHook = makeShellEnvHook({ store, registry, resolveParentID })

  // Bridge plugin-owned state into the coordinator's `dispatch_parallel` via
  // the shared dispatch-extensions module. The coordinator reads this at
  // execute time — see `src/modules/_shared/dispatch-extensions.ts` for the
  // contract and rationale (ARCH-002: avoids coordinator → qa layer inversion).
  //
  //   - `sessionAgentRegistry`: dispatch records (childSessionID → task.name)
  //     so the `shell.env` hook can resolve agent identity per session.
  //   - `scrubberFactory`: pins a `BindingSnapshot` for the duration of a
  //     `dispatch_parallel` wave and routes every task result through a
  //     scrubber closed over that snapshot. This protects the scrub from
  //     interleaving with `execute_recipe` writes / `clearParent` purges that
  //     would otherwise reveal a newly-minted secret in the moment between
  //     write and the next scrub (ARCH-004 / CWE-362). `releaseSnapshot` is
  //     invoked by the coordinator in a `finally` after the wave completes,
  //     letting `sweepExpired` and `clearParent` reclaim the entries.
  //
  // No `preflight` is registered here — plan parsing happens explicitly via
  // the `parse_plan` tool (Perun-only) which Perun is required to call after
  // reading the plan and before the first `dispatch_parallel`. Keeping it
  // explicit (a) makes the lifecycle visible in the agent prompt and (b)
  // avoids needing the plan text at dispatch time.
  registerDispatchExtensions({
    sessionAgentRegistry: registry,
    scrubberFactory: (parentSessionID) => {
      // Defensive try/catch: a snapshot-pin failure must not break the
      // dispatch wave. Returning `undefined` falls back to no scrubbing —
      // which is the existing legacy behaviour for callers without a
      // configured scrubber. The dispatched task results still pass through
      // `neutralizeUntrustedOutput` and truncation in the coordinator.
      try {
        const snapshot = store.pinSnapshot(parentSessionID)
        return {
          scrub: (text) => scrubSecrets(text, parentSessionID, store, snapshot),
          release: () => store.releaseSnapshot(snapshot.id),
        }
      } catch {
        return undefined
      }
    },
  })

  // Periodic TTL sweep: purges binding entries older than TTL_MS. Skips pinned
  // entries (active snapshots). Wrapped in try/catch — a background timer must
  // never throw an unhandled rejection into the OpenCode process. `unref` lets
  // Node exit if this is the only remaining handle.
  const sweepTimer = setInterval(() => {
    try {
      store.sweepExpired(Date.now(), TTL_MS)
    } catch {
      // Never throw from a background timer.
    }
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()

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
          // execute recipes; record_input and parse_plan are Perun-only
          // (registered in Perun's frontmatter, not in any zmora variant).
          tools: {
            execute_recipe: stack === "setup",
            record_input: false,
            parse_plan: false,
          },
        }
      }

      // Inject model AFTER registration so we don't merge it into every literal
      // above. The model string is restricted to a printable-ASCII allow-list
      // by `MODEL_REGEX` in pantheon-config/schema.ts, so no control characters
      // can reach this TUI sink (CWE-117).
      const zmoraModel = loadPantheonConfig().agents.zmora?.model
      if (zmoraModel !== undefined) {
        for (const stack of VARIANTS) {
          const agent = config.agent[`zmora-${stack}`]
          if (agent === undefined) continue // structurally impossible — loop above just set this key
          agent.model = zmoraModel
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
      parse_plan: tool({
        description: [
          "Parse a QA plan's `## Setup` → `**Bindings:**` subsection into the plugin's per-run state. Perun MUST call this exactly once per QA run, after reading the plan and BEFORE the first `dispatch_parallel` that includes a zmora-setup task. Without this call `execute_recipe` returns `{status:\"unknown_binding\"}` for every recipe.",
          "",
          "The plan text is parsed in-process — the binding values themselves are NEVER produced here, only the recipe AST. Value materialisation happens later in `execute_recipe`.",
          "",
          "Result shape (JSON-stringified):",
          "- `{ status: \"ok\", bindings: string[] }` — bindings stored; `bindings` lists the names parsed (e.g. `[\"QA_BIND_TOKEN\"]`). Empty array means the plan has no `## Setup` / `**Bindings:**` subsection — Perun should proceed to dispatch without any zmora-setup tasks.",
          "- `{ status: \"error\", reason }` — parse/validation failed (invalid binding name, recipe AST rejection, etc.). Surface `reason` to the user verbatim and abort the QA run.",
          "",
          "Idempotent: calling twice with the same plan replaces the stored plan (later wins). Safe to call again on resume.",
        ].join("\n"),
        args: {
          plan: tool.schema
            .string()
            .describe(
              "Full text of the QA plan markdown. Perun passes the contents read via `Read` — do not summarise or trim.",
            ),
        },
        async execute(args, ctx) {
          const parentID = (await resolveParentID(ctx.sessionID)) ?? ctx.sessionID
          const parsed = parseBindings(args.plan)
          if (parsed.status !== "ok") {
            return JSON.stringify({ status: "error", reason: parsed.reason })
          }
          state.storePlan(parentID, parsed.bindings)
          return JSON.stringify({
            status: "ok",
            bindings: parsed.bindings.map((b) => b.name),
          })
        },
      }),
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
    event: async ({ event }) => {
      // Defensive cleanup on `session.deleted`. The SDK emits this for BOTH
      // parent (Perun) and child (zmora-*) sessions, and child sessions die
      // independently of their parent in long-lived OpenCode processes — so
      // every call here must be safe and meaningful for either kind of ID.
      //
      // The order below is "registry first, then keyed state, then caches":
      //  - `registry.unregister(deletedID)` — ALWAYS. This is the credential-
      //    mapping store (childSessionID → agent name) that gates the
      //    `shell.env` hook; a stale entry plus a recycled SDK session ID
      //    would in principle leak bindings into the wrong session, so we
      //    drop it whether the deleted ID is a parent or a child (ARCH-003).
      //  - `store.clearParent` / `state.clearRun` — no-op when `deletedID`
      //    is a child (they're keyed by parent ID). Cheap to call always.
      //  - `parentIDCache` — drop the entry for the deleted ID itself, then
      //    sweep any child entries that pointed at this (deleted) parent so
      //    they don't resolve to a tombstone.
      //
      // Bounded by `sweepExpired`, but explicit cleanup avoids waiting up to
      // TTL_MS for the next periodic pass.
      if (event.type !== "session.deleted") return
      const deletedID = event.properties?.info?.id
      if (typeof deletedID !== "string" || deletedID.length === 0) return
      registry.unregister(deletedID)
      store.clearParent(deletedID)
      state.clearRun(deletedID)
      parentIDCache.delete(deletedID)
      // Sweep child entries whose cached parent is the deleted ID — they're
      // stale now that the parent is gone.
      for (const [childID, parentID] of parentIDCache.entries()) {
        if (parentID === deletedID) parentIDCache.delete(childID)
      }
    },
  }
}

export default AppVerkQAPlugin
