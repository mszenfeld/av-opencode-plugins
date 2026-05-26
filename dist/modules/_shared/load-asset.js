import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
function loadModuleAsset(callerUrl, relativePath) {
  const moduleDir = path.dirname(fileURLToPath(callerUrl));
  const filePath = path.resolve(moduleDir, relativePath);
  return readFileSync(filePath, "utf8");
}
export {
  loadModuleAsset
};
