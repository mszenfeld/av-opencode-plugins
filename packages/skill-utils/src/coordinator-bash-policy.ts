/** Parse `Bash(<prog>:*)` programs out of an agent's `allowed-tools` frontmatter line. */
export function parseAllowedBashPrograms(frontmatter: string): string[] {
  const out: string[] = []
  const re = /Bash\(([^:)]+):\*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(frontmatter)) !== null) {
    const prog = m[1]
    if (prog !== undefined) out.push(prog.trim())
  }
  return out
}

// Compound/escape forms a coordinator must never run inline. The shell-name tokens
// (bash/sh/eval) are anchored with a lookbehind so they only match a standalone
// program token, not a substring inside a path/filename like `./qa-preflight.sh`.
//
// Newline (`\n`), CR (`\r`), single `&` and redirection (`<`/`>`) are shell
// separators/operators just like `;` and `&&`. Without them, `ls\ngit log`,
// `ls & curl …`, `ls > /tmp/x` smuggle a forbidden command/redirect past the
// token[0]-only program check below (the parsed "program" is the harmless first
// token while the shell still runs the second statement). They MUST stay in the
// alternation; each has a reject test in coordinator-bash-policy.test.ts.
const COMPOUND = /(\|\||&&|;|\||&|[\r\n]|`|\$\(|<|>|(?<![\w./-])(?:bash|sh|eval)\b)/

/**
 * True when the command contains a compound separator/operator/redirect or a
 * shell wrapper (the same forms `classifyCoordinatorBash` rejects without a
 * single resolvable program token). Shared so the rejection classifier and the
 * violation-error subject agree on what "compound" means.
 */
export function isCompoundCommand(command: string): boolean {
  return COMPOUND.test(command.trim())
}

export interface BashClassification {
  allowed: boolean
  program: string | null
}

/** Decide whether a coordinator bash command is permitted (allowlist + no compounds). */
export function classifyCoordinatorBash(command: string, allowedPrograms: string[]): BashClassification {
  const trimmed = command.trim()
  if (isCompoundCommand(trimmed)) return { allowed: false, program: null }
  const program = trimmed.split(/\s+/)[0] ?? ""
  return { allowed: allowedPrograms.includes(program), program }
}

export interface ViolationInfo {
  tool: string
  command?: string
  skill?: string
  reason: string
}

/**
 * Build the rejection error. The message embeds a machine-readable marker + JSON
 * (so it surfaces in `info.error`, which the eval reads) and a human/LLM redirect (G).
 */
export function buildViolationError(info: ViolationInfo): Error {
  const payload = JSON.stringify({ marker: "COORDINATOR_POLICY_VIOLATION", ...info })
  // A multi-line/compound command has no single resolvable program, so naming
  // `command.split(/\s+/)[0]` (e.g. `ls` for `ls\ngit log`) would misname the
  // rejection. Use a stable label instead; only single-program commands get the
  // first token as their subject.
  const subject = info.command
    ? isCompoundCommand(info.command)
      ? "a compound command"
      : `\`${info.command.split(/\s+/)[0]}\``
    : info.skill
      ? `skill \`${info.skill}\``
      : "that"
  return new Error(
    `${payload}\nThe coordinator may not run ${subject}. ` +
      `Dispatch Veles (planning) or Triglav (exploration) to inspect the repository instead.`,
  )
}
