/**
 * `classifyBashCommand` is a workflow rail, NOT a security boundary.
 *
 * This module backstops the `/commit` flow (Conventional Commits, no
 * `Co-Authored-By` footers, no auto-push) by blocking the most common direct
 * shapes — `git commit …` and `git push …` — at the `tool.execute.before`
 * bash gate. It is defense-in-depth against a forgetful or weakly
 * prompt-injected agent; it is NOT a hardened control over shell execution.
 *
 * The classifier only matches the literal token `git`. Known bypasses it does
 * NOT catch (intentional — listed here so a future "hardening" PR does not
 * silently turn the rail into a fake boundary):
 *
 *   - Absolute paths: `/usr/bin/git commit -m x`
 *   - Shell wrappers: `bash -c "git commit -m x"`, `sh -c "..."`
 *   - Alternative front-ends: `hub commit`
 *   - Shell builtins: `command git commit`
 *   - Alias indirection (user-defined `g`, `gc`, etc.)
 *   - Command substitution: `$(echo git) commit`
 *   - Git plumbing subcommands: `commit-tree`, `fast-import`, `update-ref`
 *
 * Per project doctrine (`docs/plugins/coordinator.md` — "Security model —
 * code-enforced vs LLM-requested"): *"Treat code-enforced rules as the
 * security boundary. The LLM-requested rules are defense in depth — they
 * raise the cost of a successful prompt-injection escalation but are not the
 * last line of defense."*
 *
 * Real shell-execution boundaries (sandboxing, permission controls) live
 * outside this plugin. See `docs/plugins/commit.md` §"`classifyBashCommand`
 * is defense-in-depth, not a security boundary" for the canonical bypass
 * enumeration and rationale.
 */
export type BashPolicyDecision =
  | "allow"
  | "block-direct-commit"
  | "block-push"

const GIT_GLOBAL_OPTIONS_WITH_VALUES = new Set([
  "-C",
  "-c",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
])

function tokenizeShellCommand(command: string): string[] {
  const matches = command.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|&&|\|\||[;|()]|[^\s;|()]+/g)
  return matches ?? []
}

function normalizeToken(token: string | undefined): string {
  if (!token) {
    return ""
  }
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1)
  }
  return token.replace(/\\(.)/g, "$1")
}

function classifyGitSubcommand(command: string): BashPolicyDecision {
  const tokens = tokenizeShellCommand(command)

  for (let index = 0; index < tokens.length; index += 1) {
    if (normalizeToken(tokens[index]) !== "git") {
      continue
    }

    let subcommandIndex = index + 1

    while (subcommandIndex < tokens.length) {
      const token = tokens[subcommandIndex]

      if (!token) {
        break
      }

      if (!token.startsWith("-")) {
        break
      }

      subcommandIndex += 1

      if (
        GIT_GLOBAL_OPTIONS_WITH_VALUES.has(token) &&
        !token.includes("=") &&
        subcommandIndex < tokens.length
      ) {
        subcommandIndex += 1
      }
    }

    const subcommand = normalizeToken(tokens[subcommandIndex])

    if (subcommand === "push") {
      return "block-push"
    }

    if (subcommand === "commit") {
      return "block-direct-commit"
    }
  }

  return "allow"
}

export function classifyBashCommand(command: string): BashPolicyDecision {
  return classifyGitSubcommand(command.trim())
}
