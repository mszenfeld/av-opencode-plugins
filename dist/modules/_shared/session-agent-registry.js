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
export {
  SessionAgentRegistry
};
