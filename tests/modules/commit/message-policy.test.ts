import { describe, expect, it } from "vitest"
import { normalizeCommitMessage } from "../../../src/modules/commit/message-policy.js"

describe("normalizeCommitMessage", () => {
  it("accepts a valid Conventional Commit subject", () => {
    expect(normalizeCommitMessage("feat: add commit plugin")).toBe(
      "feat: add commit plugin",
    )
  })

  it("appends a Refs footer once", () => {
    expect(normalizeCommitMessage("fix: block direct commit", "AV-42")).toBe(
      "fix: block direct commit\n\nRefs: AV-42",
    )
  })

  it("rejects disallowed co-authorship footers", () => {
    expect(() =>
      normalizeCommitMessage(
        "feat: add plugin\n\nCo-Authored-By: Bot <bot@example.com>",
      ),
    ).toThrow(/Co-Authored-By/i)
  })

  it("rejects messages that do not follow Conventional Commits", () => {
    expect(() => normalizeCommitMessage("add plugin")).toThrow(
      /Conventional Commits/i,
    )
  })

  it("rejects a taskId containing a newline", () => {
    expect(() =>
      normalizeCommitMessage(
        "feat: add plugin",
        "PROJ-123\nSigned-off-by: x@example.com",
      ),
    ).toThrow(/newlines|carriage returns/i)
  })

  it("rejects a taskId containing a carriage return", () => {
    expect(() =>
      normalizeCommitMessage("feat: add plugin", "PROJ-123\rExtra"),
    ).toThrow(/newlines|carriage returns/i)
  })

  it("produces the expected Refs footer for a normal taskId", () => {
    expect(normalizeCommitMessage("feat: add plugin", "PROJ-123")).toBe(
      "feat: add plugin\n\nRefs: PROJ-123",
    )
  })

  it("trims surrounding whitespace from a taskId", () => {
    expect(normalizeCommitMessage("feat: add plugin", "  PROJ-123  ")).toBe(
      "feat: add plugin\n\nRefs: PROJ-123",
    )
  })

  it("re-runs the disallowed-footer check on the combined message (defense in depth)", () => {
    // Even though the sanitizer rejects newlines in `taskId`, the combined
    // message is re-validated. This covers the case where a disallowed
    // footer is present in the body — it must still be rejected before the
    // Refs footer is appended.
    expect(() =>
      normalizeCommitMessage(
        "feat: add plugin\n\nCo-Authored-By: Bot <bot@example.com>",
        "PROJ-123",
      ),
    ).toThrow(/Co-Authored-By/i)
  })
})
