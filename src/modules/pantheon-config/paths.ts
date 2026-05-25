import os from "node:os"
import path from "node:path"

/**
 * Pure path resolution for pantheon.json discovery. No I/O happens here —
 * callers (loader.ts) are responsible for actually checking existence and
 * reading content.
 */

export function userGlobalPath(homedir: string = os.homedir()): string {
  return path.join(homedir, ".config", "opencode", "pantheon.json")
}

/**
 * Returns the ordered list of `.opencode/pantheon.json` paths from `startDir`
 * walking up to `homedir` (inclusive). Output is closest-first — the first
 * entry is the most specific. If `startDir` is outside `homedir`, walks to
 * the filesystem root (where `dirname(x) === x`).
 */
export function walkUpProjectPaths(
  startDir: string,
  homedir: string = os.homedir(),
): string[] {
  const paths: string[] = []
  let cur = path.resolve(startDir)
  const stopAt = path.resolve(homedir)

  while (true) {
    paths.push(path.join(cur, ".opencode", "pantheon.json"))
    if (cur === stopAt) break
    const parent = path.dirname(cur)
    if (parent === cur) break // filesystem root
    cur = parent
  }

  return paths
}
