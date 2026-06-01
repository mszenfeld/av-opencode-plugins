import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/**
 * Registered agent name for the Veles planning specialist — also its dispatch
 * identifier (used by `DISPATCHABLE_ALL_AGENTS` and Perun's no-plan dispatch).
 *
 * Mirrors Perun's "Name - Role" display-name convention (see
 * `coordinator/index.ts`): OpenCode has no separate display field, so the
 * `config.agent` KEY is what the TUI shows in the /agents picker, status bar,
 * and session label. Use space-dash-space — NEVER parentheses, which break the
 * `x-opencode-agent-name` HTTP header.
 *
 * NOTE: this is distinct from the pantheon.json config slug, which stays
 * lowercase `agents.veles.model` (read literally in `plan/index.ts`), exactly
 * as Perun's display key "Perun - Coordinator" pairs with `agents.perun`.
 */
export const VELES_AGENT_KEY = "Veles - Planner" as const

export const VELES_DESCRIPTION =
  "Planning specialist: authors QA test plans (and other work plans) from a diff or request. Dispatches read-only helpers (triglav) and returns a plan it saved — it does not execute the planned work."

export const velesSpecialistInfo: SpecialistInfo = {
  name: VELES_AGENT_KEY,
  mode: "all",
  description: VELES_DESCRIPTION,
  metadata: {
    category: "specialist",
    cost: "EXPENSIVE",
    keyTrigger:
      "QA run requested but no plan exists → dispatch `veles` to author one before attempting QA",
    useWhen: [
      "No QA plan exists and the user wants to run QA",
      "User asks to plan QA scenarios or a piece of work from a diff/request",
    ],
    avoidWhen: [
      "A current QA plan already exists in docs/testing/plans/",
      "The task is execution, not planning (dispatch zmora / fix-auto instead)",
    ],
    triggers: [
      {
        domain: "Planning",
        trigger: "Author a QA test plan (or other work plan) from a diff or request",
      },
    ],
  },
}
