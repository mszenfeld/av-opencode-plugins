import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { makeRunBash } from "../../../src/modules/qa/run-bash.js"

// CWE-404: the previous `Promise.race`-based timeout in
// `execute-recipe.ts` resolved with `exitCode: 124` but let the underlying
// `bash` child keep running. These tests prove the new `makeRunBash` path:
//   - returns exit code 124 on timeout (contract preserved), AND
//   - actually terminates the bash child (the regression).

/**
 * Returns true iff PID `pid` is currently alive (any state). On POSIX,
 * `kill -0` is the canonical, signal-free liveness probe. Returns false on
 * ESRCH (process gone) or EPERM (gone & recycled to another uid). We avoid
 * `pgrep -af` here because the search pattern itself becomes part of
 * `pgrep`'s argv on macOS, producing false positives that match the marker
 * in the *parent* Node process or the pgrep invocation.
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === "ESRCH" || code === "EPERM") return false
    throw e
  }
}

/**
 * Find a child PID of `parentPid` matching a command-line substring. Uses
 * `ps` directly with `-o pid,ppid,command` so we don't depend on pgrep's
 * matching semantics. Returns 0 if no match.
 */
function findChildPid(parentPid: number, cmdContains: string): number {
  const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], {
    encoding: "utf8",
  })
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
    if (!m) continue
    const pid = Number(m[1])
    const ppid = Number(m[2])
    const cmd = m[3] ?? ""
    if (ppid === parentPid && cmd.includes(cmdContains)) return pid
  }
  return 0
}

describe("makeRunBash — timeout enforcement", () => {
  it("returns exitCode 124 when the recipe exceeds the wall-clock cap", async () => {
    const runBash = makeRunBash({ timeoutMs: 100 })
    const result = await runBash("sleep 5", {})
    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain("[killed by timeout]")
  })

  it("actually terminates the bash child on timeout (no leaked process)", async () => {
    // Distinctive sleep duration we can recognise on this host without
    // matching unrelated sleeps a developer might already have running.
    const sleepSecs = 4242
    const runBash = makeRunBash({ timeoutMs: 100 })

    // Snapshot a child PID for our spawned bash by polling between spawn
    // and timeout. Since `makeRunBash` doesn't expose the PID, we discover
    // it via `ps` filtered on our Node parent + the unique sleep duration.
    const myPid = process.pid
    let observedChild = 0
    const watcher = setInterval(() => {
      if (observedChild !== 0) return
      observedChild = findChildPid(myPid, `sleep ${sleepSecs}`)
    }, 20)

    const result = await runBash(`sleep ${sleepSecs}`, {})
    clearInterval(watcher)

    expect(result.exitCode).toBe(124)
    expect(observedChild).toBeGreaterThan(0) // we caught it while alive

    // After the kill, the child must actually be gone. Give the OS up to
    // ~1s to deliver SIGTERM → SIGKILL escalation; in practice it's
    // single-digit milliseconds.
    const deadline = Date.now() + 1000
    while (Date.now() < deadline && isAlive(observedChild)) {
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(isAlive(observedChild)).toBe(false)
  })

  it("does NOT raise the kill path on a fast recipe (timer cleared on happy path)", async () => {
    const runBash = makeRunBash({ timeoutMs: 5_000 })
    const result = await runBash("printf hello", {})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("hello")
    expect(result.stderr).not.toContain("[killed by timeout]")
  })

  it("surfaces non-zero exit codes without flagging timeout", async () => {
    const runBash = makeRunBash({ timeoutMs: 5_000 })
    const result = await runBash("exit 7", {})
    expect(result.exitCode).toBe(7)
    expect(result.stderr).not.toContain("[killed by timeout]")
  })
})

describe("makeRunBash — output byte ceiling (PERF-001 / CWE-400)", () => {
  it("caps high-volume stdout and kills the child early", async () => {
    // `yes` emits unbounded output far faster than the 5s timeout; with a
    // tiny cap the run must terminate on the output ceiling, NOT the clock.
    const cap = 4096
    const runBash = makeRunBash({ timeoutMs: 5_000, maxOutputBytes: cap })

    const start = Date.now()
    const result = await runBash("yes AAAAAAAAAAAAAAAA", {})
    const elapsed = Date.now() - start

    // Output is capped at the ceiling (never the full unbounded stream).
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(cap)
    // Treated like the timeout/abort path so execute-recipe buckets it as
    // a benign resource ceiling rather than an arbitrary recipe exit code.
    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain(`[killed: output exceeded ${cap} bytes]`)
    // Killed on the cap, well before the 5s wall-clock would ever fire.
    expect(elapsed).toBeLessThan(4_000)
  })

  it("caps high-volume stderr and kills the child early", async () => {
    const cap = 4096
    const runBash = makeRunBash({ timeoutMs: 5_000, maxOutputBytes: cap })

    const result = await runBash("yes AAAAAAAAAAAAAAAA 1>&2", {})

    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(
      cap + `\n[killed: output exceeded ${cap} bytes]`.length,
    )
    expect(result.exitCode).toBe(124)
    expect(result.stderr).toContain(`[killed: output exceeded ${cap} bytes]`)
  })

  it("does NOT cap or kill a normal small-output recipe", async () => {
    // Default cap is 1 MiB; a small recipe stays well under it and must
    // return its real stdout and exit code untouched.
    const runBash = makeRunBash({ timeoutMs: 5_000, maxOutputBytes: 1024 * 1024 })
    const result = await runBash("printf 'small output'", {})

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("small output")
    expect(result.stderr).not.toContain("output exceeded")
    expect(result.stderr).not.toContain("[killed by timeout]")
  })

  it("preserves a non-zero exit code for output well under the cap", async () => {
    const runBash = makeRunBash({ timeoutMs: 5_000, maxOutputBytes: 1024 * 1024 })
    const result = await runBash("printf 'partial'; exit 3", {})

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toBe("partial")
    expect(result.stderr).not.toContain("output exceeded")
  })
})
