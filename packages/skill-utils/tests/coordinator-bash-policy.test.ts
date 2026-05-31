import { describe, expect, it } from "vitest"
import {
  buildViolationError,
  classifyCoordinatorBash,
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
})

describe("buildViolationError", () => {
  it("carries a structured payload AND the instructive redirect", () => {
    const err = buildViolationError({ tool: "bash", command: "git log", reason: "not-allowlisted" })
    expect(err.message).toContain("COORDINATOR_POLICY_VIOLATION")
    expect(err.message).toContain("git log")
    expect(err.message).toMatch(/Veles|Triglav/)
  })
})
