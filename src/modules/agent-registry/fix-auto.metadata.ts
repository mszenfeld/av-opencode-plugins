import type { SpecialistInfo } from "./agent-metadata.js"

/**
 * Explicit src-side entry for `fix-auto`, which lives in `packages/code-review`
 * (a separate build unit that cannot import the registry bridge during the
 * plugins->harness migration — see spec). Registered from the coordinator factory.
 */
export const fixAutoSpecialistInfo: SpecialistInfo = {
  name: "fix-auto",
  mode: "subagent",
  description:
    "Auto-fix code issues from reports. Used when the user accepts a fix proposal after a QA run.",
  metadata: {
    category: "utility",
    cost: "CHEAP",
    triggers: [],
  },
}
