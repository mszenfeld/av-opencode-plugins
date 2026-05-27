import { BindingsStore } from './bindings-store.js';
import { QaRunState } from './qa-run-state.js';
import './secret.js';
import './binding-parser.js';

interface BashResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
interface ExecuteRecipeDeps {
    store: BindingsStore;
    state: QaRunState;
    resolveParentID: (sessionID: string) => Promise<string | undefined>;
    runBash: (cmd: string, env: Record<string, string>) => Promise<BashResult>;
    processEnv: Record<string, string | undefined>;
}
interface ExecuteRecipeArgs {
    binding_name: string;
}
type ExecuteRecipeResult = {
    status: "ok";
} | {
    status: "need_info";
    missing: string[];
} | {
    status: "recipe_failed";
    reason: string;
    stderr_tail: string;
} | {
    status: "unknown_binding";
};
interface ExecuteRecipeContext {
    sessionID: string;
}
declare function makeExecuteRecipeHandler(deps: ExecuteRecipeDeps): (a: ExecuteRecipeArgs, c: ExecuteRecipeContext) => Promise<ExecuteRecipeResult>;

export { type BashResult, type ExecuteRecipeArgs, type ExecuteRecipeContext, type ExecuteRecipeDeps, type ExecuteRecipeResult, makeExecuteRecipeHandler };
