const PARTIAL_MIN_LEN = 16;
const ENTROPY_MIN = 3.8;
const PARTIAL_SCAN_BUDGET = 4096;
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
class WindowEntropy {
  freq = /* @__PURE__ */ new Map();
  len = 0;
  // Running sum of n * log2(n) over current character counts. Shannon entropy
  // for the window is then: log2(len) - sumNLogN / len.
  sumNLogN = 0;
  add(c) {
    const prev = this.freq.get(c) ?? 0;
    if (prev > 0) this.sumNLogN -= prev * Math.log2(prev);
    const next = prev + 1;
    this.sumNLogN += next * Math.log2(next);
    this.freq.set(c, next);
    this.len += 1;
  }
  remove(c) {
    const prev = this.freq.get(c) ?? 0;
    if (prev === 0) return;
    this.sumNLogN -= prev * Math.log2(prev);
    const next = prev - 1;
    if (next > 0) {
      this.sumNLogN += next * Math.log2(next);
      this.freq.set(c, next);
    } else {
      this.freq.delete(c);
    }
    this.len -= 1;
  }
  entropy() {
    if (this.len === 0) return 0;
    return Math.log2(this.len) - this.sumNLogN / this.len;
  }
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
    let budget = PARTIAL_SCAN_BUDGET;
    let found = false;
    for (let len = v.length; len >= PARTIAL_MIN_LEN && budget > 0 && !found; len--) {
      const win = new WindowEntropy();
      for (let i = 0; i < len; i++) win.add(v[i]);
      for (let i = 0; i + len <= v.length; i++) {
        if (i > 0) {
          win.remove(v[i - 1]);
          win.add(v[i + len - 1]);
        }
        if (--budget < 0) break;
        if (win.entropy() < ENTROPY_MIN) continue;
        const sub = v.slice(i, i + len);
        if (out.includes(sub)) {
          out = out.split(sub).join(`[REDACTED:${name}]`);
          found = true;
          break;
        }
      }
    }
  }
  return out;
}
export {
  scrubSecrets
};
