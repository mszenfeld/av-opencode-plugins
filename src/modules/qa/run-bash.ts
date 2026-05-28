import type { BashResult } from "./execute-recipe.js"
import { buildChildEnv } from "./child-env.js"

// Wall-clock cap on a single bash recipe. Default is conservative (30s); the
// factory takes an override for tests that need a tight loop without
// depending on real time. Enforced INSIDE `runBash` via AbortController so the
// child is actually killed on timeout — a previous `Promise.race`-based
// guard (CWE-404) resolved with exitCode 124 but leaked the
// running bash child past resolution.
export const DEFAULT_BASH_TIMEOUT_MS = 30_000

// Per-stream byte ceiling on accumulated child output (CWE-400).
// `child.stdout`/`stderr` were previously appended with unbounded string
// concatenation, bounded only by the wall-clock timeout — a recipe spewing
// high-volume output (`yes`, `base64 /dev/urandom`) could grow process memory
// for the full timeout window before the downstream `too long > 4096` check
// in `execute-recipe.ts` ever ran (that check only fires AFTER full
// accumulation, so it does not protect memory). 1 MiB sits comfortably above
// the legitimate 4096-byte output ceiling enforced downstream while capping a
// runaway child at a bounded footprint.
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

export interface RunBashOptions {
  /** Wall-clock cap in ms. Defaults to {@link DEFAULT_BASH_TIMEOUT_MS}. */
  timeoutMs?: number
  /**
   * Per-stream byte ceiling on accumulated stdout/stderr. Once either stream
   * crosses this cap, further bytes are dropped and the child process group is
   * killed early (via the same AbortController path as the timeout). Defaults
   * to {@link DEFAULT_MAX_OUTPUT_BYTES}.
   */
  maxOutputBytes?: number
  /** Host env passed through `buildChildEnv`'s allowlist. Defaults to `process.env`. */
  hostEnv?: Record<string, string | undefined>
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
export function makeRunBash(
  opts: RunBashOptions = {},
): (cmd: string, env: Record<string, string>) => Promise<BashResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const hostEnv = opts.hostEnv ?? process.env
  return async (cmd, env) => {
    // Bash execution via Node child_process. The child env is built by
    // `buildChildEnv`: only an allowlisted subset of the host
    // env (PATH, HOME, locale, …) is passed through, and the composed env
    // (recipe inputs + minted bindings) is layered on top. The full
    // process.env is NOT inherited — this contains the host's API keys,
    // cloud creds, kubeconfig path, etc., which the recipe must not see
    // even if it manages to escape the parser allowlist.
    const { spawn } = await import("node:child_process")
    // We spawn the child in its OWN process group (`detached: true` on
    // POSIX). That lets us kill the entire subtree on timeout — `bash -c
    // "sleep 60"` forks a `sleep` grandchild that survives a plain
    // SIGTERM to bash. AbortController.signal alone wouldn't reach
    // descendants, so we keep manual `process.kill(-pid, …)` for the
    // group-wide reap. `signal` is still wired as a belt-and-braces guard
    // (e.g. spawn-time aborts).
    let timedOut = false
    let outputCapped = false
    let killed = false
    const controller = new AbortController()
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    // `unref` lets Node exit if the timer is the only handle left; this
    // matches the behaviour of other background timers in this plugin.
    timer.unref?.()
    try {
      return await new Promise<BashResult>((resolve) => {
        const child = spawn("bash", ["-c", cmd], {
          env: buildChildEnv(hostEnv, env),
          stdio: ["ignore", "pipe", "pipe"],
          signal: controller.signal,
          detached: true,
        })
        let stdout = ""
        let stderr = ""
        // Track accumulated bytes per stream (not string `.length`, which
        // counts UTF-16 code units). Once either stream would cross
        // `maxOutputBytes` we append only up to the cap, flag the overflow,
        // and abort — reusing the controller so the existing detached-group
        // kill path reaps the runaway child instead of a parallel mechanism.
        let stdoutBytes = 0
        let stderrBytes = 0
        const capStream = (
          buf: string,
          accBytes: number,
          chunk: Buffer,
        ): { buf: string; bytes: number } => {
          if (outputCapped) return { buf, bytes: accBytes } // already aborting; drop
          const remaining = maxOutputBytes - accBytes
          if (chunk.length <= remaining) {
            return { buf: buf + chunk.toString(), bytes: accBytes + chunk.length }
          }
          // This chunk crosses the ceiling: keep only the bytes that fit,
          // then trigger the early kill. Slice on the Buffer (byte-accurate)
          // before decoding so we never retain more than the cap.
          outputCapped = true
          const kept = remaining > 0 ? buf + chunk.subarray(0, remaining).toString() : buf
          controller.abort()
          return { buf: kept, bytes: maxOutputBytes }
        }
        child.stdout?.on("data", (d: Buffer) => {
          const r = capStream(stdout, stdoutBytes, d)
          stdout = r.buf
          stdoutBytes = r.bytes
        })
        child.stderr?.on("data", (d: Buffer) => {
          const r = capStream(stderr, stderrBytes, d)
          stderr = r.buf
          stderrBytes = r.bytes
        })

        const killGroup = (sig: NodeJS.Signals): void => {
          if (killed) return
          killed = true
          // Negative PID → POSIX kill targets the process group, so bash
          // AND any descendants (sleep, curl, jq, …) receive the signal.
          // `child.pid` can be undefined if spawn failed; bail in that
          // case (the `error` handler will fire and resolve the promise).
          if (typeof child.pid !== "number") return
          try {
            process.kill(-child.pid, sig)
          } catch {
            // ESRCH: group already gone (race with `close`). Safe to ignore.
          }
        }

        // When the timer fires, escalate: SIGTERM first to give bash a
        // chance to flush; if it doesn't die quickly enough, SIGKILL the
        // group so we don't leak past `Promise` resolution.
        const onAbort = (): void => {
          killGroup("SIGTERM")
          const escalate = setTimeout(() => killGroup("SIGKILL"), 250)
          escalate.unref?.()
        }
        if (controller.signal.aborted) onAbort()
        else controller.signal.addEventListener("abort", onAbort, { once: true })

        // Build the abort marker: the output-cap kill takes precedence over
        // the generic timeout marker so the cause is unambiguous downstream.
        const abortMarker = (): string =>
          outputCapped ? `\n[killed: output exceeded ${maxOutputBytes} bytes]` : "\n[killed by timeout]"
        child.on("close", (code, sig) => {
          // Treat the timeout/cap flags as the source of truth: if our timer
          // fired OR we hit the output ceiling we surface 124 regardless of
          // what Node reports (Node sometimes reports `null` signal when
          // AbortController kills).
          const wasKilled = timedOut || outputCapped || sig !== null
          const exitCode = wasKilled ? 124 : (code ?? -1)
          const stderrOut = wasKilled ? stderr + abortMarker() : stderr
          resolve({ exitCode, stdout, stderr: stderrOut })
        })
        child.on("error", (err) => {
          // `spawn` emits ENOENT / ERR_INVALID_ARG_TYPE here, and also
          // synthesises `AbortError` when the signal aborts before spawn
          // is fully wired. Surface AbortError as a timeout (124) to keep
          // the contract uniform with the `close`-path branch above.
          const isAbort =
            (err as NodeJS.ErrnoException).code === "ABORT_ERR" || err.name === "AbortError"
          if (isAbort || timedOut || outputCapped) {
            resolve({ exitCode: 124, stdout, stderr: stderr + abortMarker() })
            return
          }
          resolve({ exitCode: -1, stdout, stderr: stderr + err.message })
        })
      })
    } finally {
      clearTimeout(timer)
    }
  }
}
