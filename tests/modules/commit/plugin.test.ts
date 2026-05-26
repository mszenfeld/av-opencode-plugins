import { describe, expect, it } from "vitest"
import { AppVerkCommitPlugin } from "../../../src/modules/commit/index.js"

describe("AppVerkCommitPlugin runtime", () => {
  it("registers the /commit command in config", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const config = {} as {
      command?: Record<string, { description?: string; template: string }>
    }

    await plugin.config?.(config as never)

    expect(config.command?.commit?.description).toBe(
      "Create a git commit with the AppVerk commit workflow",
    )
    expect(config.command?.commit?.template).toContain("## Context")
    expect(config.command?.commit?.template).toContain("## Your Task")
    expect(config.command?.commit?.template).toContain("## Rules")
    expect(config.command?.commit?.template).toContain("Refs: <task-id>")
    expect(config.command?.commit?.template).toContain(
      "Use the `av_commit` tool to create the commit.",
    )
    expect(config.command?.commit?.template).toContain(
      "NEVER include Co-Authored-By",
    )
    expect(config.command?.commit?.template).not.toContain("AV_COMMIT_SKILL=1")
  })

  it("overwrites an existing /commit command definition", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const config = {
      command: {
        commit: {
          description: "Custom commit command",
          template: "custom template",
        },
      },
    }

    await plugin.config?.(config as never)

    expect(config.command.commit.description).toBe(
      "Create a git commit with the AppVerk commit workflow",
    )
    expect(config.command.commit.template).toContain(
      "Use the `av_commit` tool to create the commit.",
    )
  })

  it("registers the av_commit tool", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)

    expect(plugin.tool?.av_commit).toBeDefined()
  })

  it("blocks direct git commit bash commands", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)

    await expect(
      plugin["tool.execute.before"]?.(
        { tool: "bash", args: { command: 'git commit -m "feat: bypass"' } } as never,
        { args: { command: 'git commit -m "feat: bypass"' } } as never,
      ),
    ).rejects.toThrow(/use \/commit/i)
  })

  it("blocks git push bash commands", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)

    await expect(
      plugin["tool.execute.before"]?.(
        { tool: "bash", args: { command: "git push origin main" } } as never,
        { args: { command: "git push origin main" } } as never,
      ),
    ).rejects.toThrow(/git push is blocked/i)
  })
})
