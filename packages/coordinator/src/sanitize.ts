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
 *   - ASCII control characters (except whitespace `\n`, `\r`, `\t`) that can
 *     hide or distort text.
 *   - Angle-bracketed substrings that look like HTML or pseudo tags
 *     (`<script>`, `<system>`, etc.) — escaped so they render verbatim instead
 *     of being interpreted as instructions or tags.
 */
export function neutralizeUntrustedOutput(s: string): string {
  if (s.length === 0) {
    return s
  }

  // Strip ANSI control sequences (CSI: ESC [ ... letter)
  // Covers SGR (colors), cursor movement, and other CSI codes.
  let out = s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")

  // Strip remaining ASCII control characters (0x00–0x08, 0x0B, 0x0C, 0x0E–0x1F, 0x7F)
  // Preserve common whitespace: \t (0x09), \n (0x0A), \r (0x0D)
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")

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
