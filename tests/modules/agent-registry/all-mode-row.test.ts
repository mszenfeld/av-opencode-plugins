import { describe, expect, it } from "vitest"
import {
  buildSpecialistsTable,
  type SpecialistInfo,
} from "../../../src/modules/agent-registry/index.js"

const veles: SpecialistInfo = {
  name: "veles",
  mode: "all",
  description: "planner",
  metadata: { category: "specialist", cost: "EXPENSIVE", triggers: [] },
}

describe("buildSpecialistsTable with an all-mode specialist", () => {
  it("renders the mode value verbatim in the row", () => {
    const table = buildSpecialistsTable([veles])
    expect(table).toContain("| `veles` | all | planner |")
  })
})
