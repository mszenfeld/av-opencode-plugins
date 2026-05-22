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
declare function neutralizeUntrustedOutput(s: string): string;
declare function normalizeVariantSuffix(s: string): string;
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
declare function deriveReportPath(planPath: string, today: string): string;

export { deriveReportPath, neutralizeUntrustedOutput, normalizeVariantSuffix };
