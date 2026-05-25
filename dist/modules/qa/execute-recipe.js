import { scrubSecrets } from "./scrubber.js";
const NULLISH_LITERALS = /* @__PURE__ */ new Set(["null", "undefined", "none", "nil", "nan", "(null)"]);
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 3e4;
function makeExecuteRecipeHandler(deps) {
  return async (args, ctx) => {
    const parentID = await deps.resolveParentID(ctx.sessionID) ?? ctx.sessionID;
    const bindings = deps.state.getBindings(parentID) ?? [];
    const target = bindings.find((b) => b.name === args.binding_name);
    if (target === void 0) return { status: "unknown_binding" };
    const composedEnv = {};
    const missing = [];
    for (const inputName of target.inputs) {
      const bound = deps.store.getBinding(parentID, inputName);
      if (bound !== void 0) {
        composedEnv[inputName] = bound.value.unwrap();
        continue;
      }
      const fromEnv = deps.processEnv[inputName];
      if (typeof fromEnv === "string" && fromEnv.length > 0) {
        composedEnv[inputName] = fromEnv;
        continue;
      }
      missing.push(inputName);
    }
    if (missing.length > 0) return { status: "need_info", missing };
    const attempts = deps.state.incrementRecipeAttempt(parentID, args.binding_name);
    if (attempts > MAX_ATTEMPTS) {
      return { status: "recipe_failed", reason: "max_attempts", stderr_tail: "" };
    }
    const result = await Promise.race([
      deps.runBash(target.recipe, composedEnv),
      new Promise(
        (resolve) => setTimeout(() => resolve({ exitCode: 124, stdout: "", stderr: "timeout" }), TIMEOUT_MS)
      )
    ]);
    const scrubbedStderr = scrubSecrets(result.stderr.slice(-200), parentID, deps.store);
    if (result.exitCode === 124) {
      return { status: "recipe_failed", reason: "timeout", stderr_tail: scrubbedStderr };
    }
    if (result.exitCode !== 0) {
      return { status: "recipe_failed", reason: `exit_code=${result.exitCode}`, stderr_tail: scrubbedStderr };
    }
    const trimmed = result.stdout.replace(/\n$/, "").trim();
    if (trimmed.length === 0) {
      return { status: "recipe_failed", reason: "invalid_output: empty", stderr_tail: scrubbedStderr };
    }
    if (NULLISH_LITERALS.has(trimmed.toLowerCase())) {
      return { status: "recipe_failed", reason: `invalid_output: nullish ('${trimmed}')`, stderr_tail: scrubbedStderr };
    }
    if (trimmed.length > 4096) {
      return { status: "recipe_failed", reason: "invalid_output: too long", stderr_tail: scrubbedStderr };
    }
    const write = deps.store.writeBinding(parentID, args.binding_name, trimmed, target.type, "minted-recipe");
    if (write.status === "error") {
      return { status: "recipe_failed", reason: `register_failed: ${write.reason}`, stderr_tail: scrubbedStderr };
    }
    return { status: "ok" };
  };
}
export {
  makeExecuteRecipeHandler
};
