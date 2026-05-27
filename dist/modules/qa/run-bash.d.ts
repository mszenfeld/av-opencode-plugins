import { BashResult } from './execute-recipe.js';
import './bindings-store.js';
import './secret.js';
import './qa-run-state.js';
import './binding-parser.js';
import './recipe-validator.js';

declare const DEFAULT_BASH_TIMEOUT_MS = 30000;
declare const DEFAULT_MAX_OUTPUT_BYTES: number;
interface RunBashOptions {
    /** Wall-clock cap in ms. Defaults to {@link DEFAULT_BASH_TIMEOUT_MS}. */
    timeoutMs?: number;
    /**
     * Per-stream byte ceiling on accumulated stdout/stderr. Once either stream
     * crosses this cap, further bytes are dropped and the child process group is
     * killed early (via the same AbortController path as the timeout). Defaults
     * to {@link DEFAULT_MAX_OUTPUT_BYTES}.
     */
    maxOutputBytes?: number;
    /** Host env passed through `buildChildEnv`'s allowlist. Defaults to `process.env`. */
    hostEnv?: Record<string, string | undefined>;
}
/**
 * Build a `runBash` matching the {@link ExecuteRecipeDeps.runBash} contract:
 * spawns `bash -c <cmd>`, returns `{exitCode, stdout, stderr}`, and enforces
 * a wall-clock timeout that actually kills the child (signal/abort, not just
 * a Promise.race that lets the process keep running).
 *
 * Returned `exitCode`:
 *   - normal close: child's exit code (or `-1` if Node reports null)
 *   - timeout / abort: `124` — matches the legacy contract `execute-recipe`
 *     branches on for the `recipe_failed`/`timeout` result.
 *   - spawn-level failure (ENOENT, ERR_INVALID_ARG_TYPE): `-1`, with the
 *     error message appended to stderr.
 *
 * `stderr` is augmented with `\n[killed by timeout]` whenever the abort path
 * fires so downstream scrub/tail logic surfaces a clear cause.
 *
 * Output-cap kill (CWE-400): if either stream exceeds
 * `maxOutputBytes`, the excess bytes are dropped, the child group is killed via
 * the same abort path, and the result mirrors the timeout branch —
 * `exitCode: 124` with a distinct `\n[killed: output exceeded N bytes]` marker.
 * We reuse 124 deliberately: `execute-recipe.ts` already buckets 124 as
 * `timeout` (a benign "resource ceiling hit" outcome) rather than
 * `recipe_failed: exit_code=…`, which is the cleanest fit for a runaway recipe.
 */
declare function makeRunBash(opts?: RunBashOptions): (cmd: string, env: Record<string, string>) => Promise<BashResult>;

export { DEFAULT_BASH_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES, type RunBashOptions, makeRunBash };
