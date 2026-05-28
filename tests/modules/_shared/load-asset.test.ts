import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { loadModuleAsset } from "../../../src/modules/_shared/load-asset.js"

describe("loadModuleAsset", () => {
  let workingDirectory: string
  let callerUrl: string

  beforeEach(() => {
    workingDirectory = mkdtempSync(path.join(tmpdir(), "load-asset-"))
    // Simulate a compiled caller module living inside the temp directory.
    callerUrl = pathToFileURL(path.join(workingDirectory, "caller.js")).href
  })

  afterEach(() => {
    rmSync(workingDirectory, { recursive: true, force: true })
  })

  it("returns the file contents for a successful read", () => {
    writeFileSync(path.join(workingDirectory, "asset.md"), "hello world", "utf8")

    expect(loadModuleAsset(callerUrl, "asset.md")).toBe("hello world")
  })

  it("does not hit the filesystem again for the same resolved path", () => {
    // Unique name ensures a fresh, uncached entry in the process-lifetime cache.
    const assetName = `cached-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
    writeFileSync(path.join(workingDirectory, assetName), "original", "utf8")

    expect(loadModuleAsset(callerUrl, assetName)).toBe("original")

    // Mutate the file on disk: because the first read is cached for the
    // resolved path, a second call must return the original cached contents
    // and must NOT re-read the mutated file.
    writeFileSync(path.join(workingDirectory, assetName), "mutated", "utf8")

    expect(loadModuleAsset(callerUrl, assetName)).toBe("original")
  })

  it("shares a cache entry across callers resolving to the same absolute path", () => {
    const assetName = `shared-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
    writeFileSync(path.join(workingDirectory, assetName), "shared", "utf8")

    // First caller populates the cache for the resolved absolute path.
    expect(loadModuleAsset(callerUrl, assetName)).toBe("shared")

    // Mutate on disk, then read via a different caller whose relative path
    // resolves to the SAME absolute file (through "..") — it must hit the
    // shared cache entry and return the original contents.
    writeFileSync(path.join(workingDirectory, assetName), "mutated", "utf8")

    const nestedDir = path.join(workingDirectory, "nested")
    mkdirSync(nestedDir)
    const nestedCallerUrl = pathToFileURL(path.join(nestedDir, "caller.js")).href

    expect(loadModuleAsset(nestedCallerUrl, path.join("..", assetName))).toBe("shared")
  })

  it("throws on a read failure and does not cache the failure", () => {
    const assetName = `missing-${Date.now()}.md`

    expect(() => loadModuleAsset(callerUrl, assetName)).toThrow()

    // Failures are not cached: a subsequent successful setup then read works.
    writeFileSync(path.join(workingDirectory, assetName), "recovered", "utf8")

    expect(loadModuleAsset(callerUrl, assetName)).toBe("recovered")
  })
})
