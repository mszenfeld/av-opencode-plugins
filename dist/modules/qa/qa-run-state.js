class QaRunState {
  #map = /* @__PURE__ */ new Map();
  storePlan(parentID, bindings) {
    const existing = this.#map.get(parentID);
    if (existing !== void 0) {
      existing.plan = bindings;
      return;
    }
    this.#map.set(parentID, { plan: bindings, dialogRound: 0, recipeAttempts: /* @__PURE__ */ new Map() });
  }
  getBindings(parentID) {
    return this.#map.get(parentID)?.plan;
  }
  getDialogRound(parentID) {
    return this.#map.get(parentID)?.dialogRound ?? 0;
  }
  incrementDialogRound(parentID) {
    let r = this.#map.get(parentID);
    if (r === void 0) {
      r = { plan: [], dialogRound: 0, recipeAttempts: /* @__PURE__ */ new Map() };
      this.#map.set(parentID, r);
    }
    r.dialogRound++;
    return r.dialogRound;
  }
  getRecipeAttempts(parentID, bindingName) {
    return this.#map.get(parentID)?.recipeAttempts.get(bindingName) ?? 0;
  }
  incrementRecipeAttempt(parentID, bindingName) {
    let r = this.#map.get(parentID);
    if (r === void 0) {
      r = { plan: [], dialogRound: 0, recipeAttempts: /* @__PURE__ */ new Map() };
      this.#map.set(parentID, r);
    }
    const next = (r.recipeAttempts.get(bindingName) ?? 0) + 1;
    r.recipeAttempts.set(bindingName, next);
    return next;
  }
  clearRun(parentID) {
    this.#map.delete(parentID);
  }
}
export {
  QaRunState
};
