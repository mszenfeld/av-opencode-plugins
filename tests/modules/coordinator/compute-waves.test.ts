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
})
