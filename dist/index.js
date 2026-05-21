import { AppVerkCommitPlugin } from "./modules/commit/index.js";
import { AppVerkPythonDeveloperPlugin } from "../packages/python-developer/dist/index.js";
import { AppVerkCodeReviewPlugin } from "../packages/code-review/dist/index.js";
import { AppVerkFrontendDeveloperPlugin } from "../packages/frontend-developer/dist/index.js";
import { AppVerkSkillRegistryPlugin } from "../packages/skill-registry/dist/index.js";
import { AppVerkQAPlugin } from "./modules/qa/index.js";
import { AppVerkSwiftDeveloperPlugin } from "../packages/swift-developer/dist/index.js";
import { AppVerkCoordinatorPlugin } from "./modules/coordinator/index.js";
import { AppVerkPantheonPlugin } from "./hooks/session-notification/plugin.js";
const defaultPluginFactories = [
  AppVerkCommitPlugin,
  AppVerkPythonDeveloperPlugin,
  AppVerkCodeReviewPlugin,
  AppVerkFrontendDeveloperPlugin,
  AppVerkSkillRegistryPlugin,
  AppVerkQAPlugin,
  AppVerkSwiftDeveloperPlugin,
  AppVerkCoordinatorPlugin,
  AppVerkPantheonPlugin
];
function mergeTools(plugins) {
  const merged = {};
  for (const plugin of plugins) {
    for (const [name, definition] of Object.entries(plugin.tool ?? {})) {
      if (merged[name]) {
        throw new Error(`Duplicate OpenCode tool registered: ${name}`);
      }
      merged[name] = definition;
    }
  }
  return Object.keys(merged).length > 0 ? merged : void 0;
}
function mergeToolExecuteBefore(plugins) {
  const hooks = plugins.map((plugin) => plugin["tool.execute.before"]).filter((hook) => Boolean(hook));
  if (hooks.length === 0) {
    return void 0;
  }
  return async (...args) => {
    for (const hook of hooks) {
      await hook(...args);
    }
  };
}
function mergeToolExecuteAfter(plugins) {
  const hooks = plugins.map((plugin) => plugin["tool.execute.after"]).filter((hook) => Boolean(hook));
  if (hooks.length === 0) {
    return void 0;
  }
  return async (...args) => {
    for (const hook of hooks) {
      await hook(...args);
    }
  };
}
function mergeHook(plugins, key) {
  if (key === "tool.execute.before") {
    return mergeToolExecuteBefore(plugins);
  }
  if (key === "tool.execute.after") {
    return mergeToolExecuteAfter(plugins);
  }
  const hooks = plugins.map((plugin) => plugin[key]).filter((hook) => typeof hook === "function");
  if (hooks.length === 0) {
    return void 0;
  }
  return async (...args) => {
    for (const hook of hooks) {
      await hook(...args);
    }
  };
}
function isHookKey(key, value) {
  return key !== "config" && key !== "tool" && typeof value === "function";
}
function assignHook(merged, key, hook) {
  merged[key] = hook;
}
function createAppVerkPlugins(pluginFactories = defaultPluginFactories) {
  return async (context) => {
    const plugins = await Promise.all(
      pluginFactories.map((factory) => factory(context))
    );
    const merged = {
      tool: mergeTools(plugins)
    };
    const hookKeys = /* @__PURE__ */ new Set();
    for (const plugin of plugins) {
      for (const key of Object.keys(plugin)) {
        if (isHookKey(key, plugin[key])) {
          hookKeys.add(key);
        }
      }
    }
    if (plugins.some((plugin) => plugin.config)) {
      merged.config = async (config) => {
        for (const plugin of plugins) {
          await plugin.config?.(config);
        }
      };
    }
    for (const key of hookKeys) {
      const hook = mergeHook(plugins, key);
      if (hook) {
        assignHook(merged, key, hook);
      }
    }
    return merged;
  };
}
const AppVerkPlugins = createAppVerkPlugins();
var index_default = AppVerkPlugins;
export {
  AppVerkPlugins,
  createAppVerkPlugins,
  index_default as default
};
