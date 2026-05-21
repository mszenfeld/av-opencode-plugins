// src/index.ts
import { readFileSync as readFileSync2 } from "fs";
import path2 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/modules/prompt-builder.ts
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// src/modules/allowed-tools.ts
var SHARED_TOOLS = [
  "Read",
  "Write",
  "skill",
  "Bash(mkdir:*)",
  "Bash(command:*)",
  "Bash(echo:*)"
];
var FE_TOOLS = [
  "playwright_browser_navigate",
  "playwright_browser_click",
  "playwright_browser_fill_form",
  "playwright_browser_snapshot",
  "playwright_browser_take_screenshot",
  "playwright_browser_press_key",
  "playwright_browser_select_option",
  "playwright_browser_hover",
  "playwright_browser_wait_for",
  "playwright_browser_evaluate",
  "playwright_browser_console_messages",
  "playwright_browser_navigate_back",
  "playwright_browser_tabs",
  "playwright_browser_handle_dialog",
  "playwright_browser_resize",
  "playwright_browser_close",
  "playwright_browser_drag",
  "playwright_browser_type",
  "playwright_browser_file_upload",
  "playwright_browser_network_requests",
  "Bash(playwright:*)"
];
var BE_TOOLS = [
  "Bash(curl:*)",
  "Bash(httpie:*)",
  "Bash(http:*)",
  "Bash(psql:*)",
  "Bash(sqlite3:*)",
  "Bash(mysql:*)",
  "Bash(mongosh:*)",
  "Bash(redis-cli:*)",
  "Bash(jq:*)",
  "Bash(grep:*)",
  "Bash(cat:./*)",
  "Bash(head:./*)",
  "Bash(tail:./*)"
];
function toolsForVariant(stack) {
  const stackTools = stack === "fe" ? FE_TOOLS : BE_TOOLS;
  return Array.from(/* @__PURE__ */ new Set([...SHARED_TOOLS, ...stackTools]));
}

// src/modules/prompt-builder.ts
var moduleDir = path.dirname(fileURLToPath(import.meta.url));
function loadSection(name) {
  const candidates = [
    // (a) bundled into dist/index.js
    path.resolve(moduleDir, "modules/prompt-sections", name),
    // (b) standalone dist/modules/prompt-builder.js
    path.resolve(moduleDir, "prompt-sections", name),
    // (c) src/modules/prompt-builder.ts running unbundled
    path.resolve(moduleDir, "../prompt-sections", name),
    // (a-fallback) when bundle is at dist/index.js and src copy is desired
    path.resolve(moduleDir, "../src/modules/prompt-sections", name)
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`prompt-section asset not found: ${name}`);
}
var cachedCore;
var cachedOverlayFe;
var cachedOverlayBe;
function getCore() {
  cachedCore ??= loadSection("core.md");
  return cachedCore;
}
function getOverlay(stack) {
  if (stack === "fe") {
    cachedOverlayFe ??= loadSection("overlay-fe.md");
    return cachedOverlayFe;
  }
  cachedOverlayBe ??= loadSection("overlay-be.md");
  return cachedOverlayBe;
}
function buildQATesterAgent(stack) {
  const tools = toolsForVariant(stack).join(", ");
  const description = `QA tester \u2014 ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`;
  const frontmatter = [
    "---",
    `name: qa-tester-${stack}`,
    `description: ${description}`,
    "mode: subagent",
    `allowed-tools: ${tools}`,
    "---"
  ].join("\n");
  const body = `${getCore()}

${getOverlay(stack)}`;
  return { prompt: `${frontmatter}

${body}`, stack };
}

// src/index.ts
var moduleDir2 = path2.dirname(fileURLToPath2(import.meta.url));
function loadMarkdownFile(name) {
  const filePath = path2.resolve(moduleDir2, name);
  const baseDir = path2.resolve(moduleDir2, "..");
  if (!filePath.startsWith(baseDir)) {
    throw new Error("Invalid path: traversal detected");
  }
  return readFileSync2(filePath, "utf8");
}
function createLazyMarkdownLoader(name) {
  let cached;
  return () => {
    if (cached === void 0) cached = loadMarkdownFile(name);
    return cached;
  };
}
var VARIANTS = ["fe", "be"];
var COMMANDS = [
  {
    name: "create-qa-plan",
    description: "Analyze code changes (PR, branch, commits) and generate a detailed QA test plan with FE and BE scenarios, edge cases, and tool detection.",
    path: "commands/create-qa-plan.md"
  },
  {
    name: "run-qa",
    description: "Execute a QA test plan \u2014 Perun parses scenarios, dispatches one qa-tester variant per scenario through dispatch_parallel.",
    path: "commands/run-qa.md"
  }
];
var AppVerkQAPlugin = async () => ({
  config: async (config) => {
    config.agent ??= {};
    for (const stack of VARIANTS) {
      let cached;
      config.agent[`qa-tester-${stack}`] = {
        description: `QA tester \u2014 ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`,
        get prompt() {
          cached ??= buildQATesterAgent(stack).prompt;
          return cached;
        },
        mode: "subagent"
      };
    }
    config.command ??= {};
    for (const c of COMMANDS) {
      const getTemplate = createLazyMarkdownLoader(c.path);
      config.command[c.name] = {
        description: c.description,
        get template() {
          return getTemplate();
        }
      };
    }
  }
});
var index_default = AppVerkQAPlugin;
export {
  AppVerkQAPlugin,
  BE_TOOLS,
  FE_TOOLS,
  SHARED_TOOLS,
  buildQATesterAgent,
  index_default as default,
  toolsForVariant
};
