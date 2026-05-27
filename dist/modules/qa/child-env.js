const HOST_ENV_ALLOWLIST = /* @__PURE__ */ new Set([
  "PATH",
  "HOME",
  "LANG",
  "TZ",
  // SHELL/USER/LOGNAME are read by some CLIs (psql) for default values; safe
  // to inherit as they are not credentials.
  "SHELL",
  "USER",
  "LOGNAME"
]);
function isLocaleVar(name) {
  return name.startsWith("LC_");
}
function buildChildEnv(hostEnv, composedEnv) {
  const out = {};
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value === void 0) continue;
    if (!HOST_ENV_ALLOWLIST.has(name) && !isLocaleVar(name)) continue;
    out[name] = value;
  }
  for (const [name, value] of Object.entries(composedEnv)) {
    out[name] = value;
  }
  return out;
}
export {
  buildChildEnv
};
