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
