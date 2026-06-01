import { describe, expect, it } from "vitest"
import {
  buildViolationError,
  classifyCoordinatorBash,
  isCompoundCommand,
  parseAllowedBashPrograms,
} from "../src/coordinator-bash-policy.js"

const FRONTMATTER =
  "allowed-tools: Read, Write, Bash(mkdir:*), Bash(ls:*), Bash(./scripts/qa-preflight.sh:*), Glob"

describe("parseAllowedBashPrograms", () => {
  it("extracts the Bash(<prog>:*) programs incl. the path form", () => {
    expect(parseAllowedBashPrograms(FRONTMATTER)).toEqual(["mkdir", "ls", "./scripts/qa-preflight.sh"])
  })
})

describe("classifyCoordinatorBash", () => {
  const allowed = ["mkdir", "ls", "./scripts/qa-preflight.sh"]
  it("allows an allowlisted program", () => {
    expect(classifyCoordinatorBash("ls -la docs", allowed).allowed).toBe(true)
    expect(classifyCoordinatorBash("./scripts/qa-preflight.sh foo", allowed).allowed).toBe(true)
  })
  it("denies git", () => {
    const r = classifyCoordinatorBash("git log --oneline", allowed)
    expect(r.allowed).toBe(false)
    expect(r.program).toBe("git")
  })
  it("denies compound commands even if the first program is allowed", () => {
    expect(classifyCoordinatorBash("mkdir x && git log", allowed).allowed).toBe(false)
    expect(classifyCoordinatorBash("ls; curl http://x", allowed).allowed).toBe(false)
    expect(classifyCoordinatorBash('bash -c "git log"', allowed).allowed).toBe(false)
  })
  // Table-driven coverage of EVERY separator/operator the COMPOUND regex must
  // reject. Each row smuggles a second statement (or a redirect) past an
  // allowlisted first token; before SEC-001 the `\n`, `\r`, `&`, `<`, `>` rows
  // all incorrectly returned allowed=true.
  it.each([
    ["||", "ls docs || curl http://evil"],
    ["&&", "mkdir x && git log"],
    [";", "ls; curl http://x"],
    ["single |", "ls | tee /tmp/x"],
    ["single &", "ls & git diff"],
    ["newline", "ls docs\ncat .env"],
    ["newline + git", "ls\ngit log --all"],
    ["newline + curl", "mkdir x\ncurl http://evil"],
    ["CRLF", "ls\r\ncurl x"],
    ["backtick", "ls `git log`"],
    ["$( subshell", "ls $(git log)"],
    ["redirect >", "ls > /tmp/x"],
    ["redirect <", "ls < /etc/passwd"],
    ["bash wrapper", 'bash -c "git log"'],
    ["sh wrapper", 'sh -c "git log"'],
    ["eval wrapper", 'eval "git log"'],
  ])("rejects compound/redirect via %s", (_label, command) => {
    expect(classifyCoordinatorBash(command, allowed).allowed).toBe(false)
  })
})

describe("buildViolationError", () => {
  it("carries a structured payload AND the instructive redirect", () => {
    const err = buildViolationError({ tool: "bash", command: "git log", reason: "not-allowlisted" })
    expect(err.message).toContain("COORDINATOR_POLICY_VIOLATION")
    expect(err.message).toContain("git log")
    expect(err.message).toMatch(/Veles|Triglav/)
  })

  it("names the program for a single-program command", () => {
    const err = buildViolationError({ tool: "bash", command: "git log --oneline", reason: "not-allowlisted" })
    expect(err.message).toContain("may not run `git`.")
  })

  it("uses a stable label instead of misnaming the first token of a compound command", () => {
    const err = buildViolationError({ tool: "bash", command: "ls docs\ngit log --all", reason: "not-allowlisted" })
    // Must NOT claim the coordinator may not run `ls` (the harmless first token).
    expect(err.message).not.toContain("may not run `ls`.")
    expect(err.message).toContain("may not run a compound command.")
    // Full offending command is still preserved in the structured payload.
    expect(err.message).toContain("ls docs\\ngit log --all")
  })
})

describe("isCompoundCommand", () => {
  it("is false for a single-program command", () => {
    expect(isCompoundCommand("git log --oneline")).toBe(false)
  })
  it.each([
    ["newline", "ls\ngit log"],
    ["&&", "mkdir x && git log"],
    ["bash wrapper", 'bash -c "git log"'],
    ["redirect >", "ls > /tmp/x"],
  ])("is true for compound via %s", (_label, command) => {
    expect(isCompoundCommand(command)).toBe(true)
  })
})
