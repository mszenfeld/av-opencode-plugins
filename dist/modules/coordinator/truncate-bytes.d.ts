declare const TRUNCATION_MARKER = "\n[\u2026truncated\u2026]";
/**
 * UTF-8-safe byte-bounded truncation. Slices the underlying bytes at the cap
 * and decodes with `fatal: false` so a partial trailing multi-byte sequence
 * is dropped rather than rendered as a replacement character. Truncating by
 * UTF-16 code units would both over-count ASCII and silently corrupt
 * multi-byte characters at the cut.
 *
 * Shared by `dispatch.ts` and `poller.ts` so both call sites apply the exact
 * same truncation policy.
 */
declare function truncateBytes(input: string, maxBytes: number): string;

export { TRUNCATION_MARKER, truncateBytes };
