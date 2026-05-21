declare const TRUNCATION_MARKER = "\n[\u2026truncated\u2026]";
/**
 * UTF-8-safe byte-bounded truncation. Slices the underlying bytes at the cap
 * and decodes with `fatal: false` so a partial trailing multi-byte sequence
 * is dropped rather than rendered as a replacement character (SEC-009 /
 * MAINT-006: prior implementation truncated by UTF-16 code units, which both
 * over-counts ASCII and silently corrupts multi-byte characters at the cut).
 *
 * Shared by `dispatch.ts` and `poller.ts` so both call sites apply the exact
 * same truncation policy (MAINT-010).
 */
declare function truncateBytes(input: string, maxBytes: number): string;

export { TRUNCATION_MARKER, truncateBytes };
