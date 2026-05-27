import { existsSync, readFileSync, statSync } from "node:fs"
import os from "node:os"
import * as jsoncParser from "jsonc-parser"
import { neutralizeUntrustedOutput } from "../coordinator/sanitize.js"
import { type PantheonConfig, validateConfigFile } from "./schema.js"
import { userGlobalPath, walkUpProjectPaths } from "./paths.js"

/**
 * Hard cap on pantheon.json size. The file is small by design (a flat
 * agent → model map), so 1 MiB is generous. We guard with `statSync` BEFORE
 * `readFileSync` so a malicious or accidentally huge file cannot exhaust
 * memory or stall the loader. Files over this size are skipped with an
 * error entry — they do NOT crash the plugin.
 */
const MAX_PANTHEON_FILE_BYTES = 1024 * 1024

/**
 * Convert a byte offset within `src` to a human-readable `line N:col M`
 * string (1-indexed). Byte offsets are useless in editor UIs that don't
 * support goto-byte, so error messages render `line:col` instead.
 *
 * Newline handling: only `\n` (LF, 0x0A) increments the line counter.
 * `\r\n` is treated as `\r` (col++) followed by `\n` (line++, col=1),
 * which matches how editors number columns in CRLF files.
 *
 * Exported for unit tests.
 */
export function offsetToLineCol(src: string, offset: number): string {
  let line = 1
  let col = 1
  const limit = Math.min(offset, src.length)
  for (let i = 0; i < limit; i++) {
    if (src.charCodeAt(i) === 10) {
      line++
      col = 1
    } else {
      col++
    }
  }
  return `line ${line}:${col}`
}

/**
 * No-cache, side-effect-explicit loader. `loadPantheonConfig` in index.ts
 * wraps this with a module-scope cache. Tests call `loadFresh` directly so
 * each test starts from a clean slate.
 *
 * Reads user-global first (base), then project paths from furthest to
 * closest. Closest entry wins per agent.
 */

export type LoadFreshOptions = {
  /** Defaults to process.cwd(). */
  startDir?: string
  /** Defaults to os.homedir(). */
  homedir?: string
}

export type LoadResult = {
  config: PantheonConfig
  errors: string[]
}

export function loadFresh(options: LoadFreshOptions = {}): LoadResult {
  const startDir = options.startDir ?? process.cwd()
  const homedir = options.homedir ?? os.homedir()

  // Order: user-global (base), then project paths from FURTHEST → CLOSEST.
  // walkUpProjectPaths returns closest-first, so reverse it.
  const projectAscending = walkUpProjectPaths(startDir, homedir).slice().reverse()
  const ordered = [userGlobalPath(homedir), ...projectAscending]

  const result: PantheonConfig = { agents: {} }
  const errors: string[] = []

  for (const filePath of ordered) {
    if (!existsSync(filePath)) continue

    // Source-side CWE-117 hardening: `getLoadErrors()` is exported, so any
    // future consumer can read these strings without the coordinator's
    // sink-side neutralization. Paths can carry control bytes on some
    // platforms, so neutralize once here and interpolate the safe value into
    // every error entry below. Mirrors the sanitized `err.message` paths and
    // the source-side guard in `schema.ts`.
    const safePath = neutralizeUntrustedOutput(filePath)

    // Oversized-file guard: stat BEFORE read so a multi-GB file can never
    // be slurped into memory. Stat errors fall through to the read attempt
    // so the existing error path still owns the messaging.
    try {
      const stats = statSync(filePath)
      if (stats.size > MAX_PANTHEON_FILE_BYTES) {
        errors.push(
          `[pantheon] ${safePath}: file is ${stats.size} bytes, exceeds ${MAX_PANTHEON_FILE_BYTES}-byte limit — skipping`,
        )
        continue
      }
    } catch {
      // Best-effort: if stat fails, the readFileSync below will surface the
      // real error via the existing catch.
    }

    let raw: string
    try {
      raw = readFileSync(filePath, "utf8")
    } catch (err) {
      // Source-side sanitize for defense-in-depth: `getLoadErrors()` is
      // exported, so the coordinator's sink-side `neutralizeUntrustedOutput`
      // can be bypassed by future consumers. `err.message` may contain
      // attacker-influenced bytes (e.g. ENOENT messages echoing the path,
      // or platform-specific error text); strip ANSI/OSC/C0/C1/BiDi/zero-width
      // before interpolating. CWE-117. Mirrors the source-side guard in
      // `schema.ts`.
      const detail = err instanceof Error ? err.message : String(err)
      errors.push(`[pantheon] ${safePath}: failed to read — ${neutralizeUntrustedOutput(detail)}`)
      continue
    }

    // jsonc-parser throws RangeError on deeply nested input ("Maximum call
    // stack size exceeded"). Wrap the call so a hostile or accidentally
    // malformed file degrades to an error entry instead of crashing the
    // plugin's config / event hooks.
    let parsed: unknown
    const parseErrors: jsoncParser.ParseError[] = []
    try {
      parsed = jsoncParser.parse(raw, parseErrors, { allowTrailingComma: true })
    } catch (err) {
      // Same CWE-117 rationale as the read catch above: jsonc-parser's
      // RangeError text is library-controlled today but the file path /
      // surrounding context interpolated by future error messages is not, so
      // sanitize at the source rather than relying on the coordinator sink.
      const detail = err instanceof Error ? err.message : String(err)
      errors.push(`[pantheon] ${safePath}: failed to parse — ${neutralizeUntrustedOutput(detail)}`)
      continue
    }

    if (parseErrors.length > 0) {
      const detail = parseErrors
        .map((e) => `${jsoncParser.printParseErrorCode(e.error)} at ${offsetToLineCol(raw, e.offset)}`)
        .join(", ")
      errors.push(`[pantheon] ${safePath}: failed to parse — ${neutralizeUntrustedOutput(detail)}`)
      continue
    }

    const { config, errors: fileErrors } = validateConfigFile(parsed, filePath)
    for (const e of fileErrors) errors.push(e)

    for (const [name, agent] of Object.entries(config.agents)) {
      result.agents[name] = agent
    }
  }

  return { config: result, errors }
}
