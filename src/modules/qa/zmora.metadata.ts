import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/**
 * One logical entry for the three physical `zmora-fe` / `zmora-be` /
 * `zmora-setup` variants registered in `qa/index.ts`. The variant suffix is an
 * internal detail; Perun's table shows only `zmora`.
 */
export const zmoraSpecialistInfo: SpecialistInfo = {
  name: "zmora",
  mode: "subagent",
  description:
    "Execute a single QA scenario (FE or BE). Internally split into variants `zmora-fe` / `zmora-be`; Perun routes by scenario prefix. Dispatched once per scenario by Perun.",
  metadata: {
    category: "specialist",
    cost: "EXPENSIVE",
    triggers: [],
  },
}
