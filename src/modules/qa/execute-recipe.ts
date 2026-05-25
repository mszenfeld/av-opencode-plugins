import type { BindingsStore } from "./bindings-store.js"
import type { QaRunState } from "./qa-run-state.js"
import { scrubSecrets } from "./scrubber.js"

const NULLISH_LITERALS = new Set(["null", "undefined", "none", "nil", "nan", "(null)"])

export interface BashResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface ExecuteRecipeDeps {
  store: BindingsStore
  state: QaRunState
  resolveParentID: (sessionID: string) => Promise<string | undefined>
  runBash: (cmd: string, env: Record<string, string>) => Promise<BashResult>
  processEnv: Record<string, string | undefined>
  nowMs: () => number
}

export interface ExecuteRecipeArgs {
  binding_name: string
}

export type ExecuteRecipeResult =
  | { status: "ok" }
  | { status: "need_info"; missing: string[] }
  | { status: "recipe_failed"; reason: string; stderr_tail: string }
  | { status: "unknown_binding" }

export interface ExecuteRecipeContext {
  sessionID: string
}

const MAX_ATTEMPTS = 3
const TIMEOUT_MS = 30_000

export function makeExecuteRecipeHandler(
  deps: ExecuteRecipeDeps,
): (a: ExecuteRecipeArgs, c: ExecuteRecipeContext) => Promise<ExecuteRecipeResult> {
  return async (args, ctx) => {
    const parentID = (await deps.resolveParentID(ctx.sessionID)) ?? ctx.sessionID
    const bindings = deps.state.getBindings(parentID) ?? []
    const target = bindings.find((b) => b.name === args.binding_name)
    if (target === undefined) return { status: "unknown_binding" }

    // Resolve inputs from BindingsStore first, then process env.
    const composedEnv: Record<string, string> = {}
    const missing: string[] = []
    for (const inputName of target.inputs) {
      const bound = deps.store.getBinding(parentID, inputName)
      if (bound !== undefined) {
        composedEnv[inputName] = bound.value.unwrap()
        continue
      }
      const fromEnv = deps.processEnv[inputName]
      if (typeof fromEnv === "string" && fromEnv.length > 0) {
        composedEnv[inputName] = fromEnv
        continue
      }
      missing.push(inputName)
    }
    if (missing.length > 0) return { status: "need_info", missing }

    // Bounded attempts.
    const attempts = deps.state.incrementRecipeAttempt(parentID, args.binding_name)
    if (attempts > MAX_ATTEMPTS) {
      return { status: "recipe_failed", reason: "max_attempts", stderr_tail: "" }
    }

    // Run with timeout.
    const result = await Promise.race([
      deps.runBash(target.recipe, composedEnv),
      new Promise<BashResult>((resolve) =>
        setTimeout(() => resolve({ exitCode: 124, stdout: "", stderr: "timeout" }), TIMEOUT_MS),
      ),
    ])

    const scrubbedStderr = scrubSecrets(result.stderr.slice(-200), parentID, deps.store)

    if (result.exitCode === 124) {
      return { status: "recipe_failed", reason: "timeout", stderr_tail: scrubbedStderr }
    }
    if (result.exitCode !== 0) {
      return { status: "recipe_failed", reason: `exit_code=${result.exitCode}`, stderr_tail: scrubbedStderr }
    }

    const trimmed = result.stdout.replace(/\n$/, "").trim()
    if (trimmed.length === 0) {
      return { status: "recipe_failed", reason: "invalid_output: empty", stderr_tail: scrubbedStderr }
    }
    if (NULLISH_LITERALS.has(trimmed.toLowerCase())) {
      return { status: "recipe_failed", reason: `invalid_output: nullish ('${trimmed}')`, stderr_tail: scrubbedStderr }
    }
    if (trimmed.length > 4096) {
      return { status: "recipe_failed", reason: "invalid_output: too long", stderr_tail: scrubbedStderr }
    }

    const write = deps.store.writeBinding(parentID, args.binding_name, trimmed, target.type, "minted-recipe")
    if (write.status === "error") {
      return { status: "recipe_failed", reason: `register_failed: ${write.reason}`, stderr_tail: scrubbedStderr }
    }
    return { status: "ok" }
  }
}
