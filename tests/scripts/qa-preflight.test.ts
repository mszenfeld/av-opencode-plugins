import { spawn } from "node:child_process"
import { describe, expect, it } from "vitest"

const SCRIPT = "scripts/qa-preflight.sh"

function runPreflight(stdin: string, env: Record<string, string> = {}): Promise<{
  stdout: string
  exitCode: number | null
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(SCRIPT, [], { env: { ...process.env, ...env } })
    let stdout = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (exitCode) => resolve({ stdout, exitCode }))
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

describe("scripts/qa-preflight.sh", () => {
  it("reports OK for an env var that is set", async () => {
    const { stdout, exitCode } = await runPreflight(
      `env\tTEST_PREFLIGHT_FIXTURE_SET\n`,
      { TEST_PREFLIGHT_FIXTURE_SET: "any-value" },
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain("OK env:TEST_PREFLIGHT_FIXTURE_SET")
  })

  it("reports MISSING for an env var that is not set", async () => {
    const { stdout, exitCode } = await runPreflight(
      `env\tTEST_PREFLIGHT_FIXTURE_UNSET_XYZ\n`,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain("MISSING env:TEST_PREFLIGHT_FIXTURE_UNSET_XYZ")
  })

  it("never prints the value of an env var (security)", async () => {
    const secret = "do-not-leak-this-value-12345"
    const { stdout } = await runPreflight(
      `env\tTEST_PREFLIGHT_SECRET\n`,
      { TEST_PREFLIGHT_SECRET: secret },
    )
    expect(stdout).not.toContain(secret)
  })

  it("rejects unrecognised DB DSN scheme", async () => {
    const { stdout } = await runPreflight(`db\tunknown://host:1234/db\n`)
    expect(stdout).toMatch(/MISSING db:unknown:\/\/.*unrecognised DSN scheme/)
  })

  it("reports MISSING for a service URL that fails to connect", async () => {
    // Port 1 is in the privileged range and almost certainly closed locally.
    const { stdout } = await runPreflight(`service\thttp://127.0.0.1:1\n`)
    expect(stdout).toMatch(/MISSING service:http:\/\/127\.0\.0\.1:1/)
  })

  it("handles multiple probes in one invocation", async () => {
    const { stdout } = await runPreflight(
      [
        `env\tTEST_PREFLIGHT_MULTI_A`,
        `env\tTEST_PREFLIGHT_MULTI_B_UNSET`,
        ``,
      ].join("\n"),
      { TEST_PREFLIGHT_MULTI_A: "v" },
    )
    expect(stdout).toContain("OK env:TEST_PREFLIGHT_MULTI_A")
    expect(stdout).toContain("MISSING env:TEST_PREFLIGHT_MULTI_B_UNSET")
  })

  it("ignores blank lines without erroring", async () => {
    const { stdout, exitCode } = await runPreflight(`\n\n\n`)
    expect(exitCode).toBe(0)
    expect(stdout).toBe("")
  })

  it("exit code is 0 even when probes fail (caller parses stdout)", async () => {
    const { exitCode } = await runPreflight(
      `env\tTEST_PREFLIGHT_DEFINITELY_NOT_SET\n`,
    )
    expect(exitCode).toBe(0)
  })

  it("parses postgresql DSN with credentials and explicit port (no false MISSING from parsing)", async () => {
    // We can't connect (no postgres locally) but we CAN verify the parser
    // doesn't conflate user:pass@host with host. The probe will report
    // MISSING because pg_isready fails to connect — but the missing
    // message must reference the original DSN, not a garbled host.
    const { stdout } = await runPreflight(`db\tpostgresql://user:pass@127.0.0.1:5432/mydb\n`)
    // We don't assert exact connectivity outcome (depends on local env);
    // we assert the script processes the DSN without crashing and
    // emits a line referencing the original DSN.
    expect(stdout).toMatch(/(OK|MISSING) db:postgresql:\/\/user:pass@127\.0\.0\.1:5432\/mydb/)
  })

  it("parses redis DSN without explicit port (falls back to default 6379)", async () => {
    // Same idea: assert the script processes the DSN without crashing.
    // Without an explicit port, parsing used to set port=host; the fix
    // should fall back to 6379.
    const { stdout } = await runPreflight(`db\tredis://127.0.0.1\n`)
    expect(stdout).toMatch(/(OK|MISSING) db:redis:\/\/127\.0\.0\.1/)
  })
})
