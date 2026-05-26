const TRUNCATION_MARKER = "\n[\u2026truncated\u2026]";
function truncateBytes(input, maxBytes) {
  const buf = Buffer.from(input, "utf8");
  if (buf.byteLength <= maxBytes) {
    return input;
  }
  const sliced = buf.subarray(0, maxBytes);
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced);
  return decoded + TRUNCATION_MARKER;
}
export {
  TRUNCATION_MARKER,
  truncateBytes
};
