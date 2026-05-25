class SessionAgentRegistry {
  #map = /* @__PURE__ */ new Map();
  register(sessionID, agent) {
    this.#map.set(sessionID, agent);
  }
  unregister(sessionID) {
    this.#map.delete(sessionID);
  }
  lookup(sessionID) {
    return this.#map.get(sessionID);
  }
}
function makeShellEnvHook(deps) {
  return async (input, output) => {
    try {
      if (input.sessionID === void 0) return;
      const agent = deps.registry.lookup(input.sessionID);
      if (agent === void 0 || !agent.startsWith("zmora-")) return;
      const parentID = await deps.resolveParentID(input.sessionID);
      if (parentID === void 0) return;
      const entries = deps.store.listForParent(parentID);
      for (const [name, entry] of entries) {
        if (output.env[name] !== void 0) continue;
        try {
          output.env[name] = entry.value.unwrap();
        } catch {
        }
      }
    } catch {
    }
  };
}
export {
  SessionAgentRegistry,
  makeShellEnvHook
};
