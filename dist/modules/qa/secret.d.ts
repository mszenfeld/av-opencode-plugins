declare const inspectSymbol: unique symbol;
/**
 * Wraps a binding value so accidental logging / serialization / inspection
 * renders "[REDACTED]" instead of the underlying string. Real access requires
 * an explicit .unwrap() call — this is mistake-defense, not a security
 * boundary against attackers with .value access.
 */
declare class Secret {
    #private;
    constructor(value: string);
    unwrap(): string;
    toJSON(): string;
    toString(): string;
    [inspectSymbol](): string;
}

export { Secret };
