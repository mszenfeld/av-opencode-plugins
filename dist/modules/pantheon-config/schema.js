import { neutralizeUntrustedOutput } from "../coordinator/sanitize.js";
const MODEL_REGEX = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/;
const MAX_SHOWN_LEN = 120;
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
  for (const [rawName, agentRaw] of Object.entries(agents)) {
    const safeName = neutralizeUntrustedOutput(rawName);
    if (agentRaw === null || typeof agentRaw !== "object" || Array.isArray(agentRaw)) {
      errors.push(`${prefix(sourcePath)}agents.${safeName} must be object \u2014 ignoring`);
      continue;
    }
    const agent = agentRaw;
    for (const rawField of Object.keys(agent)) {
      if (!KNOWN_AGENT_FIELDS.has(rawField)) {
        errors.push(`${prefix(sourcePath)}unknown field "agents.${safeName}.${neutralizeUntrustedOutput(rawField)}"`);
      }
    }
    const model = agent.model;
    if (model === void 0) {
      continue;
    }
    if (typeof model !== "string" || !MODEL_REGEX.test(model)) {
      const raw2 = typeof model === "string" ? model : String(model);
      const cleaned = neutralizeUntrustedOutput(raw2);
      const truncated = cleaned.length > MAX_SHOWN_LEN ? `${cleaned.slice(0, MAX_SHOWN_LEN)}\u2026` : cleaned;
      const shown = `"${truncated}"`;
      errors.push(
        `${prefix(sourcePath)}invalid model ${shown} for agent "${safeName}" \u2014 must match <providerID>/<modelID> (aggregator paths like openrouter/openai/gpt-5.5 are allowed)`
      );
      continue;
    }
    result.agents[rawName] = { model };
  }
  return { config: result, errors };
}
export {
  validateConfigFile
};
