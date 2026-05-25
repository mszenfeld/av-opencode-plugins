export type BindingType = "secret" | "plain"

export interface ParsedBinding {
  name: string
  type: BindingType
  description: string
  inputs: string[]
  egress: string
  recipe: string
}

export type ParseResult =
  | { status: "ok"; bindings: ParsedBinding[] }
  | { status: "error"; reason: string }

const QA_BIND_RE = /^QA_BIND_[A-Z][A-Z0-9_]*$/
const HEADER_RE = /^- `(QA_BIND_[A-Z][A-Z0-9_]*|[A-Z_][A-Z0-9_]*)` \((secret|plain)\)\s*[—-]\s*(.+)$/
const INPUTS_RE = /^\s+- Inputs:\s+(.+)$/
const EGRESS_RE = /^\s+- Egress:\s+`([^`]+)`\s*$/
const RECIPE_HEADER_RE = /^\s+- Recipe:\s*$/

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
export function parseBindings(planText: string): ParseResult {
  const lines = planText.split("\n")

  let setupStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Setup\s*$/.test(lines[i]!)) {
      setupStart = i + 1
      break
    }
  }
  if (setupStart === -1) {
    return { status: "ok", bindings: [] }
  }

  let bindingsStart = -1
  for (let i = setupStart; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i]!)) break
    if (/^\*\*Bindings:\*\*\s*$/.test(lines[i]!)) {
      bindingsStart = i + 1
      break
    }
  }
  if (bindingsStart === -1) {
    return { status: "ok", bindings: [] }
  }

  const bindings: ParsedBinding[] = []
  let i = bindingsStart
  while (i < lines.length) {
    const line = lines[i]!
    if (/^##\s+\S/.test(line) || /^\*\*[A-Z]/.test(line)) break

    const headerMatch = line.match(HEADER_RE)
    if (headerMatch === null) {
      i++
      continue
    }
    const name = headerMatch[1]!
    const typeRaw = headerMatch[2]!
    const description = headerMatch[3]!
    if (!QA_BIND_RE.test(name)) {
      return { status: "error", reason: `binding name '${name}' must match QA_BIND_[A-Z][A-Z0-9_]*` }
    }
    const type: BindingType = typeRaw === "secret" ? "secret" : "plain"

    let inputs: string[] | null = null
    let egress: string | null = null
    let recipe: string | null = null

    let j = i + 1
    while (j < lines.length) {
      const sub = lines[j]!
      if (HEADER_RE.test(sub) || /^##\s+\S/.test(sub) || /^\*\*[A-Z]/.test(sub)) break

      const inputsMatch = sub.match(INPUTS_RE)
      if (inputsMatch !== null) {
        const list = inputsMatch[1]!
        const names = [...list.matchAll(/\$([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]!)
        inputs = names
        j++
        continue
      }

      const egressMatch = sub.match(EGRESS_RE)
      if (egressMatch !== null) {
        egress = egressMatch[1]!
        j++
        continue
      }

      if (RECIPE_HEADER_RE.test(sub)) {
        let k = j + 1
        while (k < lines.length && !/^\s*```bash\s*$/.test(lines[k]!)) k++
        if (k >= lines.length) {
          return { status: "error", reason: `binding '${name}' missing recipe code block` }
        }
        const recipeStart = k + 1
        let recipeEnd = recipeStart
        while (recipeEnd < lines.length && !/^\s*```\s*$/.test(lines[recipeEnd]!)) recipeEnd++
        recipe = lines.slice(recipeStart, recipeEnd).map((l) => l.replace(/^    /, "")).join("\n").trim()
        j = recipeEnd + 1
        continue
      }

      j++
    }

    if (inputs === null) {
      return { status: "error", reason: `binding '${name}' missing Inputs:` }
    }
    if (egress === null) {
      return { status: "error", reason: `binding '${name}' missing Egress:` }
    }
    if (recipe === null) {
      return { status: "error", reason: `binding '${name}' missing Recipe:` }
    }

    const inputSet = new Set(inputs)
    const referenced = new Set(
      [...recipe.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)].map((m) => m[1]!),
    )
    for (const ref of referenced) {
      if (!inputSet.has(ref)) {
        return {
          status: "error",
          reason: `binding '${name}' recipe references $${ref} which is not declared in Inputs`,
        }
      }
    }

    bindings.push({
      name,
      type,
      description: description.trim(),
      inputs,
      egress,
      recipe,
    })
    i = j
  }

  return { status: "ok", bindings }
}
