const PARTIAL_MIN_LEN = 16;
const ENTROPY_MIN = 3.8;
function shannonEntropy(s) {
  if (s.length === 0) return 0;
  const freq = /* @__PURE__ */ new Map();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
function scrubSecrets(text, parentID, store, snapshot) {
  const entries = snapshot !== void 0 ? snapshot.entries : store.listForParent(parentID);
  if (entries.size === 0) return text;
  let out = text;
  const secretEntries = Array.from(entries.entries()).filter(([, e]) => e.type === "secret").sort((a, b) => b[1].value.unwrap().length - a[1].value.unwrap().length);
  for (const [name, entry] of secretEntries) {
    const v = entry.value.unwrap();
    if (v.length === 0) continue;
    if (out.includes(v)) {
      out = out.split(v).join(`[REDACTED:${name}]`);
      continue;
    }
    if (v.length < PARTIAL_MIN_LEN) continue;
    if (shannonEntropy(v) < ENTROPY_MIN) continue;
    for (let len = v.length; len >= PARTIAL_MIN_LEN; len--) {
      let found = false;
      for (let i = 0; i + len <= v.length; i++) {
        const sub = v.slice(i, i + len);
        if (shannonEntropy(sub) < ENTROPY_MIN) continue;
        if (out.includes(sub)) {
          out = out.split(sub).join(`[REDACTED:${name}]`);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  return out;
}
export {
  scrubSecrets
};
