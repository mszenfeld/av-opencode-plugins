import path from "node:path"

/**
 * Neutralizes specialist output before it is returned to the coordinator.
 *
 * Specialist results may originate from attacker-controlled surfaces (an
 * attacker-controlled web page rendered by Playwright, `curl` output from an
 * attacker-controlled server, etc.). When the coordinator (@perun) parses the
 * result string back into its own prompt context, hostile content could
 * plausibly influence subsequent tool invocations (prompt re-injection).
 *
 * This function does NOT try to make the content "safe" semantically — that is
 * @perun's job via guardrail rules in perun.md. It removes the most obvious
 * vectors that exploit terminal/markdown rendering:
 *
 *   - ANSI escape sequences (CSI `\x1b[...m` style) that can hide content in
 *     terminals or in some markdown renderers.
 *   - OSC sequences (`\x1b]...\x07` or `\x1b]...\x1b\\`) which can set window
 *     titles, hyperlinks, or other terminal state.
 *   - 8-bit C1 control byte equivalents (`\x9B` CSI, `\x9D` OSC) interpreted
 *     by xterm-class terminals as the same control sequences.
 *   - ASCII control characters (except whitespace `\n`, `\r`, `\t`) and the
 *     remaining C1 control range (0x80–0x9F) that can hide or distort text.
 *   - Unicode bidirectional override characters (U+202A–U+202E, U+2066–U+2069)
 *     that allow visual spoofing of payloads in markdown reports.
 *   - Unicode zero-width characters (U+200B–U+200D, U+FEFF) that can hide
 *     prompt-injection markers between visible characters.
 *   - Angle-bracketed substrings that look like HTML or pseudo tags
 *     (`<script>`, `<system>`, etc.) — escaped so they render verbatim instead
 *     of being interpreted as instructions or tags.
 */
// For the AppleScript-literal variant see
// `src/hooks/session-notification/notification-sender.ts::escapeAppleScriptText`.
// Different rules — different sinks.
export function neutralizeUntrustedOutput(s: string): string {
  if (s.length === 0) {
    return s
  }

  // Strip OSC (Operating System Command) sequences first, since their payload
  // may itself contain ESC bytes that would survive a later CSI-only pass.
  // 7-bit form: ESC ] ... BEL  |  ESC ] ... ESC \
  // 8-bit form: 0x9D ... BEL   |  0x9D ... ESC \
  let out = s.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
  out = out.replace(/\x9D[\s\S]*?(?:\x07|\x1b\\)/g, "")

  // Strip ANSI CSI control sequences (7-bit: ESC [ ... letter; 8-bit: 0x9B ... letter).
  // Covers SGR (colors), cursor movement, and other CSI codes.
  out = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
  out = out.replace(/\x9B[0-9;?]*[a-zA-Z]/g, "")

  // Strip remaining ASCII control characters (0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F, 0x7F)
  // and the full C1 control range (0x80–0x9F) — xterm-class terminals interpret
  // C1 bytes as control codes (e.g. 0x9B = CSI introducer).
  // Preserve common whitespace: \t (0x09), \n (0x0A), \r (0x0D).
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")

  // Strip Unicode bidirectional override characters that allow visual spoofing
  // of payloads in markdown viewers (e.g. flipping malicious text to look benign).
  //   U+202A LRE, U+202B RLE, U+202C PDF, U+202D LRO, U+202E RLO
  //   U+2066 LRI, U+2067 RLI, U+2068 FSI, U+2069 PDI
  out = out.replace(/[‪-‮⁦-⁩]/g, "")

  // Strip zero-width characters that can hide prompt-injection markers between
  // visible glyphs (U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF ZWNBSP/BOM).
  out = out.replace(/[​-‍﻿]/g, "")

  // HTML-escape angle-bracketed substrings so they render as literal text in
  // markdown viewers and never get interpreted as tags or directives.
  out = out.replace(/</g, "&lt;").replace(/>/g, "&gt;")

  return out
}

const PLAN_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/
const PLAN_SUFFIX = /-test-plan$/
const VALID_TOPIC = /^[a-z0-9-]+$/i

/**
 * Derives the canonical report file path from a plan path.
 *
 * Strips the `YYYY-MM-DD-` prefix and `-test-plan` suffix from the plan
 * basename, validates the remaining topic against `[a-z0-9-]+`, and returns
 * a POSIX path under `docs/testing/reports/`.
 *
 * Throws if the derived topic is empty or contains characters that could be
 * exploited for path traversal or filename injection.
 *
 * Example:
 *   deriveReportPath("docs/testing/plans/2026-05-18-example-auth-test-plan.md",
 *                    "2026-05-18")
 *   → "docs/testing/reports/2026-05-18-example-auth-report.md"
 */
export function deriveReportPath(planPath: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`deriveReportPath: invalid date "${today}", expected YYYY-MM-DD`)
  }

  const base = path.posix.basename(planPath).replace(/\.md$/, "")
  const withoutDate = base.replace(PLAN_DATE_PREFIX, "")
  const topic = withoutDate.replace(PLAN_SUFFIX, "")

  if (topic.length === 0) {
    throw new Error(`deriveReportPath: empty topic derived from "${planPath}"`)
  }

  if (!VALID_TOPIC.test(topic)) {
    throw new Error(
      `deriveReportPath: invalid topic "${topic}" (allowed: a-z, 0-9, -)`,
    )
  }

  return path.posix.join("docs/testing/reports", `${today}-${topic}-report.md`)
}
