import { describe, it, expect } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { QaRunState } from "../../../src/modules/qa/qa-run-state.js"
import { makeExecuteRecipeHandler } from "../../../src/modules/qa/execute-recipe.js"
import type { ParsedBinding } from "../../../src/modules/qa/binding-parser.js"

const tokenBinding: ParsedBinding = {
  name: "QA_BIND_TOKEN", type: "secret", description: "test",
  inputs: ["TEST_USER_EMAIL", "TEST_USER_PASSWORD"], egress: "$URL",
  recipe: `curl --data-urlencode "email=$TEST_USER_EMAIL" "$URL" | jq -er .access_token`,
}

function makeHandler(opts: {
  store?: BindingsStore
  state?: QaRunState
  parent?: string
  bashRun?: (cmd: string, env: Record<string, string>) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  processEnv?: Record<string, string | undefined>
}) {
  const store = opts.store ?? new BindingsStore()
  const state = opts.state ?? new QaRunState()
  state.storePlan(opts.parent ?? "p1", [tokenBinding])
  return makeExecuteRecipeHandler({
    store, state,
    resolveParentID: async () => opts.parent ?? "p1",
    runBash: opts.bashRun ?? (async () => ({ exitCode: 0, stdout: "TOKEN_VALUE", stderr: "" })),
    processEnv: opts.processEnv ?? {},
    nowMs: () => 1000,
  })
}

describe("execute_recipe handler", () => {
  it("returns need_info when an input is missing", async () => {
    const handler = makeHandler({})
    const result = await handler({ binding_name: "QA_BIND_TOKEN" }, { sessionID: "zmora-1" })
    expect(result.status).toBe("need_info")
    if (result.status === "need_info") {
      expect(result.missing).toContain("TEST_USER_EMAIL")
      expect(result.missing).toContain("TEST_USER_PASSWORD")
    }
  })

  it("runs recipe and registers binding atomically when all inputs present", async () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "TEST_USER_EMAIL", "foo@bar.com", "secret", "user-paste")
    store.writeBinding("p1", "TEST_USER_PASSWORD", "secret123", "secret", "user-paste")
    const handler = makeHandler({ store })
    const result = await handler({ binding_name: "QA_BIND_TOKEN" }, { sessionID: "zmora-1" })
    expect(result.status).toBe("ok")
    expect(store.getBinding("p1", "QA_BIND_TOKEN")?.value.unwrap()).toBe("TOKEN_VALUE")
    expect(store.getBinding("p1", "QA_BIND_TOKEN")?.type).toBe("secret")
    expect(store.getBinding("p1", "QA_BIND_TOKEN")?.source).toBe("minted-recipe")
  })

  it("returns recipe_failed on non-zero exit", async () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "TEST_USER_EMAIL", "x", "secret", "user-paste")
    store.writeBinding("p1", "TEST_USER_PASSWORD", "y", "secret", "user-paste")
    const handler = makeHandler({
      store,
      bashRun: async () => ({ exitCode: 1, stdout: "", stderr: "jq: parse error" }),
    })
    const result = await handler({ binding_name: "QA_BIND_TOKEN" }, { sessionID: "zmora-1" })
    expect(result.status).toBe("recipe_failed")
    if (result.status === "recipe_failed") {
      expect(result.reason).toContain("exit_code")
      expect(result.stderr_tail).toContain("jq: parse error")
    }
  })

  it("rejects literal 'null' stdout", async () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "TEST_USER_EMAIL", "x", "secret", "user-paste")
    store.writeBinding("p1", "TEST_USER_PASSWORD", "y", "secret", "user-paste")
    const handler = makeHandler({
      store,
      bashRun: async () => ({ exitCode: 0, stdout: "null\n", stderr: "" }),
    })
    const result = await handler({ binding_name: "QA_BIND_TOKEN" }, { sessionID: "zmora-1" })
    expect(result.status).toBe("recipe_failed")
    if (result.status === "recipe_failed") {
      expect(result.reason).toMatch(/invalid_output|nullish/)
    }
  })

  it("returns unknown_binding when name not in plan", async () => {
    const handler = makeHandler({})
    const result = await handler({ binding_name: "QA_BIND_NOT_DECLARED" }, { sessionID: "zmora-1" })
    expect(result.status).toBe("unknown_binding")
  })

  it("scrubs stderr_tail against current bindings before returning", async () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "TEST_USER_EMAIL", "x", "secret", "user-paste")
    store.writeBinding("p1", "TEST_USER_PASSWORD", "MyVeryLongSecretPasswordXYZ123", "secret", "user-paste")
    const handler = makeHandler({
      store,
      bashRun: async () => ({ exitCode: 1, stdout: "", stderr: "curl error: pwd=MyVeryLongSecretPasswordXYZ123 failed" }),
    })
    const result = await handler({ binding_name: "QA_BIND_TOKEN" }, { sessionID: "zmora-1" })
    if (result.status === "recipe_failed") {
      expect(result.stderr_tail).not.toContain("MyVeryLongSecretPasswordXYZ123")
      expect(result.stderr_tail).toContain("[REDACTED:TEST_USER_PASSWORD]")
    }
  })
})
