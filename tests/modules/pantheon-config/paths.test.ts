import { describe, expect, it } from "vitest"
import path from "node:path"
import {
  userGlobalPath,
  walkUpProjectPaths,
} from "../../../src/modules/pantheon-config/paths.js"

describe("userGlobalPath", () => {
  it("returns ~/.config/opencode/pantheon.json under the given homedir", () => {
    expect(userGlobalPath("/Users/alice")).toBe(
      path.join("/Users/alice", ".config", "opencode", "pantheon.json"),
    )
  })
})

describe("walkUpProjectPaths", () => {
  it("returns closest-first ordering from cwd up to homedir", () => {
    const result = walkUpProjectPaths("/Users/alice/work/repo/sub", "/Users/alice")
    expect(result).toEqual([
      path.join("/Users/alice/work/repo/sub", ".opencode", "pantheon.json"),
      path.join("/Users/alice/work/repo", ".opencode", "pantheon.json"),
      path.join("/Users/alice/work", ".opencode", "pantheon.json"),
      path.join("/Users/alice", ".opencode", "pantheon.json"),
    ])
  })

  it("stops at homedir even if cwd === homedir", () => {
    const result = walkUpProjectPaths("/Users/alice", "/Users/alice")
    expect(result).toEqual([
      path.join("/Users/alice", ".opencode", "pantheon.json"),
    ])
  })

  it("walks to filesystem root when cwd is outside homedir", () => {
    const result = walkUpProjectPaths("/tmp/work/repo", "/Users/alice")
    // walk continues until dirname loop detects root (dirname(x) === x)
    expect(result[0]).toBe(path.join("/tmp/work/repo", ".opencode", "pantheon.json"))
    expect(result[result.length - 1]).toBe(path.join("/", ".opencode", "pantheon.json"))
  })

  it("resolves a relative cwd against process.cwd()", () => {
    const result = walkUpProjectPaths(".", "/Users/alice")
    // first entry must be absolute and end with /.opencode/pantheon.json
    expect(path.isAbsolute(result[0]!)).toBe(true)
    expect(result[0]!.endsWith(path.join(".opencode", "pantheon.json"))).toBe(true)
  })
})
