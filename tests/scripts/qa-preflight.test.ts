import { spawn } from "node:child_process"
import { describe, expect, it } from "vitest"

// NOTE: The script path below is resolved against the shell CWD. This test
// assumes vitest is invoked from the project root (its default CWD), which is
// how `npm run test` and CI both run it. If you run vitest from a non-root
// directory the spawn() call will fail with ENOENT — the test is not portable
// to arbitrary CWDs by design. See AGENTS.md → "Working directory assumption
// for repo-relative script paths".
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

  // SEC-006: defense-in-depth env var name validation. Perun pre-validates
  // names against `^[A-Z_][A-Z0-9_]*$`; the script defends against any
  // caller that might pass an invalid name.
  it("rejects lowercase env var names (SEC-006: invalid env var name)", async () => {
    const { stdout, exitCode } = await runPreflight(`env\tlowercase_var\n`)
    expect(exitCode).toBe(0)
    expect(stdout).toContain("MISSING env:lowercase_var (invalid env var name)")
  })

  it("rejects env var names starting with a digit (SEC-006)", async () => {
    const { stdout, exitCode } = await runPreflight(`env\t1FOO\n`)
    expect(exitCode).toBe(0)
    expect(stdout).toContain("MISSING env:1FOO (invalid env var name)")
  })

  it("rejects env var names containing special characters (SEC-006)", async () => {
    const { stdout, exitCode } = await runPreflight(`env\tFOO-BAR\n`)
    expect(exitCode).toBe(0)
    expect(stdout).toContain("MISSING env:FOO-BAR (invalid env var name)")
  })

  it("accepts a valid env var name and proceeds to the printenv check (SEC-006)", async () => {
    // Positive case: a syntactically valid name (uppercase letter start,
    // digits/underscores allowed) must NOT be rejected by the name guard
    // and must reach the normal OK/MISSING reporting path.
    const { stdout, exitCode } = await runPreflight(
      `env\tVALID_VAR\n`,
      { VALID_VAR: "any-value" },
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain("OK env:VALID_VAR")
    expect(stdout).not.toMatch(/invalid env var name/)
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

  it("rejects service URLs that start with a dash (argument-injection guard)", async () => {
    // Without the scheme guard, curl would interpret `-K/tmp/cfg` as
    // "read config file from /tmp/cfg" (CWE-88: argument injection).
    const { stdout } = await runPreflight(`service\t-K/tmp/cfg\n`)
    expect(stdout).toMatch(/MISSING service:-K\/tmp\/cfg \(unsupported scheme/)
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
    const dsn = "postgresql://user:pass@127.0.0.1:5432/mydb"
    const { stdout } = await runPreflight(`db\t${dsn}\n`)
    const lines = stdout.trim().split("\n").filter(Boolean)
    expect(lines).toHaveLength(1)
    const [line] = lines
    if (line === undefined) throw new Error("unreachable: lines length asserted above")
    // Either OK or MISSING — but the full DSN must round-trip verbatim.
    // The alternation is necessary because pg_isready may or may not be
    // installed locally, but the assertion still verifies parser correctness
    // by requiring the DSN to appear unmodified.
    expect(line).toMatch(
      /^(OK|MISSING) db:postgresql:\/\/user:pass@127\.0\.0\.1:5432\/mydb(\s|$)/,
    )
    // Defense in depth: strip the literal DSN and assert no credential
    // artefact (e.g. `pass@host` leaking from a garbled host extraction)
    // remains in the reported line.
    const residue = line.split(dsn).join("")
    expect(residue).not.toMatch(/pass@/)
    expect(residue).not.toMatch(/ss@/)
  })

  it("parses postgresql DSN whose password contains a literal '@' (greedy userinfo strip)", async () => {
    // Regression test for MAINT-005: a non-greedy `${rest#*@}` would strip
    // only the FIRST `@`, leaving `ss@127.0.0.1:5432/mydb` as `rest` and
    // garbling the host. The greedy `${rest##*@}` strips up to the LAST `@`,
    // which per RFC 3986 is always the userinfo/host separator (any literal
    // `@` inside userinfo must be percent-encoded).
    const dsn = "postgresql://user:pa@ss@127.0.0.1:5432/mydb"
    const { stdout } = await runPreflight(`db\t${dsn}\n`)
    const lines = stdout.trim().split("\n").filter(Boolean)
    expect(lines).toHaveLength(1)
    const [line] = lines
    if (line === undefined) throw new Error("unreachable: lines length asserted above")
    // Full DSN must round-trip verbatim — proves the parser didn't mangle it.
    expect(line).toMatch(
      /^(OK|MISSING) db:postgresql:\/\/user:pa@ss@127\.0\.0\.1:5432\/mydb(\s|$)/,
    )
    // Defense in depth: strip the literal DSN and assert no host-extraction
    // artefact (e.g. `ss@127.0.0.1` from a non-greedy strip) leaks in the
    // remaining text. Also assert no IPv6 false-positive: the script must
    // NOT report this as an IPv6 DSN.
    const residue = line.split(dsn).join("")
    expect(residue).not.toMatch(/ss@/)
    expect(residue).not.toMatch(/127\.0\.0\.1/)
    expect(line).not.toMatch(/IPv6/)
  })

  it.each([
    ["postgresql", "postgresql://[::1]:5432/mydb"],
    ["postgresql with credentials", "postgresql://user:pass@[::1]:5432/mydb"],
    ["mysql", "mysql://[::1]:3306/mydb"],
    ["redis", "redis://[::1]:6379"],
  ])(
    "rejects IPv6 DSNs with a clear MISSING message (%s)",
    async (_label, dsn) => {
      // The colon-split host:port parsing cannot disambiguate `:` inside
      // `[::1]` from the port separator, so IPv6 DSNs are rejected early
      // rather than silently producing a garbled host. See MAINT-003.
      const { stdout } = await runPreflight(`db\t${dsn}\n`)
      const lines = stdout.trim().split("\n").filter(Boolean)
      expect(lines).toHaveLength(1)
      const [line] = lines
      if (line === undefined) throw new Error("unreachable: lines length asserted above")
      // Full DSN must round-trip verbatim in the message.
      expect(line).toContain(`MISSING db:${dsn}`)
      expect(line).toMatch(/IPv6 DSNs not yet supported/)
    },
  )

  it("rejects sqlite DSNs with an absolute path (SEC-003 file-existence oracle)", async () => {
    // SQLAlchemy 4-slash form (`sqlite:////etc/passwd`) means an absolute
    // filesystem path. Without a guard, the script's `[ -r "$path" ]` probe
    // becomes an oracle for the existence of arbitrary world-readable files
    // on the host (CWE-200). The allowlist rejects absolute paths outright.
    const { stdout } = await runPreflight(`db\tsqlite:////etc/passwd\n`)
    expect(stdout).toContain("MISSING db:sqlite:////etc/passwd")
    expect(stdout).toMatch(/sqlite path must be project-relative/)
  })

  it("rejects sqlite DSNs containing '..' traversal (SEC-003)", async () => {
    // Even if a path is nominally project-relative, `..` segments can escape
    // upward into arbitrary parent directories. Reject any DSN containing
    // `..` to keep the allowlist tight.
    const { stdout } = await runPreflight(`db\tsqlite:///../etc/passwd\n`)
    expect(stdout).toContain("MISSING db:sqlite:///../etc/passwd")
    expect(stdout).toMatch(/sqlite path must be project-relative/)
  })

  it("accepts sqlite DSNs with a project-relative path (SEC-003)", async () => {
    // Positive case: the 3-slash form (`sqlite:///<relative-path>`) with a
    // path that exists in the workspace must report OK. Uses this very test
    // file as the probe target so the test is self-contained.
    const { stdout } = await runPreflight(
      `db\tsqlite:///./tests/scripts/qa-preflight.test.ts\n`,
    )
    expect(stdout).toContain("OK db:sqlite:///./tests/scripts/qa-preflight.test.ts")
  })

  it("parses redis DSN without explicit port (falls back to default 6379)", async () => {
    // Same idea: assert the script processes the DSN without crashing.
    // Without an explicit port, parsing used to set port=host; the fix
    // should fall back to 6379.
    const dsn = "redis://127.0.0.1"
    const { stdout } = await runPreflight(`db\t${dsn}\n`)
    const lines = stdout.trim().split("\n").filter(Boolean)
    expect(lines).toHaveLength(1)
    const [line] = lines
    if (line === undefined) throw new Error("unreachable: lines length asserted above")
    // The full DSN must round-trip verbatim regardless of OK/MISSING.
    expect(line).toMatch(/^(OK|MISSING) db:redis:\/\/127\.0\.0\.1(\s|$)/)
    // Defense in depth: no host-extraction artefact may leak.
    // If parsing wrongly set port=host, the line would contain `127.0.0.1:127.0.0.1`.
    const residue = line.split(dsn).join("")
    expect(residue).not.toMatch(/127\.0\.0\.1/)
  })
})
