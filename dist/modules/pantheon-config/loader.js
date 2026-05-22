import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import * as jsoncParser from "jsonc-parser";
import { validateConfigFile } from "./schema.js";
import { userGlobalPath, walkUpProjectPaths } from "./paths.js";
function loadFresh(options = {}) {
  const startDir = options.startDir ?? process.cwd();
  const homedir = options.homedir ?? os.homedir();
  const projectAscending = walkUpProjectPaths(startDir, homedir).slice().reverse();
  const ordered = [userGlobalPath(homedir), ...projectAscending];
  const result = { agents: {} };
  const errors = [];
  for (const filePath of ordered) {
    if (!existsSync(filePath)) continue;
    let raw;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (err) {
      errors.push(
        `[pantheon] ${filePath}: failed to read \u2014 ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    const parseErrors = [];
    const parsed = jsoncParser.parse(raw, parseErrors, { allowTrailingComma: true });
    if (parseErrors.length > 0) {
      const detail = parseErrors.map((e) => `${jsoncParser.printParseErrorCode(e.error)}@${e.offset}`).join(", ");
      errors.push(`[pantheon] ${filePath}: failed to parse \u2014 ${detail}`);
      continue;
    }
    const { config, errors: fileErrors } = validateConfigFile(parsed, filePath);
    for (const e of fileErrors) errors.push(e);
    for (const [name, agent] of Object.entries(config.agents)) {
      result.agents[name] = agent;
    }
  }
  return { config: result, errors };
}
export {
  loadFresh
};
