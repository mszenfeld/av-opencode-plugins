import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)))

describe("commit build output", () => {
  it("ships the packaged commit markdown prompt and the lazy loader resolves it from dist", async () => {
    const promptPath = path.join(repoRoot, "dist/commands/commit.md")
    const builtPluginPath = path.join(repoRoot, "dist/modules/commit/index.js")

    expect(existsSync(promptPath)).toBe(true)
    expect(existsSync(builtPluginPath)).toBe(true)

    const promptContent = readFileSync(promptPath, "utf8")
    expect(promptContent).toContain("## Context")
    expect(promptContent).toContain("Use the `av_commit` tool to create the commit.")

    const { AppVerkCommitPlugin } = await import(builtPluginPath)
    const plugin = await AppVerkCommitPlugin({} as never)
    const config = {} as {
      command?: Record<string, { description?: string; template: string }>
    }

    await plugin.config?.(config as never)

    expect(config.command?.commit?.template).toBe(promptContent)
  })
})
