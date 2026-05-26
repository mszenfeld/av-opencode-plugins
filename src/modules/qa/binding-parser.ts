import type { BindingType } from "./bindings-store.js"
export type { BindingType }

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

// COMP-002: `awk` and `sed` were removed because both expose shell-exec
// primitives (`awk 'BEGIN{system(...)}'`, `sed 'e cmd'` / `sed '... W file'`)
// that the recipe regex cannot reliably constrain. Use `jq`/`cut`/`grep` for
// the same text-shaping needs. Do NOT re-add them without a sandbox redesign.
const ALLOWED_COMMANDS = new Set([
  "curl",
  "psql",
  "sqlite3",
  "jq",
  "grep",
  "cut",
  "head",
  "tail",
  "tr",
  "printf",
])

// Commands whose primary purpose is reading files. Recipes may pass a path
// argument to them, so we confine the accepted paths to `./*` relative paths,
// `-` (stdin), or `/dev/null`/`/dev/stdin`. Anything starting with `/` that
// isn't one of those allowlisted dev paths is rejected (SEC-005).
const FILE_READER_COMMANDS = new Set(["grep", "cut", "head", "tail", "tr"])

// Commands that take a DSN (or URL) as a positional argument and connect to
// an arbitrary host. The Egress check must apply to them too, not just curl
// (SEC-004).
const DSN_COMMANDS = new Set(["psql", "sqlite3"])

// Sqlite3 dot-commands that escape to shell (`.shell`, `.system`) or read
// arbitrary files (`.read`) — bypass any positional-arg validation by
// embedding the malicious action in the SQL initialiser (SEC-004).
const SQLITE_FORBIDDEN_DOT_COMMANDS = [".read", ".shell", ".system", ".import", ".save", ".output", ".log"]

// Maximum recipe length. Used to bound the work the validator's regex
// pipeline does on adversarial input (SEC-008). 16 KiB is roughly 4× the
// largest legitimate recipe we've seen in practice.
const MAX_RECIPE_BYTES = 16 * 1024

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
  // SEC-002: `--next` chains a second request whose URL bypasses the
  // single-URL extractCurlURL check. Refuse outright — recipes are
  // single-request by contract.
  { pattern: /(?:^|\s)--next(?:\s|$)/, label: "--next (chains additional request)" },
  // SEC-002: `--url` is an alternative way to specify a target URL. Allowing
  // it would require us to validate every flag-value pair against the egress
  // host. Simpler: forbid it; the bare positional URL is the canonical form.
  { pattern: /(?:^|\s)--url(?:\s|=)/, label: "--url (use bare URL argument)" },
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
  // Accept an optional scheme — any scheme://, not just http(s) — so DSN
  // strings like `postgres://...` or `mysql://...` are handled too (SEC-004).
  const m = urlOrTemplate.match(/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(\$\{?[A-Z_][A-Z0-9_]*\}?|[\w.-]+)/)
  if (m === null) return null
  const captured = m[1]
  return captured === undefined ? null : captured
}

// Identify a token that names a connection target (DSN or URL). Used to find
// the DSN argument inside a psql/sqlite3 invocation so we can apply the same
// egress-host check we do for curl (SEC-004).
function looksLikeDSN(token: string): boolean {
  const unquoted = token.replace(/^["']|["']$/g, "")
  // scheme://... (postgres, postgresql, mysql, sqlite, redis, …) or a $VAR
  // template that the caller will resolve to one.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(unquoted)) return true
  if (unquoted.startsWith("$")) return true
  return false
}

function extractDSNTarget(cmd: string): string | null {
  // Find the first non-flag token that looks like a DSN/URL/var. The leading
  // token (the command name itself) is skipped.
  const tokens = tokenizeShell(cmd)
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === undefined) continue
    if (t.startsWith("-")) continue
    if (looksLikeDSN(t)) {
      return t.replace(/^["']|["']$/g, "")
    }
  }
  return null
}

// Allowlist for file-reader path arguments (SEC-005). Anything starting with
// `/` that isn't one of these is rejected so a recipe can't `tail /etc/passwd`
// to exfiltrate host files.
const FILE_READER_ALLOWED_DEV_PATHS = new Set(["/dev/null", "/dev/stdin", "/dev/zero"])

function isAllowedFileReaderArg(token: string): boolean {
  const unquoted = token.replace(/^["']|["']$/g, "")
  // Flags (-n, -d:, --foo) are not paths.
  if (unquoted.startsWith("-") && unquoted !== "-") return true
  // Stdin sentinel.
  if (unquoted === "-") return true
  // Variable expansion — egress validation does not apply to file readers,
  // but we trust declared inputs (their values came from execute_recipe's
  // input resolution, which the user / parse_plan already authorised).
  if (unquoted.startsWith("$")) return true
  // Allowlisted device paths.
  if (FILE_READER_ALLOWED_DEV_PATHS.has(unquoted)) return true
  // Any other absolute path is rejected.
  if (unquoted.startsWith("/")) return false
  // Bare token without a leading `/` or `./` — assume it's a flag value
  // (e.g. `cut -d: -f1` has `-d:` then `-f1`) or a relative basename. Relative
  // basenames resolve in the recipe's CWD, which the QA plugin controls.
  return true
}

export function validateRecipe(recipe: string, egress: string): ValidateRecipeResult {
  // SEC-008: cap recipe length up-front. The validator runs a pipeline of
  // regexes over the input; a multi-kilobyte adversarial recipe could push
  // worst-case backtracking into the seconds. 16 KiB is comfortably above
  // every legitimate recipe shape we've seen.
  if (recipe.length > MAX_RECIPE_BYTES) {
    return {
      status: "error",
      reason: `recipe too long: ${recipe.length} bytes (max ${MAX_RECIPE_BYTES})`,
    }
  }

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
    // SEC-005: file-reader path confinement. Reject any absolute path
    // argument that isn't one of the allowlisted device paths so a recipe
    // can't `tail /etc/passwd` / `grep secret /var/log/...`.
    if (FILE_READER_COMMANDS.has(head)) {
      const tokens = tokenizeShell(cmd)
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i]
        if (t === undefined) continue
        if (!isAllowedFileReaderArg(t)) {
          return {
            status: "error",
            reason: `${head} cannot read absolute path '${t}' — restrict to ./ relative paths, '-', /dev/null, /dev/stdin`,
          }
        }
      }
    }
    // SEC-004: sqlite3 dot-commands escape SQL into shell or read arbitrary
    // files. Reject any token starting with `.read`/`.shell`/`.system`/etc.
    if (head === "sqlite3") {
      const tokens = tokenizeShell(cmd)
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i]
        if (t === undefined) continue
        const unquoted = t.replace(/^["']|["']$/g, "")
        for (const dot of SQLITE_FORBIDDEN_DOT_COMMANDS) {
          if (unquoted.startsWith(dot)) {
            return {
              status: "error",
              reason: `sqlite3 forbidden dot-command: ${dot}`,
            }
          }
        }
      }
    }
  }

  const egressHost = hostOfURL(egress)
  for (const cmd of cmds) {
    const head = firstWord(cmd)
    if (head === "curl") {
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
      continue
    }
    // SEC-004: psql/sqlite3 take a DSN as their connection target. Apply the
    // same egress check we apply to curl — otherwise a recipe can connect to
    // an attacker-controlled DSN and exfil via SQL.
    if (DSN_COMMANDS.has(head)) {
      const target = extractDSNTarget(cmd)
      if (target === null) {
        return {
          status: "error",
          reason: `${head} invocation without a connection target (DSN/path)`,
        }
      }
      const host = hostOfURL(target)
      if (host !== egressHost) {
        return {
          status: "error",
          reason: `${head} target host '${host ?? "?"}' does not match Egress '${egressHost ?? "?"}'`,
        }
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
        const recipeLines = lines.slice(recipeStart, recipeEnd)
        const nonEmptyRecipeLines = recipeLines.filter((l) => l.trim().length > 0)
        const minIndent =
          nonEmptyRecipeLines.length === 0
            ? 0
            : Math.min(...nonEmptyRecipeLines.map((l) => /^[ \t]*/.exec(l)![0].length))
        recipe = recipeLines.map((l) => l.slice(minIndent)).join("\n").trim()
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
