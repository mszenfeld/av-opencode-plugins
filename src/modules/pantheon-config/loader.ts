import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import * as jsoncParser from "jsonc-parser"
import { type PantheonConfig, validateConfigFile } from "./schema.js"
import { userGlobalPath, walkUpProjectPaths } from "./paths.js"

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

    let raw: string
    try {
      raw = readFileSync(filePath, "utf8")
    } catch (err) {
      errors.push(
        `[pantheon] ${filePath}: failed to read — ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }

    const parseErrors: jsoncParser.ParseError[] = []
    const parsed = jsoncParser.parse(raw, parseErrors, { allowTrailingComma: true })

    if (parseErrors.length > 0) {
      const detail = parseErrors
        .map((e) => `${jsoncParser.printParseErrorCode(e.error)}@${e.offset}`)
        .join(", ")
      errors.push(`[pantheon] ${filePath}: failed to parse — ${detail}`)
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
