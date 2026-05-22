import { loadFresh } from "./loader.js";
import { validateConfigFile } from "./schema.js";
import { userGlobalPath, walkUpProjectPaths } from "./paths.js";
import { loadFresh as loadFresh2 } from "./loader.js";
let cached;
function ensureLoaded() {
  if (cached === void 0) {
    cached = loadFresh();
  }
  return cached;
}
function loadPantheonConfig() {
  return ensureLoaded().config;
}
function getLoadErrors() {
  return ensureLoaded().errors;
}
function pantheonConfigEmpty() {
  return Object.keys(ensureLoaded().config.agents).length === 0;
}
function __resetCacheForTests() {
  cached = void 0;
}
export {
  __resetCacheForTests,
  getLoadErrors,
  loadFresh2 as loadFresh,
  loadPantheonConfig,
  pantheonConfigEmpty,
  userGlobalPath,
  validateConfigFile,
  walkUpProjectPaths
};
