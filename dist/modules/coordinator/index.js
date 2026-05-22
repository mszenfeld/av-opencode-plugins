import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
function loadAgentPrompt(name) {
  const filePath = path.resolve(moduleDir, "../../agents", `${name}.md`);
  return readFileSync(filePath, "utf8");
}
let cachedPerunPrompt;
function getPerunPrompt() {
  if (cachedPerunPrompt === void 0) {
    cachedPerunPrompt = loadAgentPrompt("perun");
  }
  return cachedPerunPrompt;
}
const AppVerkCoordinatorPlugin = async (input) => {
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
        'REQUIRED. Display label for the dispatched agent(s). Free-form, but follow this convention so reviewers can scan the TUI line:\n- single agent: bare name (e.g. "code-reviewer")\n- N copies of one agent (total dispatched; \u22644 run concurrently): "name \xD7N" (e.g. "code-reviewer \xD73" or "code-reviewer \xD710")\n- different agents: comma-joined names (e.g. "code-reviewer, security-auditor")\n- mixed + duplicates: combine the two (e.g. "code-reviewer \xD72, security-auditor")\nHard cap 60 chars. Do not include prompts, goals, or PII \u2014 `summary` is the place for that.\n\nException for logical agents with multiple variants: when a logical agent is implemented as multiple registered names (e.g. `qa-tester` \u2192 `qa-tester-fe` + `qa-tester-be`), use the logical name in `agent`, not the variant names. Document the mapping in the dispatching agent\'s prompt.'
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
        // cancelled server-side when it fires.
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
    // IMPORTANT: Tool names "dispatch_parallel", "assign_issue_ids", and "compute_waves" must
    // exactly match the `allowed-tools` frontmatter in `src/agents/perun.md`. If you rename any
    // tool, update both places. There is no programmatic linking — keep them in sync manually.
    tool: {
      dispatch_parallel: dispatchParallelTool,
      assign_issue_ids: assignIssueIdsTool,
      compute_waves: computeWavesTool
    }
  };
};
export {
  AppVerkCoordinatorPlugin,
  createSDKSpecialist,
  deriveReportPath,
  loadAgentRegistry,
  neutralizeUntrustedOutput,
  normalizeVariantSuffix,
  toPollerMessage
};
