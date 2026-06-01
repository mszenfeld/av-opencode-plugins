import { tool } from "@opencode-ai/plugin";
import { dispatchParallel } from "./dispatch.js";
import { assignIssueIds } from "./assign-issue-ids.js";
import { computeWaves } from "./compute-waves.js";
import {
  neutralizeUntrustedOutput,
  deriveReportPath,
  normalizeVariantSuffix
} from "./sanitize.js";
import {
  createSDKSpecialist,
  loadAgentRegistry,
  toPollerMessage
} from "./sdk-specialist.js";
import {
  getLoadErrors,
  loadPantheonConfig,
  pantheonConfigEmpty
} from "../pantheon-config/index.js";
import { loadModuleAsset } from "../_shared/load-asset.js";
import {
  buildPerunPrompt,
  getAgentMetadataRegistry,
  registerAgentMetadata
} from "../agent-registry/index.js";
import { fixAutoSpecialistInfo } from "../agent-registry/fix-auto.metadata.js";
import { getDispatchExtensions } from "../_shared/dispatch-extensions.js";
import { BackgroundTaskStore } from "./background-store.js";
import { collectBackground, startBackgroundTask } from "./background.js";
function loadAgentPrompt(name) {
  return loadModuleAsset(import.meta.url, `../../agents/${name}.md`);
}
const PERUN_TOOLS = [
  "dispatch_parallel",
  "assign_issue_ids",
  "compute_waves",
  "dispatch_background",
  "poll_background",
  "wait_background"
];
let cachedPerunPrompt;
function getPerunPrompt() {
  if (cachedPerunPrompt === void 0) {
    const template = loadAgentPrompt("perun");
    cachedPerunPrompt = buildPerunPrompt(template, getAgentMetadataRegistry());
  }
  return cachedPerunPrompt;
}
const AppVerkCoordinatorPlugin = async (input) => {
  const { client } = input;
  let toastShown = false;
  const backgroundStore = new BackgroundTaskStore();
  registerAgentMetadata(fixAutoSpecialistInfo);
  const dispatchParallelTool = tool({
    description: [
      "Dispatch tasks to specialist agents in parallel. Returns results in the same order as the input tasks. Use this instead of calling Task directly to guarantee parallelism and deterministic ordering.",
      "",
      "Guarantees and limits:",
      "- Maximum 4 tasks per call (aligned with the worker pool size; over-limit calls are rejected before any session is created). For larger workloads, chunk into multiple sequential dispatch_parallel calls.",
      "- A 4-worker pool runs every task in this call in parallel. `tasks.length \u2264 4` is enforced, so concurrency equals the call size. Result order is preserved.",
      '- Each task has a 5-minute hard timeout; on expiry the task is returned with status "timeout" and the partial result is discarded.',
      '- Each successful result is truncated at 100KB (UTF-8 bytes). Truncated results end with the marker "[\u2026truncated\u2026]" \u2014 synthesize what is present, do not retry.',
      '- Anti-recursion pre-flight: every task is validated against the live agent registry BEFORE any session is created. Tasks targeting an unknown agent or a `mode: primary` agent are rejected. A `mode: all` agent is rejected UNLESS it is on the dispatch allowlist (currently only the planner, registered as `"Veles - Planner"`) AND the caller is a primary agent; this lets the coordinator dispatch the planner while blocking self/nested recursion. Rejections throw and dispatch nothing.',
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
        'REQUIRED. Display label for the dispatched agent(s). Free-form, but follow this convention so reviewers can scan the TUI line:\n- single agent: bare name (e.g. "code-reviewer")\n- N copies of one agent (2 \u2264 N \u2264 4): "name \xD7N" (e.g. "code-reviewer \xD73", "code-reviewer \xD74"). N == 1 uses the bare name. N is capped at 4 \u2014 the per-call task limit; chunk larger workloads into multiple sequential calls.\n- different agents: comma-joined names (e.g. "code-reviewer, security-auditor")\n- mixed + duplicates: combine the two (e.g. "code-reviewer \xD72, security-auditor")\nHard cap 60 chars. Do not include prompts, goals, or PII \u2014 `summary` is the place for that.\n\nException for logical agents with multiple variants: when a logical agent is implemented as multiple registered names (e.g. `zmora` \u2192 `zmora-fe` + `zmora-be`), use the logical name in `agent`, not the variant names. Document the mapping in the dispatching agent\'s prompt.'
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
      const callerMode = agentRegistry[context.agent]?.mode;
      const ext = getDispatchExtensions();
      const results = await dispatchParallel({
        tasks: args.tasks,
        agentRegistry,
        specialist,
        callerMode,
        // Thread the harness abort signal end-to-end: poller checks it at each
        // iteration and during the inter-poll sleep, and child sessions are
        // cancelled server-side when it fires.
        signal: context.abort,
        parentSessionID: context.sessionID,
        sessionAgentRegistry: ext.sessionAgentRegistry,
        scrubber: ext.scrubber,
        scrubberFactory: ext.scrubberFactory,
        preflight: ext.preflight
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
  const computeWavesTool = tool({
    description: [
      "Compute dependency-aware dispatch waves from a flat scenario list (Kahn's topological sort). Use this when a QA plan declares `**Depends-on:**` between scenarios \u2014 call BEFORE `dispatch_parallel` to decide what to run when.",
      "",
      "Inputs:",
      '- `scenarios`: array of `{ id: string, dependsOn: string[], sourceOrder: number }`. `id` is the scenario heading (e.g. "BE-02"), `dependsOn` is the parsed `**Depends-on:**` list (empty array if absent), `sourceOrder` is the scenario\'s position in the plan (used as the tie-breaker within a wave).',
      "",
      "Output (JSON-stringified):",
      "- `{ waves: string[][] }` on success. `waves[0]` is the first dispatch wave; within each wave the IDs are emitted in source order.",
      '- `{ waves: [], error: { kind, details } }` on validation failure. `kind` is one of `"self-ref"`, `"dangling"`, `"cycle"`. The caller (Perun) MUST NOT call `dispatch_parallel` when `error` is present \u2014 surface `details` verbatim to the user and abort the run.',
      "- Empty input returns `{ waves: [] }` with no error.",
      "",
      "Guarantees:",
      "- Deterministic: same input \u2192 same output. Within a wave, source order is the tie-breaker.",
      "- Pure: no I/O, no globals, no clock dependence."
    ].join("\n"),
    args: {
      scenarios: tool.schema.array(
        tool.schema.object({
          id: tool.schema.string().describe('Scenario id, e.g. "BE-02"'),
          dependsOn: tool.schema.array(tool.schema.string()).describe("Scenario ids this scenario depends on (empty array if none)"),
          sourceOrder: tool.schema.number().describe("Scenario position in the plan (used as tie-breaker within a wave)")
        })
      ).describe("Flat scenario list with parsed dependencies")
    },
    async execute(args) {
      const result = computeWaves(args.scenarios);
      return JSON.stringify(result, null, 2);
    }
  });
  const dispatchBackgroundTool = tool({
    description: [
      "Start a specialist task in the BACKGROUND and return immediately with a task id (bg_...). The task runs while you do other work in THIS turn; collect it later with wait_background / poll_background.",
      "",
      "- Single task per call. Max 4 background tasks running per session \u2014 collect one before firing more.",
      "- Use for read-only work you can overlap with your own (especially `triglav` exploration). Use blocking `dispatch_parallel` when you need the result immediately or need ordered QA waves.",
      "- ALWAYS collect (wait_background/poll_background) what you start before ending the turn \u2014 uncollected tasks are wasted.",
      '- Returns: { id, agent, status: "running" }.'
    ].join("\n"),
    args: {
      agent: tool.schema.string().min(1).max(60).describe('Specialist agent name (e.g. "triglav"). Must be a subagent, or an allowlisted mode:all agent (currently only "Veles - Planner") when the caller is a primary agent.'),
      summary: tool.schema.string().min(1).max(80).describe("One-line label for the TUI (no prompts/PII)."),
      prompt: tool.schema.string().describe("Prompt for the specialist."),
      context: tool.schema.string().optional().describe("Optional extra context appended to the prompt.")
    },
    async execute(args, context) {
      context.metadata({ title: `${args.agent} \u2014 ${args.summary}` });
      if (context.sessionID.length === 0) {
        throw new Error("dispatch_background: missing context.sessionID");
      }
      const specialist = createSDKSpecialist(client, context.sessionID);
      const agentRegistry = await loadAgentRegistry(client);
      const callerMode = agentRegistry[context.agent]?.mode;
      const result = await startBackgroundTask({
        store: backgroundStore,
        specialist,
        agentRegistry,
        callerMode,
        parentSessionId: context.sessionID,
        agent: args.agent,
        prompt: args.prompt,
        context: args.context
      });
      return JSON.stringify(result, null, 2);
    }
  });
  const pollBackgroundTool = tool({
    description: [
      "Check the status of background tasks WITHOUT blocking. Returns a snapshot per id.",
      '- Result per id: { id, agent, status: "running" | "success" | "not_found", result?, duration_ms? }.',
      "- Use to decide whether to keep working or to wait_background."
    ].join("\n"),
    args: {
      ids: tool.schema.array(tool.schema.string()).describe("Background task ids (bg_...) to check.")
    },
    async execute(args, context) {
      context.metadata({ title: `poll ${args.ids.length} task(s)` });
      const specialist = createSDKSpecialist(client, context.sessionID);
      const ext = getDispatchExtensions();
      const results = await collectBackground({
        store: backgroundStore,
        specialist,
        ids: args.ids,
        block: false,
        scrubber: ext.scrubber,
        parentSessionId: context.sessionID
      });
      return JSON.stringify(results, null, 2);
    }
  });
  const waitBackgroundTool = tool({
    description: [
      "BLOCK until the given background tasks are idle (or time out), then return their results. Collected tasks are removed (one-time retrieval), freeing background slots.",
      '- Result per id: { id, agent, status: "success" | "error" | "timeout" | "aborted" | "not_found", result, duration_ms, error? }.',
      "- Honors abort: aborting cancels the wait AND kills the waited child sessions."
    ].join("\n"),
    args: {
      ids: tool.schema.array(tool.schema.string()).describe("Background task ids (bg_...) to wait for."),
      timeoutMs: tool.schema.number().optional().describe("Per-task timeout in ms (default 5 min).")
    },
    async execute(args, context) {
      context.metadata({ title: `wait ${args.ids.length} task(s)` });
      const specialist = createSDKSpecialist(client, context.sessionID);
      const ext = getDispatchExtensions();
      const results = await collectBackground({
        store: backgroundStore,
        specialist,
        ids: args.ids,
        block: true,
        timeoutMs: args.timeoutMs,
        signal: context.abort,
        scrubber: ext.scrubber,
        parentSessionId: context.sessionID
      });
      return JSON.stringify(results, null, 2);
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
        },
        // Partial override: OpenCode merges this dict over the default toolset,
        // so unlisted tools stay enabled — this disables ONLY these two and
        // leaves Perun's other tools intact. The coordinator orchestrates; it
        // must not load skills itself.
        // `skill: false` is a REAL backstop for the NATIVE `skill` tool on the
        // installed opencode 1.15.x runtime (verified in Task 1a): the runtime's
        // permission engine is string-keyed/PermissionV2, so the v1-SDK type
        // lacking a `skill` key is cosmetic — `skill: false` filters the tool out
        // of the toolset AND denies it at execute time. `load_appverk_skill: false`
        // gates the separate plugin skill-loader.
        tools: { skill: false, load_appverk_skill: false }
      };
      const perunModel = loadPantheonConfig().agents.perun?.model;
      if (perunModel !== void 0) {
        config.agent["Perun - Coordinator"].model = perunModel;
      }
    },
    // IMPORTANT: Tool names here must exactly match the `allowed-tools` frontmatter in
    // `src/agents/perun.md`. The exported `PERUN_TOOLS` constant lists them and
    // `tests/modules/coordinator/perun-tools-sync.test.ts` enforces the match. If you
    // rename/add a tool, update PERUN_TOOLS + perun.md too — there is no programmatic link.
    tool: {
      dispatch_parallel: dispatchParallelTool,
      assign_issue_ids: assignIssueIdsTool,
      compute_waves: computeWavesTool,
      dispatch_background: dispatchBackgroundTool,
      poll_background: pollBackgroundTool,
      wait_background: waitBackgroundTool
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const deletedID = event.properties?.info?.id;
        if (typeof deletedID === "string" && deletedID.length > 0) {
          for (const t of backgroundStore.listByParent(deletedID)) {
            try {
              await createSDKSpecialist(client, deletedID).abortTask(t.childSessionId);
            } catch {
            }
          }
          backgroundStore.clearParent(deletedID);
          backgroundStore.removeByChild(deletedID);
        }
        return;
      }
      if (event.type !== "session.created") return;
      if (toastShown) return;
      try {
        const errors = getLoadErrors().map(neutralizeUntrustedOutput);
        for (const e of errors) console.error(e);
        if (errors.length > 0) {
          await client.tui.showToast({
            body: {
              variant: "warning",
              title: "Pantheon",
              message: errors[0] ?? "pantheon.json parse error \u2014 check console for details"
            }
          });
        } else if (pantheonConfigEmpty()) {
          await client.tui.showToast({
            body: {
              variant: "info",
              title: "Pantheon",
              message: "pantheon.json not found \u2014 using default models"
            }
          });
        }
        toastShown = true;
      } catch {
        toastShown = true;
      }
    }
  };
};
export {
  AppVerkCoordinatorPlugin,
  PERUN_TOOLS,
  createSDKSpecialist,
  deriveReportPath,
  loadAgentRegistry,
  neutralizeUntrustedOutput,
  normalizeVariantSuffix,
  toPollerMessage
};
