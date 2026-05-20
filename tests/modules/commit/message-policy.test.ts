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
})
