// src/index.ts
import path2 from "path";
import { fileURLToPath } from "url";
import { tool } from "@opencode-ai/plugin";
import { COORDINATOR_AGENT_NAME, getSessionAgent } from "@appverk/opencode-skill-utils";

// src/skill-catalog.ts
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
function parseSkillFrontmatter(content, fileName) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return null;
  }
  const raw = frontmatterMatch[1] ?? "";
  if (!raw) {
    return null;
  }
  const lines = raw.split(/\r?\n/);
  const fields = {};
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  if (!fields.name) {
    throw new Error(`Skill file ${fileName} is missing required 'name' in frontmatter`);
  }
  const allowedTools = fields["allowed-tools"] ? fields["allowed-tools"].split(",").map((t) => t.trim()).filter(Boolean) : void 0;
  return {
    name: fields.name,
    description: fields.description || "",
    activation: fields.activation || "Load when relevant to the task",
    filePath: fileName,
    allowedTools
  };
}
function buildSkillCatalog(directories) {
  const catalog = /* @__PURE__ */ new Map();
  for (const dir of directories) {
    if (!existsSync(dir)) {
      continue;
    }
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillFilePath = path.join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillFilePath)) {
        continue;
      }
      const content = readFileSync(skillFilePath, "utf8");
      const parsed = parseSkillFrontmatter(content, skillFilePath);
      if (!parsed) {
        continue;
      }
      if (catalog.has(parsed.name)) {
        throw new Error(
          `Duplicate skill name "${parsed.name}" found in ${skillFilePath}. Already defined in ${catalog.get(parsed.name).filePath}.`
        );
      }
      catalog.set(parsed.name, parsed);
    }
  }
  return catalog;
}

// src/load-skill.ts
import { readFileSync as readFileSync2 } from "fs";
function createSkillLoader(catalog) {
  const cache = /* @__PURE__ */ new Map();
  const availableNames = Array.from(catalog.keys()).sort();
  return function loadSkill(name) {
    const entry = catalog.get(name);
    if (!entry) {
      throw new Error(
        `AppVerk skill not found: "${name}". Available skills: ${availableNames.join(", ")}`
      );
    }
    if (cache.has(name)) {
      return cache.get(name);
    }
    const content = readFileSync2(entry.filePath, "utf8");
    cache.set(name, content);
    return content;
  };
}

// src/prompt-injector.ts
function generateActivationRules(catalog) {
  const entries = Array.from(catalog.values()).sort((a, b) => a.name.localeCompare(b.name));
  const rows = entries.map((skill) => `| \`${skill.name}\` | ${skill.activation} |`).join("\n");
  return `## AppVerk Skills \u2014 Mandatory Activation Rules

You have access to the \`load_appverk_skill(name)\` tool. Load skills BEFORE starting work. Do not guess \u2014 follow the rules below.

### Universal Rules (all tasks)
| When you are... | You MUST load... |
|---|---|
| Writing, modifying, or reviewing Python code | \`python-coding-standards\` |
| Writing, modifying, or reviewing TypeScript/React code | \`frontend-coding-standards\` |
| Writing tests, fixing bugs, refactoring Python code | \`python-tdd-workflow\` |
| Writing tests, fixing bugs, refactoring TypeScript/React code | \`frontend-tdd-workflow\` |
| Adding/removing/updating Python dependencies | \`uv-package-manager\` |
| Adding/removing/updating TypeScript dependencies | \`pnpm-package-manager\` |

### Python Stack Rules
| When the project uses... | You MUST load... |
|---|---|
| FastAPI | \`fastapi-patterns\` |
| SQLAlchemy | \`sqlalchemy-patterns\` |
| Pydantic | \`pydantic-patterns\` |
| asyncio / uvicorn | \`async-python-patterns\` |
| Django | \`django-web-patterns\` + \`django-orm-patterns\` |
| Celery | \`celery-patterns\` |

### TypeScript/React Stack Rules
| When the project uses... | You MUST load... |
|---|---|
| Tailwind CSS | \`tailwind-patterns\` |
| Zustand | \`zustand-patterns\` |
| TanStack Query | \`tanstack-query-patterns\` |
| React Hook Form | \`form-patterns\` |
| TanStack Router | \`tanstack-router-patterns\` |

### All Available Skills
| Skill | Activation Rule |
|---|---|
${rows}

### HARD-RULES
- BEFORE any coding, review, or refactoring: check the tables above and load ALL applicable skills.
- If unsure whether a skill applies: load it \u2014 better to have context than miss constraints.
- After loading a skill, follow its HARD-RULES strictly.
- Do NOT begin implementation without loading applicable skills first.`;
}

// src/index.ts
var moduleDirectory = path2.dirname(fileURLToPath(import.meta.url));
var skillDirectories = [
  path2.resolve(moduleDirectory, "../../python-developer/dist/skills"),
  path2.resolve(moduleDirectory, "../../frontend-developer/dist/skills"),
  path2.resolve(moduleDirectory, "../../code-review/dist/skills"),
  path2.resolve(moduleDirectory, "../../../dist/skills/qa"),
  path2.resolve(moduleDirectory, "../../swift-developer/dist/skills")
];
var AppVerkSkillRegistryPlugin = async ({ client }) => {
  const catalog = buildSkillCatalog(skillDirectories);
  const loadSkill = createSkillLoader(catalog);
  const activationRules = generateActivationRules(catalog);
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      for (const dir of skillDirectories) {
        if (!config.skills.paths.includes(dir)) {
          config.skills.paths.push(dir);
        }
      }
    },
    tool: {
      load_appverk_skill: tool({
        description: "Load an AppVerk development skill by name. Returns the full markdown content of the skill's rules and patterns. Available skills include python-coding-standards, frontend-coding-standards, python-tdd-workflow, frontend-tdd-workflow, fastapi-patterns, sqlalchemy-patterns, tailwind-patterns, and more.",
        args: {
          name: tool.schema.string().describe("Skill name (e.g., python-coding-standards, fastapi-patterns)")
        },
        async execute(args) {
          try {
            return loadSkill(args.name);
          } catch (error) {
            return `Error: ${error.message}`;
          }
        }
      })
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return;
      if (await getSessionAgent(input.sessionID, client) === COORDINATOR_AGENT_NAME) return;
      output.system.push(activationRules);
    }
  };
};
var index_default = AppVerkSkillRegistryPlugin;
export {
  AppVerkSkillRegistryPlugin,
  index_default as default
};
