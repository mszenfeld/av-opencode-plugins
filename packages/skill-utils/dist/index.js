// src/index.ts
import { readFileSync } from "fs";
import path from "path";
import { tool } from "@opencode-ai/plugin";

// src/category-prefix-mapping.ts
var CATEGORY_PREFIX_MAPPING = {
  Security: "SEC",
  Performance: "PERF",
  Architecture: "ARCH",
  Maintainability: "MAINT",
  Documentation: "DOC",
  Testing: "QA"
};
var VALID_PREFIXES = Object.values(CATEGORY_PREFIX_MAPPING);
var VALID_CATEGORIES = Object.keys(CATEGORY_PREFIX_MAPPING);

// src/session-identity.ts
var COORDINATOR_AGENT_NAME = "Perun - Coordinator";
async function getSessionParentID(sessionID, client) {
  try {
    const res = await client.session.get({ path: { id: sessionID } });
    return res.data?.parentID;
  } catch {
    return void 0;
  }
}
async function getSessionAgent(sessionID, client) {
  try {
    const res = await client.session.messages({ path: { id: sessionID } });
    const msgs = res.data ?? [];
    const firstUser = msgs.find((m) => m.info?.role === "user")?.info;
    return firstUser?.agent;
  } catch {
    return void 0;
  }
}
async function isCoordinatorSession(sessionID, client) {
  return await getSessionAgent(sessionID, client) === COORDINATOR_AGENT_NAME;
}

// src/coordinator-bash-policy.ts
function parseAllowedBashPrograms(frontmatter) {
  const out = [];
  const re = /Bash\(([^:)]+):\*\)/g;
  let m;
  while ((m = re.exec(frontmatter)) !== null) {
    const prog = m[1];
    if (prog !== void 0) out.push(prog.trim());
  }
  return out;
}
var COMPOUND = /(\|\||&&|;|\||`|\$\(|(?<![\w./-])(?:bash|sh|eval)\b)/;
function classifyCoordinatorBash(command, allowedPrograms) {
  const trimmed = command.trim();
  if (COMPOUND.test(trimmed)) return { allowed: false, program: null };
  const program = trimmed.split(/\s+/)[0] ?? "";
  return { allowed: allowedPrograms.includes(program), program };
}
function buildViolationError(info) {
  const payload = JSON.stringify({ marker: "COORDINATOR_POLICY_VIOLATION", ...info });
  const subject = info.command ? `\`${info.command.split(/\s+/)[0]}\`` : info.skill ? `skill \`${info.skill}\`` : "that";
  return new Error(
    `${payload}
The coordinator may not run ${subject}. Dispatch Veles (planning) or Triglav (exploration) to inspect the repository instead.`
  );
}

// src/index.ts
function loadFile(packaged, source) {
  try {
    return readFileSync(packaged, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        return readFileSync(source, "utf8");
      } catch (innerError) {
        throw new Error(
          `Failed to load plugin template. Attempted paths: ${packaged}, ${source}. Original error: ${innerError.message}`,
          { cause: innerError }
        );
      }
    }
    throw new Error(
      `Failed to load plugin template. Attempted path: ${packaged}. Original error: ${error.message}`,
      { cause: error }
    );
  }
}
function createLazyFileLoader(packaged, source) {
  let cached;
  return () => {
    if (cached === void 0) {
      cached = loadFile(packaged, source);
    }
    return cached;
  };
}
function createSkillLoader(options) {
  const { namespace, availableSkills, moduleDirectory } = options;
  const skillCache = /* @__PURE__ */ new Map();
  function loadSkillContent(name) {
    const candidates = [
      path.resolve(moduleDirectory, "skills", name, "SKILL.md"),
      // packaged build (dist/skills/)
      path.resolve(moduleDirectory, "../src/skills", name, "SKILL.md"),
      // from dist/ in repo (src/skills/)
      path.resolve(moduleDirectory, "../skills", name, "SKILL.md")
      // from src/tools/ in vitest (src/skills/)
    ];
    let lastError;
    for (const candidate of candidates) {
      try {
        return readFileSync(candidate, "utf8");
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`${namespace} skill file not found for: ${name}`, { cause: lastError });
  }
  return function loadSkill(name) {
    if (!availableSkills.includes(name)) {
      throw new Error(
        `${namespace} skill not found: ${name}. Available: ${availableSkills.join(", ")}`
      );
    }
    if (skillCache.has(name)) {
      return skillCache.get(name);
    }
    const content = loadSkillContent(name);
    skillCache.set(name, content);
    return content;
  };
}
function createSkillPlugin(options) {
  const {
    namespace,
    agentName,
    commandName,
    agentDescription,
    commandDescription,
    loadSkill,
    availableSkills,
    moduleDirectory,
    mode = "primary"
  } = options;
  const packagedAgentPath = path.resolve(moduleDirectory, "agent-prompt.md");
  const sourceAgentPath = path.resolve(moduleDirectory, "../src/agent-prompt.md");
  const packagedCommandPath = path.resolve(
    moduleDirectory,
    `commands/${commandName}.md`
  );
  const sourceCommandPath = path.resolve(
    moduleDirectory,
    `../src/commands/${commandName}.md`
  );
  const getAgentPrompt = createLazyFileLoader(packagedAgentPath, sourceAgentPath);
  const getCommandTemplate = createLazyFileLoader(
    packagedCommandPath,
    sourceCommandPath
  );
  const plugin = {
    config: async (config) => {
      config.agent = config.agent ?? {};
      config.agent[agentName] = {
        description: agentDescription,
        get prompt() {
          return getAgentPrompt();
        },
        mode
      };
      config.command = config.command ?? {};
      config.command[commandName] = {
        description: commandDescription,
        get template() {
          return getCommandTemplate();
        },
        agent: agentName
      };
    }
  };
  if (loadSkill) {
    plugin.tool = {
      [`load_${namespace}_skill`]: tool({
        description: `Load a ${namespace} development skill by name. Returns the full markdown content of the skill's rules and patterns.`,
        args: {
          name: tool.schema.string().describe(`Skill name: ${availableSkills.join(", ")}`)
        },
        async execute(args) {
          return loadSkill(args.name);
        }
      })
    };
  }
  return async () => plugin;
}
export {
  CATEGORY_PREFIX_MAPPING,
  COORDINATOR_AGENT_NAME,
  VALID_CATEGORIES,
  VALID_PREFIXES,
  buildViolationError,
  classifyCoordinatorBash,
  createSkillLoader,
  createSkillPlugin,
  getSessionAgent,
  getSessionParentID,
  isCoordinatorSession,
  parseAllowedBashPrograms
};
