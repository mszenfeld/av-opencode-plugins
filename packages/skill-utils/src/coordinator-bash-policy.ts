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
const COMPOUND = /(\|\||&&|;|\||`|\$\(|(?<![\w./-])(?:bash|sh|eval)\b)/

export interface BashClassification {
  allowed: boolean
  program: string | null
}

/** Decide whether a coordinator bash command is permitted (allowlist + no compounds). */
export function classifyCoordinatorBash(command: string, allowedPrograms: string[]): BashClassification {
  const trimmed = command.trim()
  if (COMPOUND.test(trimmed)) return { allowed: false, program: null }
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
  const subject = info.command ? `\`${info.command.split(/\s+/)[0]}\`` : info.skill ? `skill \`${info.skill}\`` : "that"
  return new Error(
    `${payload}\nThe coordinator may not run ${subject}. ` +
      `Dispatch Veles (planning) or Triglav (exploration) to inspect the repository instead.`,
  )
}
