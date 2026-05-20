const COMMIT_HEADER =
  /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|release|security|i18n|config)(\([a-z0-9-]+\))?!?: .+$/i

const DISALLOWED_FOOTERS = [/^co-authored-by:/i]

export function normalizeCommitMessage(message: string, taskId?: string): string {
  const normalized = message.trim()

  if (!normalized) {
    throw new Error("Commit message cannot be empty.")
  }

  const lines = normalized.split(/\r?\n/)
  const header = lines[0] ?? ""

  if (!COMMIT_HEADER.test(header)) {
    throw new Error("Commit message must follow Conventional Commits.")
  }

  if (
    lines.some((line) =>
      DISALLOWED_FOOTERS.some((pattern) => pattern.test(line.trim())),
    )
  ) {
    throw new Error("Co-Authored-By footers are not allowed.")
  }

  if (!taskId) {
    return normalized
  }

  const refsFooter = `Refs: ${taskId}`

  if (lines.some((line) => line.trim() === refsFooter)) {
    return normalized
  }

  return `${normalized}\n\n${refsFooter}`
}
