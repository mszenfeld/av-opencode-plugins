import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FALLBACK_ALLOWLIST,
  readCoordinatorBashAllowlist,
} from "../../../src/modules/coordinator-policy/read-allowlist.js"

// Mock node:fs so we can drive the two fallback branches deterministically without
// touching the real on-disk perun.md (which the happy-path test covers separately).
vi.mock("node:fs", () => ({ readFileSync: vi.fn() }))

const readFileSyncMock = vi.mocked(readFileSync)

describe("readCoordinatorBashAllowlist fallback branches", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    readFileSyncMock.mockReset()
  })

  it("returns FALLBACK_ALLOWLIST when perun.md cannot be read (catch branch)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    readFileSyncMock.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory")
    })

    expect(readCoordinatorBashAllowlist()).toEqual(FALLBACK_ALLOWLIST)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain("could not read perun.md allowlist")
  })

  it("returns FALLBACK_ALLOWLIST when frontmatter yields no Bash(...) programs (empty-parse branch)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    // Frontmatter present but with zero Bash(...) entries → parseAllowedBashPrograms → [].
    readFileSyncMock.mockReturnValue("allowed-tools: Read, Write, Edit, Glob, Grep\n")

    expect(readCoordinatorBashAllowlist()).toEqual(FALLBACK_ALLOWLIST)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain("yielded no Bash(...) programs")
  })

  it("returns parsed programs (not the fallback) when frontmatter has Bash(...) entries", () => {
    readFileSyncMock.mockReturnValue("allowed-tools: Read, Bash(echo:*), Bash(pwd:*)\n")

    expect(readCoordinatorBashAllowlist()).toEqual(["echo", "pwd"])
  })
})
