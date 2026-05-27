const ALLOWED_COMMANDS = /* @__PURE__ */ new Set([
  "curl",
  "psql",
  "sqlite3",
  "jq",
  "grep",
  "cut",
  "head",
  "tail",
  "tr",
  "printf"
]);
const FILE_READER_COMMANDS = /* @__PURE__ */ new Set(["grep", "cut", "head", "tail", "tr"]);
const DSN_COMMANDS = /* @__PURE__ */ new Set(["psql", "sqlite3"]);
const SQLITE_FORBIDDEN_DOT_COMMANDS = [".read", ".shell", ".system", ".import", ".save", ".output", ".log"];
const MAX_RECIPE_BYTES = 16 * 1024;
const FORBIDDEN_TOKENS = [
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
  { pattern: /\bfunction\s/, label: "function" }
];
const CURL_FORBIDDEN_FLAGS = [
  { pattern: /(?:^|\s)(?:--upload-file|-T)(?:\s|=)/, label: "--upload-file/-T" },
  { pattern: /(?:^|\s)(?:--form|-F)\s+["']?@/, label: "--form/-F with @file" },
  {
    pattern: /(?:^|\s)(?:--data|--data-binary|--data-raw|-d)\s+["']?@/,
    label: "--data*/-d with @file"
  },
  { pattern: /(?:^|\s)(?:--config|-K)(?:\s|=)/, label: "--config/-K" },
  { pattern: /(?:^|\s)(?:--cookie-jar|-c)(?:\s|=)/, label: "--cookie-jar/-c" },
  {
    pattern: /(?:^|\s)(?:--dump-header|-D)\s+["']?(?!\/dev\/null\b)/,
    label: "--dump-header/-D to non-/dev/null"
  },
  { pattern: /(?:^|\s)--trace(?:-ascii|-config)?(?:\s|=)/, label: "--trace*" },
  {
    pattern: /(?:^|\s)(?:--output|-o)\s+["']?(?!\/dev\/null\b)/,
    label: "--output/-o to non-/dev/null"
  },
  { pattern: /(?:^|\s)-O(?:\s|$)/, label: "-O" },
  {
    pattern: /(?:^|\s)(?:--remote-name-all|-J|--remote-header-name)\b/,
    label: "remote-name flags"
  },
  { pattern: /(?:^|\s)(?:--write-out|-w)\s+["']?@/, label: "--write-out/-w with @file" },
  // SEC-002: `--next` chains a second request whose URL bypasses the
  // single-URL extractCurlURL check. Refuse outright — recipes are
  // single-request by contract.
  { pattern: /(?:^|\s)--next(?:\s|$)/, label: "--next (chains additional request)" },
  // SEC-002: `--url` is an alternative way to specify a target URL. Allowing
  // it would require us to validate every flag-value pair against the egress
  // host. Simpler: forbid it; the bare positional URL is the canonical form.
  { pattern: /(?:^|\s)--url(?:\s|=)/, label: "--url (use bare URL argument)" }
];
function collapseLineContinuations(text) {
  return text.replace(/\\\n\s*/g, " ");
}
function splitOnUnquotedSeparators(text) {
  const out = [];
  let current = "";
  let sq = false;
  let dq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === void 0) continue;
    if (c === "'" && !dq) sq = !sq;
    else if (c === '"' && !sq) dq = !dq;
    if (!sq && !dq) {
      if (c === ";" || c === "\n") {
        out.push(current);
        current = "";
        continue;
      }
      if (c === "&" && text[i + 1] === "&" || c === "|" && text[i + 1] === "|") {
        out.push(current);
        current = "";
        i++;
        continue;
      }
    }
    current += c;
  }
  if (current.trim().length > 0) out.push(current);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}
function tokenizePipeline(text) {
  const out = [];
  let current = "";
  let sq = false;
  let dq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === void 0) continue;
    if (c === "'" && !dq) sq = !sq;
    else if (c === '"' && !sq) dq = !dq;
    if (!sq && !dq && c === "|" && text[i + 1] !== "|" && text[i - 1] !== "|") {
      out.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim().length > 0) out.push(current);
  return out.map((s) => s.trim());
}
function tokenizeShell(cmd) {
  return cmd.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? [];
}
function firstWord(cmd) {
  const tokens = tokenizeShell(cmd);
  const head = tokens[0];
  return head === void 0 ? "" : head;
}
function looksLikeURL(token) {
  const unquoted = token.replace(/^["']|["']$/g, "");
  return /:\/\//.test(unquoted) || unquoted.startsWith("$");
}
function extractCurlURL(cmd) {
  const tokens = tokenizeShell(cmd);
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === void 0) continue;
    if (t.startsWith("-")) continue;
    if (looksLikeURL(t)) {
      return t.replace(/^["']|["']$/g, "");
    }
  }
  return null;
}
function hostOfURL(urlOrTemplate) {
  const m = urlOrTemplate.match(/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?(\$\{?[A-Z_][A-Z0-9_]*\}?|[\w.-]+)/);
  if (m === null) return null;
  const captured = m[1];
  return captured === void 0 ? null : captured;
}
function looksLikeDSN(token) {
  const unquoted = token.replace(/^["']|["']$/g, "");
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(unquoted)) return true;
  if (unquoted.startsWith("$")) return true;
  return false;
}
function extractDSNTarget(cmd) {
  const tokens = tokenizeShell(cmd);
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === void 0) continue;
    if (t.startsWith("-")) continue;
    if (looksLikeDSN(t)) {
      return t.replace(/^["']|["']$/g, "");
    }
  }
  return null;
}
const FILE_READER_ALLOWED_DEV_PATHS = /* @__PURE__ */ new Set(["/dev/null", "/dev/stdin", "/dev/zero"]);
function isAllowedFileReaderArg(token) {
  const unquoted = token.replace(/^["']|["']$/g, "");
  if (unquoted.startsWith("-") && unquoted !== "-") return true;
  if (unquoted === "-") return true;
  if (unquoted.startsWith("$")) return true;
  if (FILE_READER_ALLOWED_DEV_PATHS.has(unquoted)) return true;
  if (unquoted.startsWith("/")) return false;
  return true;
}
function validateRecipe(recipe, egress) {
  if (recipe.length > MAX_RECIPE_BYTES) {
    return {
      status: "error",
      reason: `recipe too long: ${recipe.length} bytes (max ${MAX_RECIPE_BYTES})`
    };
  }
  const collapsed = collapseLineContinuations(recipe);
  const statements = splitOnUnquotedSeparators(collapsed);
  if (statements.length !== 1) {
    return {
      status: "error",
      reason: `recipe must be a single statement; found ${statements.length}`
    };
  }
  const stmt = statements[0];
  if (stmt === void 0) {
    return { status: "error", reason: "recipe is empty" };
  }
  for (const { pattern, label } of FORBIDDEN_TOKENS) {
    if (pattern.test(stmt)) {
      return { status: "error", reason: `recipe contains forbidden construct: ${label}` };
    }
  }
  if (/(?:^|\s)(?:>|>>|&>|2>>?)(?!\s*\/dev\/null\b)/.test(stmt)) {
    return { status: "error", reason: "recipe contains redirect to non-/dev/null path" };
  }
  if (/(?:^|\s)&\s*$/.test(stmt)) {
    return { status: "error", reason: "recipe contains & (background)" };
  }
  const cmds = tokenizePipeline(stmt);
  for (const cmd of cmds) {
    const head = firstWord(cmd);
    if (!ALLOWED_COMMANDS.has(head)) {
      return { status: "error", reason: `command '${head}' not in allowlist` };
    }
    if (head === "curl") {
      for (const { pattern, label } of CURL_FORBIDDEN_FLAGS) {
        if (pattern.test(" " + cmd + " ")) {
          return { status: "error", reason: `curl uses forbidden flag: ${label}` };
        }
      }
    }
    if (FILE_READER_COMMANDS.has(head)) {
      const tokens = tokenizeShell(cmd);
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === void 0) continue;
        if (!isAllowedFileReaderArg(t)) {
          return {
            status: "error",
            reason: `${head} cannot read absolute path '${t}' \u2014 restrict to ./ relative paths, '-', /dev/null, /dev/stdin`
          };
        }
      }
    }
    if (head === "sqlite3") {
      const tokens = tokenizeShell(cmd);
      for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === void 0) continue;
        const unquoted = t.replace(/^["']|["']$/g, "");
        for (const dot of SQLITE_FORBIDDEN_DOT_COMMANDS) {
          if (unquoted.startsWith(dot)) {
            return {
              status: "error",
              reason: `sqlite3 forbidden dot-command: ${dot}`
            };
          }
        }
      }
    }
  }
  const egressHost = hostOfURL(egress);
  for (const cmd of cmds) {
    const head = firstWord(cmd);
    if (head === "curl") {
      const url = extractCurlURL(cmd);
      if (url === null) {
        return { status: "error", reason: "curl invocation without a URL argument" };
      }
      const host = hostOfURL(url);
      if (host !== egressHost) {
        return {
          status: "error",
          reason: `curl URL host '${host ?? "?"}' does not match Egress '${egressHost ?? "?"}'`
        };
      }
      continue;
    }
    if (DSN_COMMANDS.has(head)) {
      const target = extractDSNTarget(cmd);
      if (target === null) {
        return {
          status: "error",
          reason: `${head} invocation without a connection target (DSN/path)`
        };
      }
      const host = hostOfURL(target);
      if (host !== egressHost) {
        return {
          status: "error",
          reason: `${head} target host '${host ?? "?"}' does not match Egress '${egressHost ?? "?"}'`
        };
      }
    }
  }
  return { status: "ok" };
}
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
