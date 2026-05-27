import { BindingType } from './bindings-store.js';
import './secret.js';

interface ParsedBinding {
    name: string;
    type: BindingType;
    description: string;
    inputs: string[];
    egress: string;
    recipe: string;
}
type ParseResult = {
    status: "ok";
    bindings: ParsedBinding[];
} | {
    status: "error";
    reason: string;
};
type ValidateRecipeResult = {
    status: "ok";
} | {
    status: "error";
    reason: string;
};
declare function validateRecipe(recipe: string, egress: string): ValidateRecipeResult;
/**
 * Parses the `## Setup → **Bindings:**` subsection of a QA plan markdown,
 * extracting declarative binding specs. Recipe AST validation (allowed
 * commands / shell metachars) lives in a downstream task; here we only:
 *
 *   - locate the `## Setup` section and its `**Bindings:**` subsection,
 *   - parse each binding header (`- \`NAME\` (secret|plain) — description`),
 *   - parse `Inputs:`, `Egress:`, and the fenced `Recipe:` bash block,
 *   - enforce that `name` matches `^QA_BIND_[A-Z][A-Z0-9_]*$`,
 *   - enforce that every `$VAR` referenced inside the recipe is declared
 *     in that binding's `Inputs:` list.
 *
 * Returns `{ status: "ok", bindings: [] }` when the plan has no Setup or no
 * Bindings subsection — both are valid states for plans that need no minted
 * bindings.
 */
declare function parseBindings(planText: string): ParseResult;

export { BindingType, type ParseResult, type ParsedBinding, type ValidateRecipeResult, parseBindings, validateRecipe };
