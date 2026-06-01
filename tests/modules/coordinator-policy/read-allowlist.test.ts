import { readFileSync } from "node:fs"
import { parseAllowedBashPrograms } from "@appverk/opencode-skill-utils"
import { describe, expect, it } from "vitest"
import {
  FALLBACK_ALLOWLIST,
  readCoordinatorBashAllowlist,
} from "../../../src/modules/coordinator-policy/read-allowlist.js"

/**
 * Programs the source-of-truth `src/agents/perun.md` frontmatter actually grants.
 * We re-derive this in-test from the real frontmatter line via `parseAllowedBashPrograms`
 * rather than hard-coding the expectation, so the assertions track the frontmatter
 * even if it gains/loses a `Bash(...)` entry — while the explicit `toContain`/`not.toContain`
 * checks below pin the security-relevant contract.
 */
const SRC_PERUN_PROGRAMS = parseAllowedBashPrograms(
  readFileSync("src/agents/perun.md", "utf8").match(/^allowed-tools:.*$/m)?.[0] ?? "",
)

describe("readCoordinatorBashAllowlist (happy path against real perun.md frontmatter)", () => {
  it("returns exactly the Bash(...) programs declared in perun.md frontmatter", () => {
    // The reader resolves `../../agents/perun.md` relative to import.meta.url, which at
    // runtime points at the BUILT dist/agents/perun.md. We assert against the programs
    // parsed from the SOURCE frontmatter instead of a literal path, so the test exercises
    // the real reader without being brittle to dist/src path resolution.
    const allowlist = readCoordinatorBashAllowlist()
    expect(allowlist).toEqual(SRC_PERUN_PROGRAMS)
  })

  it("grants the coordinator's own mkdir / ls / qa-preflight", () => {
    const allowlist = readCoordinatorBashAllowlist()
    expect(allowlist).toContain("mkdir")
    expect(allowlist).toContain("ls")
    expect(allowlist).toContain("./scripts/qa-preflight.sh")
  })

  it("does NOT grant git (it is absent from perun.md allowed-tools)", () => {
    // Regression guard: the gate keys off this list, so a silent `git` leak here would
    // let the coordinator run repo-mutating commands it must dispatch a specialist for.
    const allowlist = readCoordinatorBashAllowlist()
    expect(allowlist).not.toContain("git")
  })
})

describe("FALLBACK_ALLOWLIST sync with perun.md frontmatter", () => {
  it("mirrors exactly the Bash(...) programs in the real perun.md frontmatter", () => {
    // This is the genuine drift guard the read-allowlist.ts doc-comment now points at.
    // (The Task-7 coordinator-name-sync test only guards COORDINATOR_AGENT_NAME — it
    // never touched the allowlist, despite the old comment's claim.) If perun.md's
    // allowed-tools and FALLBACK_ALLOWLIST diverge, a packaging glitch would degrade
    // the fail-open gate to a stale allowlist, so assert they stay identical.
    expect(FALLBACK_ALLOWLIST).toEqual(SRC_PERUN_PROGRAMS)
  })
})
