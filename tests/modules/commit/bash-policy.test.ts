import { describe, expect, it } from "vitest"
import { classifyBashCommand } from "../../../src/modules/commit/bash-policy.js"

describe("classifyBashCommand", () => {
  it("blocks direct git commit commands", () => {
    expect(classifyBashCommand('git commit -m "feat: bad"')).toBe(
      "block-direct-commit",
    )
  })

  it("blocks git commit after global git flags", () => {
    expect(classifyBashCommand('git -C ../repo commit -m "feat: bad"')).toBe(
      "block-direct-commit",
    )
  })

  it("blocks git push commands", () => {
    expect(classifyBashCommand("git push --force-with-lease")).toBe(
      "block-push",
    )
  })

  it("blocks git push after global git flags", () => {
    expect(
      classifyBashCommand("git --git-dir=.git --work-tree=. push origin main"),
    ).toBe("block-push")
  })

  it("allows safe git inspection commands", () => {
    expect(classifyBashCommand("git status --short")).toBe("allow")
  })

  it("blocks quoted git command tokens", () => {
    expect(classifyBashCommand('"git" commit -m "feat: bad"')).toBe(
      "block-direct-commit",
    )
    expect(classifyBashCommand("'git' commit -m 'feat: bad'")).toBe(
      "block-direct-commit",
    )
  })

  it("blocks quoted subcommand tokens", () => {
    expect(classifyBashCommand('git "commit" -m "feat: bad"')).toBe(
      "block-direct-commit",
    )
    expect(classifyBashCommand("git 'commit' -m 'feat: bad'")).toBe(
      "block-direct-commit",
    )
    expect(classifyBashCommand('git "push" origin main')).toBe("block-push")
    expect(classifyBashCommand("git 'push' origin main")).toBe("block-push")
  })
})
