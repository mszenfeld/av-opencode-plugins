export const TRUNCATION_MARKER = "\n[…truncated…]"

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
export function truncateBytes(input: string, maxBytes: number): string {
  const buf = Buffer.from(input, "utf8")
  if (buf.byteLength <= maxBytes) {
    return input
  }
  const sliced = buf.subarray(0, maxBytes)
  // Decode in streaming mode so an incomplete trailing multi-byte sequence at
  // the cut boundary is buffered (and, since we never flush, dropped) rather
  // than emitted as a U+FFFD replacement character. A non-streaming decode
  // treats the slice as a complete unit and would replace the partial trailing
  // bytes with U+FFFD, corrupting the output.
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced, {
    stream: true,
  })
  return decoded + TRUNCATION_MARKER
}
