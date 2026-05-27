type ValidateRecipeResult = {
    status: "ok";
} | {
    status: "error";
    reason: string;
};
declare function validateRecipe(recipe: string, egress: string): ValidateRecipeResult;

export { type ValidateRecipeResult, validateRecipe };
