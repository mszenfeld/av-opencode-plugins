import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { AppVerkCommitPlugin } from "../packages/commit/dist/index.js"
import { AppVerkPythonDeveloperPlugin } from "../packages/python-developer/dist/index.js"
import { AppVerkCodeReviewPlugin } from "../packages/code-review/dist/index.js"
import { AppVerkFrontendDeveloperPlugin } from "../packages/frontend-developer/dist/index.js"
import { AppVerkSkillRegistryPlugin } from "../packages/skill-registry/dist/index.js"
import { AppVerkQAPlugin } from "../packages/qa/dist/index.js"
import { AppVerkSwiftDeveloperPlugin } from "../packages/swift-developer/dist/index.js"
import { AppVerkCoordinatorPlugin } from "../packages/coordinator/dist/index.js"
import { AppVerkPantheonPlugin } from "./hooks/session-notification/plugin.js"
type PluginHooks = Awaited<ReturnType<Plugin>>
type HookKey = Exclude<keyof PluginHooks, "config" | "tool">
type MergedHook = (...args: unknown[]) => Promise<void>
type ToolExecuteBefore = NonNullable<Hooks["tool.execute.before"]>
type ToolExecuteAfter = NonNullable<Hooks["tool.execute.after"]>


const defaultPluginFactories: Plugin[] = [
  AppVerkCommitPlugin,
  AppVerkPythonDeveloperPlugin,
  AppVerkCodeReviewPlugin,
  AppVerkFrontendDeveloperPlugin,
  AppVerkSkillRegistryPlugin,
  AppVerkQAPlugin,
  AppVerkSwiftDeveloperPlugin,
  AppVerkCoordinatorPlugin,
  AppVerkPantheonPlugin,
]

function mergeTools(plugins: PluginHooks[]): PluginHooks["tool"] {
  const merged: NonNullable<PluginHooks["tool"]> = {}

  for (const plugin of plugins) {
    for (const [name, definition] of Object.entries(plugin.tool ?? {})) {
      if (merged[name]) {
        throw new Error(`Duplicate OpenCode tool registered: ${name}`)
      }

      merged[name] = definition
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function mergeToolExecuteBefore(plugins: PluginHooks[]) {
  const hooks = plugins
    .map((plugin) => plugin["tool.execute.before"])
    .filter((hook): hook is ToolExecuteBefore => Boolean(hook))

  if (hooks.length === 0) {
    return undefined
  }

  return async (...args: Parameters<ToolExecuteBefore>) => {
    for (const hook of hooks) {
      await hook(...args)
    }
  }
}

function mergeToolExecuteAfter(plugins: PluginHooks[]) {
  const hooks = plugins
    .map((plugin) => plugin["tool.execute.after"])
    .filter((hook): hook is ToolExecuteAfter => Boolean(hook))

  if (hooks.length === 0) {
    return undefined
  }

  return async (...args: Parameters<ToolExecuteAfter>) => {
    for (const hook of hooks) {
      await hook(...args)
    }
  }
}

function mergeHook<K extends HookKey>(plugins: PluginHooks[], key: K) {
  if (key === "tool.execute.before") {
    return mergeToolExecuteBefore(plugins) as PluginHooks[K]
  }

  if (key === "tool.execute.after") {
    return mergeToolExecuteAfter(plugins) as PluginHooks[K]
  }

  const hooks = plugins
    .map((plugin) => plugin[key] as unknown)
    .filter((hook): hook is MergedHook => typeof hook === "function")

  if (hooks.length === 0) {
    return undefined
  }

  return async (...args: Parameters<MergedHook>) => {
    for (const hook of hooks) {
      await hook(...args)
    }
  }
}

function isHookKey(key: keyof PluginHooks, value: PluginHooks[keyof PluginHooks]): key is HookKey {
  return key !== "config" && key !== "tool" && typeof value === "function"
}

function assignHook<K extends HookKey>(
  merged: Partial<PluginHooks>,
  key: K,
  hook: NonNullable<PluginHooks[K]>,
): void {
  merged[key] = hook
}

export function createAppVerkPlugins(pluginFactories: Plugin[] = defaultPluginFactories): Plugin {
  return async (context) => {
    const plugins = await Promise.all(
      pluginFactories.map((factory) => factory(context)),
    )

    const merged: Partial<PluginHooks> = {
      tool: mergeTools(plugins),
    }

    const hookKeys = new Set<HookKey>()

    for (const plugin of plugins) {
      for (const key of Object.keys(plugin) as Array<keyof PluginHooks>) {
        if (isHookKey(key, plugin[key])) {
          hookKeys.add(key)
        }
      }
    }

    if (plugins.some((plugin) => plugin.config)) {
      merged.config = async (config) => {
        for (const plugin of plugins) {
          await plugin.config?.(config)
        }
      }
    }

    for (const key of hookKeys) {
      const hook = mergeHook(plugins, key)

      if (hook) {
        assignHook(merged, key, hook)
      }
    }

    return merged as PluginHooks
  }
}

export const AppVerkPlugins = createAppVerkPlugins()

export default AppVerkPlugins
