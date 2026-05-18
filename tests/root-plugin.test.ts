import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import type { Hooks } from "@opencode-ai/plugin"

const rootDirectory = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const packageJsonPath = path.join(rootDirectory, "package.json")

function readRootPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    main: string
    types?: string
    files?: string[]
    dependencies?: Record<string, string>
  }
}

async function loadRootModule() {
  const packageJson = readRootPackageJson()
  const entrypointPath = path.resolve(rootDirectory, packageJson.main)

  expect(existsSync(entrypointPath)).toBe(true)

  return import(pathToFileURL(entrypointPath).href)
}

type ShellEnvHook = NonNullable<Hooks["shell.env"]>
type ChatHeadersHook = NonNullable<Hooks["chat.headers"]>

describe("AppVerkPlugins", () => {
  it("loads through the package main entrypoint and registers the commit command", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as {
      command?: Record<string, { description?: string; template: string }>
    }

    await plugin.config?.(config as never)

    expect(config.command?.commit?.description).toBe(
      "Create a git commit with the AppVerk commit workflow",
    )
    expect(config.command?.commit?.template).toContain("## Context")
    expect(config.command?.commit?.template).toContain("Use the `av_commit` tool")
    expect(plugin.tool?.av_commit).toBeDefined()
  })

  it("registers the /swift command and swift-developer agent", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as {
      command?: Record<string, { description?: string; template: string; agent?: string }>
      agent?: Record<string, { description?: string; prompt: string; mode?: string }>
    }

    await plugin.config?.(config as never)

    expect(config.command?.swift?.description).toContain("Swift")
    expect(config.command?.swift?.agent).toBe("swift-developer")
    expect(config.agent?.["swift-developer"]?.description).toContain("Swift")
    expect(config.agent?.["swift-developer"]?.mode).toBe("primary")
    expect(plugin.tool?.load_appverk_skill).toBeDefined()
  })

  it("registers @perun agent and coordinator tools", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as {
      agent?: Record<string, { description?: string; prompt: string; mode?: string }>
    }

    await plugin.config?.(config as never)

    expect(config.agent?.["perun"]?.description).toContain("Pantheon")
    expect(config.agent?.["perun"]?.mode).toBe("primary")
    expect(config.agent?.["perun"]?.prompt).toContain("Perun")
    expect(plugin.tool?.dispatch_parallel).toBeDefined()
    expect(plugin.tool?.assign_issue_ids).toBeDefined()
  })

  it("registers the /frontend command and frontend-developer agent", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as {
      command?: Record<string, { description?: string; template: string; agent?: string }>
      agent?: Record<string, { description?: string; prompt: string; mode?: string }>
    }

    await plugin.config?.(config as never)

    expect(config.command?.frontend?.description).toContain("TypeScript")
    expect(config.command?.frontend?.agent).toBe("frontend-developer")
    expect(config.agent?.["frontend-developer"]?.description).toContain("TypeScript")
    expect(config.agent?.["frontend-developer"]?.mode).toBe("primary")
    expect(plugin.tool?.load_appverk_skill).toBeDefined()
  })

  it("packages a self-contained git-install surface", () => {
    const packageJson = readRootPackageJson()

    expect(packageJson.dependencies).toMatchObject({
      "@opencode-ai/plugin": expect.any(String),
    })
    expect(packageJson.dependencies).not.toHaveProperty(
      "@appverk/opencode-commit",
    )
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "src/index.js",
        "src/index.d.ts",
        "packages/commit/dist",
      ]),
    )

    const packResult = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: rootDirectory,
        encoding: "utf8",
      }),
    ) as Array<{ files: Array<{ path: string }> }>

    const packedFiles = packResult[0]?.files.map((file) => file.path) ?? []

    expect(packedFiles).toEqual(
      expect.arrayContaining([
        "package.json",
        "src/index.js",
        "src/index.d.ts",
        "packages/commit/dist/index.js",
        "packages/commit/dist/index.d.ts",
        "packages/commit/dist/commands/commit.md",
        "packages/frontend-developer/dist/index.js",
        "packages/frontend-developer/dist/index.d.ts",
        "packages/frontend-developer/dist/commands/frontend.md",
        "packages/python-developer/dist/index.js",
        "packages/python-developer/dist/index.d.ts",
        "packages/python-developer/dist/commands/python.md",
        "packages/code-review/dist/index.js",
        "packages/code-review/dist/index.d.ts",
        "packages/code-review/dist/commands/review.md",
        "packages/skill-registry/dist/index.js",
        "packages/skill-registry/dist/index.d.ts",
        "packages/swift-developer/dist/index.js",
        "packages/swift-developer/dist/index.d.ts",
        "packages/swift-developer/dist/commands/swift.md",
        "packages/swift-developer/dist/agent-prompt.md",
        "packages/swift-developer/dist/skills/swift-coding-standards/SKILL.md",
        "packages/coordinator/dist/index.js",
        "packages/coordinator/dist/index.d.ts",
        "packages/coordinator/dist/agents/perun.md",
      ]),
    )
  })

  it("injects skill activation rules via system prompt transform", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)

    const output = { system: [] as string[] }
    await plugin["experimental.chat.system.transform"]?.(
      { model: {} as never } as never,
      output as never,
    )

    expect(output.system.length).toBeGreaterThan(0)
    expect(output.system[0]).toContain("AppVerk Skills")
    expect(output.system[0]).toContain("load_appverk_skill")
  })

  it("preserves commit bash protections through the aggregated hook", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)

    await expect(
      plugin["tool.execute.before"]?.(
        { tool: "bash", args: { command: 'git commit -m "feat: bypass"' } } as never,
        { args: { command: 'git commit -m "feat: bypass"' } } as never,
      ),
    ).rejects.toThrow(/use \/commit/i)
  })

  it("composes non-tool hook keys generically", async () => {
    const { createAppVerkPlugins } = await loadRootModule()
    const plugin = createAppVerkPlugins([
      async () => ({
        "shell.env": async (
          _input: Parameters<ShellEnvHook>[0],
          output: Parameters<ShellEnvHook>[1],
        ) => {
          output.env.FIRST = "1"
        },
      }),
      async () => ({
        "shell.env": async (
          _input: Parameters<ShellEnvHook>[0],
          output: Parameters<ShellEnvHook>[1],
        ) => {
          output.env.SECOND = "2"
        },
        "chat.headers": async (
          _input: Parameters<ChatHeadersHook>[0],
          output: Parameters<ChatHeadersHook>[1],
        ) => {
          output.headers.authorization = "Bearer test"
        },
      }),
    ])

    const hooks = await plugin({} as never)
    const envOutput = { env: {} as Record<string, string> }
    const headersOutput = { headers: {} as Record<string, string> }

    await hooks["shell.env"]?.({ cwd: rootDirectory } as never, envOutput as never)
    await hooks["chat.headers"]?.(
      {
        sessionID: "session",
        agent: "agent",
        model: {} as never,
        provider: {} as never,
        message: {} as never,
      } as never,
      headersOutput as never,
    )

    expect(envOutput.env).toEqual({ FIRST: "1", SECOND: "2" })
    expect(headersOutput.headers).toEqual({ authorization: "Bearer test" })
  })
})
