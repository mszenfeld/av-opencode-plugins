import { PantheonConfig } from './schema.js';

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
declare function offsetToLineCol(src: string, offset: number): string;
/**
 * No-cache, side-effect-explicit loader. `loadPantheonConfig` in index.ts
 * wraps this with a module-scope cache. Tests call `loadFresh` directly so
 * each test starts from a clean slate.
 *
 * Reads user-global first (base), then project paths from furthest to
 * closest. Closest entry wins per agent.
 */
type LoadFreshOptions = {
    /** Defaults to process.cwd(). */
    startDir?: string;
    /** Defaults to os.homedir(). */
    homedir?: string;
};
type LoadResult = {
    config: PantheonConfig;
    errors: string[];
};
declare function loadFresh(options?: LoadFreshOptions): LoadResult;

export { type LoadFreshOptions, type LoadResult, loadFresh, offsetToLineCol };
