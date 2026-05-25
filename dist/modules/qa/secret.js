const inspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
class Secret {
  #value;
  constructor(value) {
    this.#value = value;
  }
  unwrap() {
    return this.#value;
  }
  toJSON() {
    return "[REDACTED]";
  }
  toString() {
    return "[REDACTED]";
  }
  [inspectSymbol]() {
    return "[REDACTED]";
  }
}
export {
  Secret
};
