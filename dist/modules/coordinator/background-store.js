class BackgroundTaskStore {
  tasks = /* @__PURE__ */ new Map();
  register(task) {
    this.tasks.set(task.id, task);
  }
  get(id) {
    return this.tasks.get(id);
  }
  listByParent(parentSessionId) {
    return [...this.tasks.values()].filter(
      (t) => t.parentSessionId === parentSessionId
    );
  }
  countRunningByParent(parentSessionId) {
    return this.listByParent(parentSessionId).length;
  }
  remove(id) {
    this.tasks.delete(id);
  }
  removeByChild(childSessionId) {
    for (const [id, t] of this.tasks) {
      if (t.childSessionId === childSessionId) this.tasks.delete(id);
    }
  }
  clearParent(parentSessionId) {
    for (const [id, t] of this.tasks) {
      if (t.parentSessionId === parentSessionId) this.tasks.delete(id);
    }
  }
}
export {
  BackgroundTaskStore
};
