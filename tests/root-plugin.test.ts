import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
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

function deriveExpectedFilesFromPackageJson(
  packageJson: { files?: string[] },
  rootDir: string,
): string[] {
  const SKIP_FILES = new Set([".DS_Store", "Thumbs.db"])
  const SKIP_EXTENSIONS = [".tsbuildinfo"]
  const isSkippable = (name: string): boolean =>
    name.startsWith(".") ||
    SKIP_FILES.has(name) ||
    SKIP_EXTENSIONS.some((ext) => name.endsWith(ext))

  const entries = packageJson.files ?? []
  const result: string[] = []

  for (const entry of entries) {
    // Assumption (verified): mszenfeld package.json `files` has no glob patterns
    if (entry.includes("*")) {
      throw new Error(`Glob in files array not supported: ${entry}`)
    }
    const absPath = path.join(rootDir, entry)
    if (!existsSync(absPath)) {
      throw new Error(`File or directory not found: ${absPath}`)
    }
    const stat = statSync(absPath)
    if (stat.isFile()) {
      const basename = path.basename(entry)
      if (!isSkippable(basename)) result.push(entry)
      continue
    }
    // Directory — recurse
    const dirEntries = readdirSync(absPath, { recursive: true, withFileTypes: true })
    for (const dirent of dirEntries) {
      if (dirent.isDirectory()) continue
      if (isSkippable(dirent.name)) continue
      const relativePath = path.relative(absPath, path.join(dirent.parentPath, dirent.name))
      result.push(path.posix.join(entry, relativePath.split(path.sep).join("/")))
    }
  }

  return result
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

  it("registers Perun coordinator agent and coordinator tools", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as {
      agent?: Record<string, { description?: string; prompt: string; mode?: string }>
    }

    await plugin.config?.(config as never)

    const perun = config.agent?.["Perun - Coordinator"]
    expect(perun?.description).toContain("Delegates work to specialists")
    expect(perun?.mode).toBe("primary")
    expect(perun?.prompt).toContain("Perun")
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
        "dist",
      ]),
    )

    const tmpDir = mkdtempSync(path.join(tmpdir(), "bun-pack-"))
    try {
      execFileSync("bun", ["pm", "pack", "--destination", tmpDir], {
        cwd: rootDirectory,
      })

      const tarball = readdirSync(tmpDir).find((entry) => entry.endsWith(".tgz"))
      if (!tarball) {
        throw new Error(`No .tgz file found in ${tmpDir}`)
      }

      const packedFiles = execFileSync("tar", ["-tzf", path.join(tmpDir, tarball)], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .map((entry) => entry.replace(/^package\//, ""))
        .filter((entry) => entry.length > 0)

      // Derive expected files from package.json `files` (ulepszenie #9):
      // any new path added to `files` is auto-asserted without test maintenance
      const expectedFiles = deriveExpectedFilesFromPackageJson(packageJson, rootDirectory)
      expect(packedFiles).toEqual(expect.arrayContaining(expectedFiles))
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("registers the Pantheon session-notification event hook", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    expect(typeof plugin.event).toBe("function")
    // Smoke: feed a synthetic event; must not throw.
    const eventHandler = plugin.event
    if (typeof eventHandler !== "function") throw new Error("expected event handler")
    await expect(
      eventHandler({ event: { type: "session.idle", properties: { sessionID: "ses_unknown" } } } as never),
    ).resolves.toBeUndefined()
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
