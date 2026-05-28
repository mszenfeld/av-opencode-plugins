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

export function makeExecuteRecipeHandler(
  deps: ExecuteRecipeDeps,
): (a: ExecuteRecipeArgs, c: ExecuteRecipeContext) => Promise<ExecuteRecipeResult> {
  return async (args, ctx) => {
    const parentID = (await deps.resolveParentID(ctx.sessionID)) ?? ctx.sessionID
    const bindings = deps.state.getBindings(parentID) ?? []
    const target = bindings.find((b) => b.name === args.binding_name)
    if (target === undefined) return { status: "unknown_binding" }

    // Re-dispatch to zmora-setup means the prior mid-run dialog round (if
    // any) has concluded — the next `record_input` call should count as a
    // fresh round against the `MAX_DIALOG_ROUNDS` cap.
    deps.state.endDialogRound(parentID)

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

    // Run the recipe. `runBash` owns the wall-clock timeout:
    // it kills the child via AbortController and reports `exitCode: 124`
    // on timeout, so there is no need for a Promise.race guard here that
    // would otherwise leak the underlying bash process past resolution.
    const result = await deps.runBash(target.recipe, composedEnv)

    // Scrub the full stderr BEFORE truncating: `slice(-200)` could otherwise
    // cut a secret in half and let partial bytes survive the scrubber
    // The O(N) full scan is the correct trade-off.
    const scrubbedStderr = scrubSecrets(result.stderr, parentID, deps.store).slice(-200)

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
