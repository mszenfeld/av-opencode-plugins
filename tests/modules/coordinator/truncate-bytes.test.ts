import { describe, expect, it } from "vitest"
import {
  TRUNCATION_MARKER,
  truncateBytes,
} from "../../../src/modules/coordinator/truncate-bytes.js"

describe("truncateBytes", () => {
  it("returns empty string unchanged", () => {
    expect(truncateBytes("", 16)).toBe("")
  })

  it("returns an ASCII string under the byte cap unchanged", () => {
    const input = "hello"
    expect(Buffer.byteLength(input, "utf8")).toBe(5)
    expect(truncateBytes(input, 16)).toBe(input)
  })

  it("returns an ASCII string exactly at the byte cap unchanged (boundary)", () => {
    const input = "hello"
    // byteLength === maxBytes hits the `<=` branch, so no marker is appended.
    expect(truncateBytes(input, 5)).toBe(input)
  })

  it("truncates an ASCII string over the byte cap to the cap plus the marker", () => {
    const input = "hello world"
    const out = truncateBytes(input, 5)
    expect(out).toBe("hello" + TRUNCATION_MARKER)
    // The decoded payload (before the marker) is exactly the capped bytes.
    expect(out.slice(0, out.length - TRUNCATION_MARKER.length)).toBe("hello")
  })

  it("appends the exact TRUNCATION_MARKER suffix when truncating", () => {
    const out = truncateBytes("abcdef", 3)
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true)
    expect(out).toBe("abc" + TRUNCATION_MARKER)
    // Pin the marker's literal value so a format change is caught.
    expect(TRUNCATION_MARKER).toBe("\n[…truncated…]")
  })

  it("drops a partial 4-byte emoji at the cut boundary without emitting U+FFFD", () => {
    // "ab😀cd": a,b = 1 byte each; 😀 (U+1F600) = 4 bytes; c,d = 1 byte each.
    const input = "ab😀cd"
    expect(Buffer.byteLength(input, "utf8")).toBe(8)
    // Cap at 4 bytes cuts mid-emoji (2 of the emoji's 4 bytes survive the slice).
    const out = truncateBytes(input, 4)
    expect(out).toBe("ab" + TRUNCATION_MARKER)
    // The partial sequence must be dropped, never rendered as U+FFFD.
    expect(out).not.toContain("�")
  })

  it("drops a partial 3-byte CJK char at the cut boundary without emitting U+FFFD", () => {
    // "你好world": 你 and 好 are 3 bytes each (6 bytes total) then ASCII.
    const input = "你好world"
    expect(Buffer.byteLength(input, "utf8")).toBe(11)
    // Cap at 4 bytes: 你 (3 bytes) fits, then 1 of 好's 3 bytes is cut off.
    const out = truncateBytes(input, 4)
    expect(out).toBe("你" + TRUNCATION_MARKER)
    expect(out).not.toContain("�")
    // The decoded payload never exceeds the byte cap.
    const payload = out.slice(0, out.length - TRUNCATION_MARKER.length)
    expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(4)
  })

  it("keeps a complete multi-byte char that ends exactly on the cap boundary", () => {
    // 😀 is 4 bytes; capping a longer string at 4 keeps the whole emoji.
    const input = "😀tail"
    const out = truncateBytes(input, 4)
    expect(out).toBe("😀" + TRUNCATION_MARKER)
    expect(out).not.toContain("�")
  })
})
