/**
 * Pure path resolution for pantheon.json discovery. No I/O happens here —
 * callers (loader.ts) are responsible for actually checking existence and
 * reading content.
 */
declare function userGlobalPath(homedir?: string): string;
/**
 * Returns the ordered list of `.opencode/pantheon.json` paths from `startDir`
 * walking up to `homedir` (inclusive). Output is closest-first — the first
 * entry is the most specific. If `startDir` is outside `homedir`, walks to
 * the filesystem root (where `dirname(x) === x`).
 */
declare function walkUpProjectPaths(startDir: string, homedir?: string): string[];

export { userGlobalPath, walkUpProjectPaths };
