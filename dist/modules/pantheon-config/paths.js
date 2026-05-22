import os from "node:os";
import path from "node:path";
function userGlobalPath(homedir = os.homedir()) {
  return path.join(homedir, ".config", "opencode", "pantheon.json");
}
function walkUpProjectPaths(startDir, homedir = os.homedir()) {
  const paths = [];
  let cur = path.resolve(startDir);
  const stopAt = path.resolve(homedir);
  while (true) {
    paths.push(path.join(cur, ".opencode", "pantheon.json"));
    if (cur === stopAt) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return paths;
}
export {
  userGlobalPath,
  walkUpProjectPaths
};
