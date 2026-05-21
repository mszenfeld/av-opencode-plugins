import { describe, expect, it } from "vitest"
import { assignIssueIds } from "../../../src/modules/coordinator/assign-issue-ids.js"

describe("assignIssueIds", () => {
  it("returns empty array for empty findings", () => {
    const result = assignIssueIds({ findings: [], prefix: "QA" })
    expect(result).toEqual([])
  })

  it("assigns zero-padded IDs starting at 001", () => {
    const findings = [
      { severity: "high", title: "SQL injection" },
      { severity: "low", title: "Missing alt text" },
    ]
    const result = assignIssueIds({ findings, prefix: "QA" })
    expect(result[0]?.id).toBe("QA-001")
    expect(result[1]?.id).toBe("QA-002")
  })

  it("preserves input order", () => {
    const findings = [
      { severity: "low", title: "First" },
      { severity: "high", title: "Second" },
      { severity: "medium", title: "Third" },
    ]
    const result = assignIssueIds({ findings, prefix: "QA" })
    expect(result.map((f) => f.title)).toEqual(["First", "Second", "Third"])
    expect(result.map((f) => f.id)).toEqual(["QA-001", "QA-002", "QA-003"])
  })

  it("supports custom prefix and startAt", () => {
    const findings = [
      { severity: "medium", title: "Slow query" },
      { severity: "low", title: "Large bundle" },
    ]
    const result = assignIssueIds({ findings, prefix: "PERF", startAt: 5 })
    expect(result[0]?.id).toBe("PERF-005")
    expect(result[1]?.id).toBe("PERF-006")
  })

  it("is idempotent — running twice produces the same IDs", () => {
    const findings = [
      { severity: "high", title: "XSS vulnerability" },
      { severity: "medium", title: "Outdated dependency" },
    ]
    const first = assignIssueIds({ findings, prefix: "QA" })
    const second = assignIssueIds({ findings: first, prefix: "QA" })
    expect(second.map((f) => f.id)).toEqual(first.map((f) => f.id))
  })

  it("handles 999 → 1000 transition without padding", () => {
    const findings = Array.from({ length: 1001 }, (_, i) => ({
      severity: "low",
      title: `Finding ${i + 1}`,
    }))
    const result = assignIssueIds({ findings, prefix: "QA" })
    expect(result[998]?.id).toBe("QA-999")
    expect(result[999]?.id).toBe("QA-1000")
  })

  it("preserves additional object properties", () => {
    const findings = [
      { severity: "high", title: "Type error", file: "x.ts", line: 42 },
    ]
    const result = assignIssueIds({ findings, prefix: "QA" })
    expect(result[0]?.file).toBe("x.ts")
    expect(result[0]?.line).toBe(42)
    expect(result[0]?.id).toBe("QA-001")
  })
})
