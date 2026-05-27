import type { BindingsStore, BindingSnapshot, BindingEntry } from "./bindings-store.js"

const PARTIAL_MIN_LEN = 16
const ENTROPY_MIN = 3.8
// Upper bound on substring candidates examined per secret during the
// partial-redaction scan. Bounds the worst-case cost (entropy + includes)
// independent of secret length, neutralising the O(v^2) / DoS hotspot.
// 4096 covers a sliding window over a ~4 KB secret at every offset/length
// that realistically matters while keeping the scan cheap; once exhausted we
// stop searching shorter windows for that secret rather than spinning the CPU.
const PARTIAL_SCAN_BUDGET = 4096

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0
  const freq = new Map<string, number>()
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1)
  let h = 0
  for (const n of freq.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

// Shannon entropy of a sliding window maintained incrementally. Adding or
// removing one character is O(1), so scanning all windows of a fixed length
// across a string is O(n) instead of O(n * len) recomputation.
class WindowEntropy {
  private readonly freq = new Map<string, number>()
  private len = 0
  // Running sum of n * log2(n) over current character counts. Shannon entropy
  // for the window is then: log2(len) - sumNLogN / len.
  private sumNLogN = 0

  add(c: string): void {
    const prev = this.freq.get(c) ?? 0
    if (prev > 0) this.sumNLogN -= prev * Math.log2(prev)
    const next = prev + 1
    this.sumNLogN += next * Math.log2(next)
    this.freq.set(c, next)
    this.len += 1
  }

  remove(c: string): void {
    const prev = this.freq.get(c) ?? 0
    if (prev === 0) return
    this.sumNLogN -= prev * Math.log2(prev)
    const next = prev - 1
    if (next > 0) {
      this.sumNLogN += next * Math.log2(next)
      this.freq.set(c, next)
    } else {
      this.freq.delete(c)
    }
    this.len -= 1
  }

  entropy(): number {
    if (this.len === 0) return 0
    return Math.log2(this.len) - this.sumNLogN / this.len
  }
}

export function scrubSecrets(
  text: string,
  parentID: string,
  store: BindingsStore,
  snapshot?: BindingSnapshot,
): string {
  const entries: ReadonlyMap<string, BindingEntry> =
    snapshot !== undefined ? snapshot.entries : store.listForParent(parentID)
  if (entries.size === 0) return text

  let out = text
  // Sort by value length desc so longer values take precedence on overlap.
  const secretEntries = Array.from(entries.entries())
    .filter(([, e]) => e.type === "secret")
    .sort((a, b) => b[1].value.unwrap().length - a[1].value.unwrap().length)

  for (const [name, entry] of secretEntries) {
    const v = entry.value.unwrap()
    if (v.length === 0) continue

    // Exact full-value replace.
    if (out.includes(v)) {
      out = out.split(v).join(`[REDACTED:${name}]`)
      continue
    }

    // Partial: longest substring of v ≥16 chars with entropy ≥3.8 present in out.
    // Threshold raised from 3.5 to 3.8 to reduce false-positives on low-entropy
    // strings like "test_user_admin_account" that would otherwise be redacted.
    if (v.length < PARTIAL_MIN_LEN) continue
    if (shannonEntropy(v) < ENTROPY_MIN) continue

    // Longest substring of v (length ≥ PARTIAL_MIN_LEN, entropy ≥ ENTROPY_MIN)
    // present in out wins. We scan windows from longest to shortest, computing
    // each window's entropy incrementally (O(1) per slide). A scan budget caps
    // the number of candidates so cost is bounded regardless of secret length.
    let budget = PARTIAL_SCAN_BUDGET
    let found = false
    for (let len = v.length; len >= PARTIAL_MIN_LEN && budget > 0 && !found; len--) {
      const win = new WindowEntropy()
      for (let i = 0; i < len; i++) win.add(v[i]!)
      for (let i = 0; i + len <= v.length; i++) {
        if (i > 0) {
          win.remove(v[i - 1]!)
          win.add(v[i + len - 1]!)
        }
        if (--budget < 0) break
        if (win.entropy() < ENTROPY_MIN) continue
        const sub = v.slice(i, i + len)
        if (out.includes(sub)) {
          out = out.split(sub).join(`[REDACTED:${name}]`)
          found = true
          break
        }
      }
    }
  }

  return out
}
