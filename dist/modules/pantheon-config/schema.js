const MODEL_REGEX = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const KNOWN_AGENT_FIELDS = /* @__PURE__ */ new Set(["model"]);
function prefix(sourcePath) {
  return sourcePath !== void 0 ? `[pantheon] ${sourcePath}: ` : "[pantheon] ";
}
function validateConfigFile(raw, sourcePath) {
  const errors = [];
  const result = { agents: {} };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${prefix(sourcePath)}top-level must be object`);
    return { config: result, errors };
  }
  const obj = raw;
  const agents = obj.agents;
  if (agents === void 0) {
    return { config: result, errors };
  }
  if (agents === null || typeof agents !== "object" || Array.isArray(agents)) {
    errors.push(`${prefix(sourcePath)}agents must be object \u2014 ignoring`);
    return { config: result, errors };
  }
  for (const [name, agentRaw] of Object.entries(agents)) {
    if (agentRaw === null || typeof agentRaw !== "object" || Array.isArray(agentRaw)) {
      errors.push(`${prefix(sourcePath)}agents.${name} must be object \u2014 ignoring`);
      continue;
    }
    const agent = agentRaw;
    for (const field of Object.keys(agent)) {
      if (!KNOWN_AGENT_FIELDS.has(field)) {
        errors.push(`${prefix(sourcePath)}unknown field "agents.${name}.${field}"`);
      }
    }
    const model = agent.model;
    if (model === void 0) {
      continue;
    }
    if (typeof model !== "string" || !MODEL_REGEX.test(model)) {
      const shown = typeof model === "string" ? `"${model}"` : String(model);
      errors.push(
        `${prefix(sourcePath)}invalid model ${shown} for agent "${name}" \u2014 must match <providerID>/<modelID>`
      );
      continue;
    }
    result.agents[name] = { model };
  }
  return { config: result, errors };
}
export {
  validateConfigFile
};
