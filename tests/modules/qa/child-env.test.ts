import { describe, it, expect } from "vitest"
import { buildChildEnv } from "../../../src/modules/qa/child-env.js"

// COMP-002: The recipe child process must NOT inherit the full host env.
// Only a small allowlist of process-control variables (PATH, HOME, LANG, LC_*,
// TZ) flows through; everything else is dropped unless it appears in the
// composed env (recipe inputs + minted bindings). This prevents a sandbox
// escape inside a recipe from reading ANTHROPIC_API_KEY, AWS_*, KUBECONFIG,
// session tokens, etc.

describe("buildChildEnv", () => {
  it("drops arbitrary host env vars not on the allowlist", () => {
    const hostEnv = {
      ANTHROPIC_API_KEY: "sk-secret",
      AWS_ACCESS_KEY_ID: "AKIA...",
      AWS_SECRET_ACCESS_KEY: "abc",
      KUBECONFIG: "/home/me/.kube/config",
      GITHUB_TOKEN: "ghp_x",
      PATH: "/usr/bin:/bin",
      HOME: "/home/me",
    }
    const env = buildChildEnv(hostEnv, {})
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.KUBECONFIG).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
  })

  it("preserves PATH, HOME, LANG, LC_*, TZ from the host env", () => {
    const hostEnv = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/me",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
      TZ: "UTC",
      // Decoys — must NOT flow through.
      ANTHROPIC_API_KEY: "sk-secret",
    }
    const env = buildChildEnv(hostEnv, {})
    expect(env.PATH).toBe("/usr/bin:/bin")
    expect(env.HOME).toBe("/home/me")
    expect(env.LANG).toBe("en_US.UTF-8")
    expect(env.LC_ALL).toBe("en_US.UTF-8")
    expect(env.LC_CTYPE).toBe("UTF-8")
    expect(env.TZ).toBe("UTC")
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it("includes composed env (binding inputs + minted values)", () => {
    const env = buildChildEnv(
      { PATH: "/usr/bin" },
      { TEST_USER_EMAIL: "foo@bar", QA_BIND_TOKEN: "jwt-value" },
    )
    expect(env.TEST_USER_EMAIL).toBe("foo@bar")
    expect(env.QA_BIND_TOKEN).toBe("jwt-value")
    expect(env.PATH).toBe("/usr/bin")
  })

  it("composed env wins over host env on collision", () => {
    const env = buildChildEnv(
      { PATH: "/usr/bin", BASE_URL: "https://prod.example" },
      { BASE_URL: "https://test.example" },
    )
    expect(env.BASE_URL).toBe("https://test.example")
  })

  it("never returns undefined values from host env", () => {
    const hostEnv: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      HOME: undefined,
      LANG: undefined,
    }
    const env = buildChildEnv(hostEnv, {})
    // Undefined host entries are skipped — the returned record only contains
    // string values, suitable for child_process.spawn(env: {...}).
    expect(env.PATH).toBe("/usr/bin")
    expect(Object.prototype.hasOwnProperty.call(env, "HOME")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(env, "LANG")).toBe(false)
  })
})
