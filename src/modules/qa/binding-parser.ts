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

export type ValidateRecipeResult =
  | { status: "ok" }
  | { status: "error"; reason: string }

const ALLOWED_COMMANDS = new Set([
  "curl",
  "psql",
  "sqlite3",
  "jq",
  "sed",
  "awk",
  "grep",
  "cut",
  "head",
  "tail",
  "tr",
  "printf",
])

const FORBIDDEN_TOKENS: { pattern: RegExp; label: string }[] = [
  { pattern: /\$\(/, label: "$(...) command substitution" },
  { pattern: /`/, label: "backticks" },
  { pattern: /<<-?\s*\w+/, label: "heredoc" },
  { pattern: /<<</, label: "herestring" },
  { pattern: /<\(/, label: "process substitution <(" },
  { pattern: />\(/, label: "process substitution >(" },
  { pattern: /\beval\b/, label: "eval" },
  { pattern: /\bsource\b/, label: "source" },
  { pattern: /(?:^|\s)\.\s+\//, label: ". /path (dot-sourcing)" },
  { pattern: /\bexport\b/, label: "export" },
  { pattern: /\bunset\b/, label: "unset" },
  { pattern: /\b(declare|local|readonly|set)\s/, label: "declare/local/readonly/set" },
  { pattern: /\bfunction\s/, label: "function" },
]

const CURL_FORBIDDEN_FLAGS: { pattern: RegExp; label: string }[] = [
  { pattern: /(?:^|\s)(?:--upload-file|-T)(?:\s|=)/, label: "--upload-file/-T" },
  { pattern: /(?:^|\s)(?:--form|-F)\s+["']?@/, label: "--form/-F with @file" },
  {
    pattern: /(?:^|\s)(?:--data|--data-binary|--data-raw|-d)\s+["']?@/,
    label: "--data*/-d with @file",
  },
  { pattern: /(?:^|\s)(?:--config|-K)(?:\s|=)/, label: "--config/-K" },
  { pattern: /(?:^|\s)(?:--cookie-jar|-c)(?:\s|=)/, label: "--cookie-jar/-c" },
  {
    pattern: /(?:^|\s)(?:--dump-header|-D)\s+["']?(?!\/dev\/null\b)/,
    label: "--dump-header/-D to non-/dev/null",
  },
  { pattern: /(?:^|\s)--trace(?:-ascii|-config)?(?:\s|=)/, label: "--trace*" },
  {
    pattern: /(?:^|\s)(?:--output|-o)\s+["']?(?!\/dev\/null\b)/,
    label: "--output/-o to non-/dev/null",
  },
  { pattern: /(?:^|\s)-O(?:\s|$)/, label: "-O" },
  {
    pattern: /(?:^|\s)(?:--remote-name-all|-J|--remote-header-name)\b/,
    label: "remote-name flags",
  },
  { pattern: /(?:^|\s)(?:--write-out|-w)\s+["']?@/, label: "--write-out/-w with @file" },
]

function collapseLineContinuations(text: string): string {
  return text.replace(/\\\n\s*/g, " ")
}

function splitOnUnquotedSeparators(text: string): string[] {
  const out: string[] = []
  let current = ""
  let sq = false
  let dq = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === undefined) continue
    if (c === "'" && !dq) sq = !sq
    else if (c === '"' && !sq) dq = !dq

    if (!sq && !dq) {
      if (c === ";" || c === "\n") {
        out.push(current)
        current = ""
        continue
      }
      if ((c === "&" && text[i + 1] === "&") || (c === "|" && text[i + 1] === "|")) {
        out.push(current)
        current = ""
        i++
        continue
      }
    }
    current += c
  }
  if (current.trim().length > 0) out.push(current)
  return out.map((s) => s.trim()).filter((s) => s.length > 0)
}

function tokenizePipeline(text: string): string[] {
  const out: string[] = []
  let current = ""
  let sq = false
  let dq = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === undefined) continue
    if (c === "'" && !dq) sq = !sq
    else if (c === '"' && !sq) dq = !dq

    if (!sq && !dq && c === "|" && text[i + 1] !== "|" && text[i - 1] !== "|") {
      out.push(current)
      current = ""
      continue
    }
    current += c
  }
  if (current.trim().length > 0) out.push(current)
  return out.map((s) => s.trim())
}

function tokenizeShell(cmd: string): string[] {
  return cmd.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? []
}

function firstWord(cmd: string): string {
  const tokens = tokenizeShell(cmd)
  const head = tokens[0]
  return head === undefined ? "" : head
}

function looksLikeURL(token: string): boolean {
  const unquoted = token.replace(/^["']|["']$/g, "")
  return /:\/\//.test(unquoted) || unquoted.startsWith("$")
}

function extractCurlURL(cmd: string): string | null {
  const tokens = tokenizeShell(cmd)
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === undefined) continue
    if (t.startsWith("-")) continue
    if (looksLikeURL(t)) {
      return t.replace(/^["']|["']$/g, "")
    }
  }
  return null
}

function hostOfURL(urlOrTemplate: string): string | null {
  const m = urlOrTemplate.match(/^(?:https?:\/\/)?(\$\{?[A-Z_][A-Z0-9_]*\}?|[\w.-]+)/)
  if (m === null) return null
  const captured = m[1]
  return captured === undefined ? null : captured
}

export function validateRecipe(recipe: string, egress: string): ValidateRecipeResult {
  const collapsed = collapseLineContinuations(recipe)

  const statements = splitOnUnquotedSeparators(collapsed)
  if (statements.length !== 1) {
    return {
      status: "error",
      reason: `recipe must be a single statement; found ${statements.length}`,
    }
  }
  const stmt = statements[0]
  if (stmt === undefined) {
    return { status: "error", reason: "recipe is empty" }
  }

  for (const { pattern, label } of FORBIDDEN_TOKENS) {
    if (pattern.test(stmt)) {
      return { status: "error", reason: `recipe contains forbidden construct: ${label}` }
    }
  }

  if (/(?:^|\s)(?:>|>>|&>|2>>?)(?!\s*\/dev\/null\b)/.test(stmt)) {
    return { status: "error", reason: "recipe contains redirect to non-/dev/null path" }
  }

  if (/(?:^|\s)&\s*$/.test(stmt)) {
    return { status: "error", reason: "recipe contains & (background)" }
  }

  const cmds = tokenizePipeline(stmt)
  for (const cmd of cmds) {
    const head = firstWord(cmd)
    if (!ALLOWED_COMMANDS.has(head)) {
      return { status: "error", reason: `command '${head}' not in allowlist` }
    }
    if (head === "curl") {
      for (const { pattern, label } of CURL_FORBIDDEN_FLAGS) {
        if (pattern.test(" " + cmd + " ")) {
          return { status: "error", reason: `curl uses forbidden flag: ${label}` }
        }
      }
    }
  }

  const egressHost = hostOfURL(egress)
  for (const cmd of cmds) {
    if (firstWord(cmd) !== "curl") continue
    const url = extractCurlURL(cmd)
    if (url === null) {
      return { status: "error", reason: "curl invocation without a URL argument" }
    }
    const host = hostOfURL(url)
    if (host !== egressHost) {
      return {
        status: "error",
        reason: `curl URL host '${host ?? "?"}' does not match Egress '${egressHost ?? "?"}'`,
      }
    }
  }

  return { status: "ok" }
}

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

    const validation = validateRecipe(recipe, egress)
    if (validation.status !== "ok") {
      return { status: "error", reason: `binding '${name}': ${validation.reason}` }
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
