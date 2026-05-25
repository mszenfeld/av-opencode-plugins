import { describe, it, expect } from "vitest"
import util from "node:util"
import { Secret } from "../../../src/modules/qa/secret.js"

describe("Secret", () => {
  it("stores a value retrievable via .unwrap()", () => {
    const s = new Secret("hunter2")
    expect(s.unwrap()).toBe("hunter2")
  })

  it("redacts on toJSON()", () => {
    const s = new Secret("hunter2")
    expect(JSON.stringify(s)).toBe('"[REDACTED]"')
  })

  it("redacts on util.inspect", () => {
    const s = new Secret("hunter2")
    expect(util.inspect(s)).toBe("[REDACTED]")
  })

  it("redacts on String() coercion", () => {
    const s = new Secret("hunter2")
    expect(String(s)).toBe("[REDACTED]")
  })

  it("redacts on template literal", () => {
    const s = new Secret("hunter2")
    expect(`token=${s}`).toBe("token=[REDACTED]")
  })
})
