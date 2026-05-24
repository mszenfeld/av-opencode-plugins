import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import * as jsoncParser from "jsonc-parser";
import { validateConfigFile } from "./schema.js";
import { userGlobalPath, walkUpProjectPaths } from "./paths.js";
const MAX_PANTHEON_FILE_BYTES = 1024 * 1024;
function offsetToLineCol(src, offset) {
  let line = 1;
  let col = 1;
  const limit = Math.min(offset, src.length);
  for (let i = 0; i < limit; i++) {
    if (src.charCodeAt(i) === 10) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return `line ${line}:${col}`;
}
function loadFresh(options = {}) {
  const startDir = options.startDir ?? process.cwd();
  const homedir = options.homedir ?? os.homedir();
  const projectAscending = walkUpProjectPaths(startDir, homedir).slice().reverse();
  const ordered = [userGlobalPath(homedir), ...projectAscending];
  const result = { agents: {} };
  const errors = [];
  for (const filePath of ordered) {
    if (!existsSync(filePath)) continue;
    try {
      const stats = statSync(filePath);
      if (stats.size > MAX_PANTHEON_FILE_BYTES) {
        errors.push(
          `[pantheon] ${filePath}: file is ${stats.size} bytes, exceeds ${MAX_PANTHEON_FILE_BYTES}-byte limit \u2014 skipping`
        );
        continue;
      }
    } catch {
    }
    let raw;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (err) {
      errors.push(
        `[pantheon] ${filePath}: failed to read \u2014 ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    let parsed;
    const parseErrors = [];
    try {
      parsed = jsoncParser.parse(raw, parseErrors, { allowTrailingComma: true });
    } catch (err) {
      errors.push(
        `[pantheon] ${filePath}: failed to parse \u2014 ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    if (parseErrors.length > 0) {
      const detail = parseErrors.map((e) => `${jsoncParser.printParseErrorCode(e.error)} at ${offsetToLineCol(raw, e.offset)}`).join(", ");
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
  loadFresh,
  offsetToLineCol
};
