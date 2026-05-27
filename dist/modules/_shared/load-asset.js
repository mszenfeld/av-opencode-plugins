import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const assetCache = /* @__PURE__ */ new Map();
function loadModuleAsset(callerUrl, relativePath) {
  const moduleDir = path.dirname(fileURLToPath(callerUrl));
  const filePath = path.resolve(moduleDir, relativePath);
  const cached = assetCache.get(filePath);
  if (cached !== void 0) {
    return cached;
  }
  const contents = readFileSync(filePath, "utf8");
  assetCache.set(filePath, contents);
  return contents;
}
export {
  loadModuleAsset
};
