import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/** Canonical agent key for the Veles planning specialist. */
export const VELES_AGENT_KEY = "veles" as const

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
