const inspectSymbol = Symbol.for("nodejs.util.inspect.custom")

/**
 * Wraps a binding value so accidental logging / serialization / inspection
 * renders "[REDACTED]" instead of the underlying string. Real access requires
 * an explicit .unwrap() call — this is mistake-defense, not a security
 * boundary against attackers with .value access.
 */
export class Secret {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  unwrap(): string {
    return this.#value
  }

  toJSON(): string {
    return "[REDACTED]"
  }

  toString(): string {
    return "[REDACTED]"
  }

  [inspectSymbol](): string {
    return "[REDACTED]"
  }
}
