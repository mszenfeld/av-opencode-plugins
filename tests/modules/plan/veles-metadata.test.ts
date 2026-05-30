import { describe, expect, it } from "vitest"
import {
  VELES_AGENT_KEY,
  velesSpecialistInfo,
} from "../../../src/modules/plan/veles.metadata.js"

describe("velesSpecialistInfo", () => {
  it("is keyed 'Veles - Planner' (display/dispatch name) and is mode all", () => {
    expect(VELES_AGENT_KEY).toBe("Veles - Planner")
    expect(velesSpecialistInfo.name).toBe("Veles - Planner")
    expect(velesSpecialistInfo.mode).toBe("all")
  })
  it("is a specialist with EXPENSIVE cost and a planning trigger", () => {
    expect(velesSpecialistInfo.metadata.category).toBe("specialist")
    expect(velesSpecialistInfo.metadata.cost).toBe("EXPENSIVE")
    expect(velesSpecialistInfo.metadata.triggers.length).toBeGreaterThan(0)
    expect(velesSpecialistInfo.metadata.keyTrigger).toBeDefined()
  })
})
