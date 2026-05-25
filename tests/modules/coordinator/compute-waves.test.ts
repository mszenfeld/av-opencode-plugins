import { describe, expect, it } from "vitest"
import {
  computeWaves,
  type Scenario,
} from "../../../src/modules/coordinator/compute-waves.js"

function scenario(
  id: string,
  dependsOn: string[],
  sourceOrder: number,
): Scenario {
  return { id, dependsOn, sourceOrder }
}

describe("computeWaves", () => {
  it("returns empty waves for empty input", () => {
    const result = computeWaves([])
    expect(result).toEqual({ waves: [] })
  })

  it("puts every dependency-free scenario in wave 0", () => {
    const result = computeWaves([
      scenario("FE-01", [], 0),
      scenario("FE-02", [], 1),
      scenario("BE-01", [], 2),
    ])
    expect(result.error).toBeUndefined()
    expect(result.waves).toEqual([["FE-01", "FE-02", "BE-01"]])
  })

  it("handles a linear chain (A → B → C → D)", () => {
    const result = computeWaves([
      scenario("BE-01", [], 0),
      scenario("BE-02", ["BE-01"], 1),
      scenario("BE-03", ["BE-02"], 2),
      scenario("BE-04", ["BE-03"], 3),
    ])
    expect(result.error).toBeUndefined()
    expect(result.waves).toEqual([["BE-01"], ["BE-02"], ["BE-03"], ["BE-04"]])
  })

  it("handles fan-out: one root → many leaves", () => {
    const result = computeWaves([
      scenario("BE-01", [], 0),
      scenario("BE-02", ["BE-01"], 1),
      scenario("BE-03", ["BE-01"], 2),
      scenario("BE-04", ["BE-01"], 3),
    ])
    expect(result.error).toBeUndefined()
    expect(result.waves).toEqual([
      ["BE-01"],
      ["BE-02", "BE-03", "BE-04"],
    ])
  })

  it("handles fan-in: many roots → one leaf", () => {
    const result = computeWaves([
      scenario("BE-01", [], 0),
      scenario("BE-02", [], 1),
      scenario("BE-03", [], 2),
      scenario("BE-04", ["BE-01", "BE-02", "BE-03"], 3),
    ])
    expect(result.error).toBeUndefined()
    expect(result.waves).toEqual([
      ["BE-01", "BE-02", "BE-03"],
      ["BE-04"],
    ])
  })

  it("rejects self-references with kind: self-ref", () => {
    const result = computeWaves([
      scenario("BE-01", [], 0),
      scenario("BE-02", ["BE-02"], 1),
    ])
    expect(result.waves).toEqual([])
    expect(result.error).toEqual({
      kind: "self-ref",
      details: "BE-02 cannot depend on itself",
    })
  })

  it("rejects dangling references with kind: dangling", () => {
    const result = computeWaves([
      scenario("BE-01", [], 0),
      scenario("BE-05", ["BE-99"], 1),
    ])
    expect(result.waves).toEqual([])
    expect(result.error).toEqual({
      kind: "dangling",
      details: "BE-05 depends on BE-99 which does not exist",
    })
  })

  it("rejects a simple 2-node cycle (A → B → A)", () => {
    const result = computeWaves([
      scenario("BE-02", ["BE-03"], 0),
      scenario("BE-03", ["BE-02"], 1),
    ])
    expect(result.waves).toEqual([])
    expect(result.error?.kind).toBe("cycle")
    expect(result.error?.details).toContain("dependency cycle detected")
    expect(result.error?.details).toContain("BE-02")
    expect(result.error?.details).toContain("BE-03")
    // Cycle should close visually (last id repeats first).
    expect(result.error?.details).toMatch(/BE-02 → BE-03 → BE-02/)
  })

  it("rejects a deeper 3-node cycle (A → B → C → A)", () => {
    const result = computeWaves([
      scenario("BE-01", ["BE-03"], 0),
      scenario("BE-02", ["BE-01"], 1),
      scenario("BE-03", ["BE-02"], 2),
    ])
    expect(result.waves).toEqual([])
    expect(result.error?.kind).toBe("cycle")
    expect(result.error?.details).toContain("dependency cycle detected")
    expect(result.error?.details).toContain("BE-01")
    expect(result.error?.details).toContain("BE-02")
    expect(result.error?.details).toContain("BE-03")
  })

  it("preserves source order within a wave as the tie-breaker", () => {
    // All four scenarios have the same dependency, so they all land in
    // wave 1. The order within the wave must match the source order.
    const result = computeWaves([
      scenario("BE-01", [], 0),
      scenario("BE-04", ["BE-01"], 1),
      scenario("BE-02", ["BE-01"], 2),
      scenario("BE-05", ["BE-01"], 3),
      scenario("BE-03", ["BE-01"], 4),
    ])
    expect(result.error).toBeUndefined()
    expect(result.waves).toEqual([
      ["BE-01"],
      ["BE-04", "BE-02", "BE-05", "BE-03"],
    ])
  })

  it("handles mixed FE/BE scenarios without prefix bias", () => {
    const result = computeWaves([
      scenario("FE-01", [], 0),
      scenario("BE-01", [], 1),
      scenario("FE-02", ["FE-01"], 2),
      scenario("BE-02", ["BE-01", "FE-01"], 3),
    ])
    expect(result.error).toBeUndefined()
    expect(result.waves).toEqual([
      ["FE-01", "BE-01"],
      ["FE-02", "BE-02"],
    ])
  })

  it("detects self-references even when the scenario also has valid deps", () => {
    const result = computeWaves([
      scenario("BE-01", [], 0),
      scenario("BE-02", ["BE-01", "BE-02"], 1),
    ])
    expect(result.error).toEqual({
      kind: "self-ref",
      details: "BE-02 cannot depend on itself",
    })
  })

  it("detects dangling refs even when the scenario also has valid deps", () => {
    const result = computeWaves([
      scenario("BE-01", [], 0),
      scenario("BE-02", ["BE-01", "BE-99"], 1),
    ])
    expect(result.error).toEqual({
      kind: "dangling",
      details: "BE-02 depends on BE-99 which does not exist",
    })
  })

  it("validates self-refs before dangling refs (self-ref takes precedence)", () => {
    // BE-02 has both a self-reference and a dangling reference. The
    // self-ref check runs first so the user sees the most actionable error.
    const result = computeWaves([
      scenario("BE-01", [], 0),
      scenario("BE-02", ["BE-02", "BE-99"], 1),
    ])
    expect(result.error?.kind).toBe("self-ref")
  })

  // Contract documented in src/agents/perun.md (Resume Semantics, step 3).
  // On resume, the re-dispatch set R = {NEED_INFO ∪ un-started}. Predecessors
  // that already PASS-ed are NOT in R, so the agent must pre-filter each
  // scenario's depends_on to drop entries pointing to PASS-ed predecessors
  // before calling computeWaves. These tests pin both halves of that
  // contract: the dangling error that motivates the pre-filter, and the
  // correct waves the agent gets after applying it.
  describe("resume re-dispatch pre-filter contract", () => {
    it("reports dangling when R contains a scenario whose depends_on references a PASS-ed predecessor not in R", () => {
      // Simulated resume state: BE-01 already PASS-ed (not in R). BE-02
      // returned NEED_INFO and still lists BE-01 as a dep. If the agent
      // forgets to pre-filter, computeWaves sees an unknown id and aborts.
      const result = computeWaves([
        scenario("BE-02", ["BE-01"], 0),
        scenario("BE-03", ["BE-02"], 1),
      ])
      expect(result.waves).toEqual([])
      expect(result.error).toEqual({
        kind: "dangling",
        details: "BE-02 depends on BE-01 which does not exist",
      })
    })

    it("returns correct waves once the agent pre-filters PASS-ed predecessors out of depends_on", () => {
      // Same resume state as above, but the agent applied step 3 of the
      // resume contract: BE-01 is dropped from BE-02's depends_on because
      // it already PASS-ed. computeWaves now sees a self-consistent R.
      const result = computeWaves([
        scenario("BE-02", [], 0),
        scenario("BE-03", ["BE-02"], 1),
      ])
      expect(result.error).toBeUndefined()
      expect(result.waves).toEqual([["BE-02"], ["BE-03"]])
    })

    it("keeps failed-predecessor edges intact after pre-filter (failures do not cascade)", () => {
      // Contract step 4: predecessor FAIL/error/timeout does not block
      // re-dispatch, but it also doesn't get dropped from depends_on the
      // way PASS does — only PASS-ed predecessors are filtered out. Here
      // BE-01 previously FAIL-ed and is being re-dispatched alongside its
      // dependent BE-02, so BE-01 stays in R and the edge is preserved.
      const result = computeWaves([
        scenario("BE-01", [], 0),
        scenario("BE-02", ["BE-01"], 1),
      ])
      expect(result.error).toBeUndefined()
      expect(result.waves).toEqual([["BE-01"], ["BE-02"]])
    })

    it("handles partial pre-filter: one PASS-ed dep dropped, one re-dispatched dep kept", () => {
      // BE-03 originally depended on both BE-01 (PASS-ed → dropped) and
      // BE-02 (NEED_INFO → kept). After pre-filter, BE-03 still has BE-02
      // as a dep, so computeWaves orders them across two waves.
      const result = computeWaves([
        scenario("BE-02", [], 0),
        scenario("BE-03", ["BE-02"], 1),
      ])
      expect(result.error).toBeUndefined()
      expect(result.waves).toEqual([["BE-02"], ["BE-03"]])
    })
  })
})
