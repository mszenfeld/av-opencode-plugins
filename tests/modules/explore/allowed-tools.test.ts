import { describe, expect, it } from "vitest"
import { TRIGLAV_TOOLS } from "../../../src/modules/explore/allowed-tools.js"

const WRITE_VERB = /create|replace|insert|rename|delete|write|edit|memory|execute_shell|activate|onboarding/i

describe("TRIGLAV_TOOLS", () => {
  it("includes the read-only serena LSP subset", () => {
    for (const t of [
      "serena_find_symbol",
      "serena_find_referencing_symbols",
      "serena_get_symbols_overview",
      "serena_search_for_pattern",
      "serena_find_file",
      "serena_list_dir",
      "serena_read_file",
    ]) {
      expect(TRIGLAV_TOOLS).toContain(t)
    }
  })

  it("includes structured fallback search tools", () => {
    expect(TRIGLAV_TOOLS).toEqual(expect.arrayContaining(["Read", "Glob", "Grep"]))
  })

  it("contains no structured write/mutation tool (deny-by-pattern)", () => {
    const offenders = TRIGLAV_TOOLS.filter((t) => WRITE_VERB.test(t))
    expect(offenders).toEqual([])
  })

  it("excludes Write, Edit, dispatch_parallel, and Task", () => {
    for (const t of ["Write", "Edit", "dispatch_parallel", "Task"]) {
      expect(TRIGLAV_TOOLS).not.toContain(t)
    }
  })
})
