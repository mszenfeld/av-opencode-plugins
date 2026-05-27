import { validateRecipe } from "./recipe-validator.js";
const QA_BIND_RE = /^QA_BIND_[A-Z][A-Z0-9_]*$/;
const HEADER_RE = /^- `(QA_BIND_[A-Z][A-Z0-9_]*|[A-Z_][A-Z0-9_]*)` \((secret|plain)\)\s*[—-]\s*(.+)$/;
const INPUTS_RE = /^\s+- Inputs:\s+(.+)$/;
const EGRESS_RE = /^\s+- Egress:\s+`([^`]+)`\s*$/;
const RECIPE_HEADER_RE = /^\s+- Recipe:\s*$/;
function parseBindings(planText) {
  const lines = planText.split("\n");
  let setupStart = -1;
  for (let i2 = 0; i2 < lines.length; i2++) {
    if (/^##\s+Setup\s*$/.test(lines[i2])) {
      setupStart = i2 + 1;
      break;
    }
  }
  if (setupStart === -1) {
    return { status: "ok", bindings: [] };
  }
  let bindingsStart = -1;
  for (let i2 = setupStart; i2 < lines.length; i2++) {
    if (/^##\s+\S/.test(lines[i2])) break;
    if (/^\*\*Bindings:\*\*\s*$/.test(lines[i2])) {
      bindingsStart = i2 + 1;
      break;
    }
  }
  if (bindingsStart === -1) {
    return { status: "ok", bindings: [] };
  }
  const bindings = [];
  let i = bindingsStart;
  while (i < lines.length) {
    const line = lines[i];
    if (/^##\s+\S/.test(line) || /^\*\*[A-Z]/.test(line)) break;
    const headerMatch = line.match(HEADER_RE);
    if (headerMatch === null) {
      i++;
      continue;
    }
    const name = headerMatch[1];
    const typeRaw = headerMatch[2];
    const description = headerMatch[3];
    if (!QA_BIND_RE.test(name)) {
      return { status: "error", reason: `binding name '${name}' must match QA_BIND_[A-Z][A-Z0-9_]*` };
    }
    const type = typeRaw === "secret" ? "secret" : "plain";
    let inputs = null;
    let egress = null;
    let recipe = null;
    let j = i + 1;
    while (j < lines.length) {
      const sub = lines[j];
      if (HEADER_RE.test(sub) || /^##\s+\S/.test(sub) || /^\*\*[A-Z]/.test(sub)) break;
      const inputsMatch = sub.match(INPUTS_RE);
      if (inputsMatch !== null) {
        const list = inputsMatch[1];
        const names = [...list.matchAll(/\$([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);
        inputs = names;
        j++;
        continue;
      }
      const egressMatch = sub.match(EGRESS_RE);
      if (egressMatch !== null) {
        egress = egressMatch[1];
        j++;
        continue;
      }
      if (RECIPE_HEADER_RE.test(sub)) {
        let k = j + 1;
        while (k < lines.length && !/^\s*```bash\s*$/.test(lines[k])) k++;
        if (k >= lines.length) {
          return { status: "error", reason: `binding '${name}' missing recipe code block` };
        }
        const recipeStart = k + 1;
        let recipeEnd = recipeStart;
        while (recipeEnd < lines.length && !/^\s*```\s*$/.test(lines[recipeEnd])) recipeEnd++;
        const recipeLines = lines.slice(recipeStart, recipeEnd);
        const nonEmptyRecipeLines = recipeLines.filter((l) => l.trim().length > 0);
        const minIndent = nonEmptyRecipeLines.length === 0 ? 0 : Math.min(...nonEmptyRecipeLines.map((l) => /^[ \t]*/.exec(l)[0].length));
        recipe = recipeLines.map((l) => l.slice(minIndent)).join("\n").trim();
        j = recipeEnd + 1;
        continue;
      }
      j++;
    }
    if (inputs === null) {
      return { status: "error", reason: `binding '${name}' missing Inputs:` };
    }
    if (egress === null) {
      return { status: "error", reason: `binding '${name}' missing Egress:` };
    }
    if (recipe === null) {
      return { status: "error", reason: `binding '${name}' missing Recipe:` };
    }
    const inputSet = new Set(inputs);
    const referenced = new Set(
      [...recipe.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)].map((m) => m[1])
    );
    for (const ref of referenced) {
      if (!inputSet.has(ref)) {
        return {
          status: "error",
          reason: `binding '${name}' recipe references $${ref} which is not declared in Inputs`
        };
      }
    }
    const validation = validateRecipe(recipe, egress);
    if (validation.status !== "ok") {
      return { status: "error", reason: `binding '${name}': ${validation.reason}` };
    }
    bindings.push({
      name,
      type,
      description: description.trim(),
      inputs,
      egress,
      recipe
    });
    i = j;
  }
  return { status: "ok", bindings };
}
export {
  parseBindings,
  validateRecipe
};
