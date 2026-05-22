class SessionTracker {
  mainSessionId;
  registerSession(id) {
    if (this.mainSessionId === void 0) {
      this.mainSessionId = id;
    }
  }
  deleteSession(id) {
    if (this.mainSessionId === id) {
      this.mainSessionId = void 0;
    }
  }
  isMain(id) {
    return this.mainSessionId === id;
  }
}
export {
  SessionTracker
};
