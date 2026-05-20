import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { normalizeCommitMessage } from "./message-policy.js"

const execFileAsync = promisify(execFile)

export interface ControlledCommitInput {
  cwd: string
  message: string
  files?: string[]
  taskId?: string
}

interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function runGit(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const result = await execFileAsync("git", args, { cwd })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    }
  } catch (error) {
    const failure = error as Error & {
      stdout?: string
      stderr?: string
      code?: number
    }

    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: Number(failure.code ?? 1),
    }
  }
}

export async function createControlledCommit(input: ControlledCommitInput) {
  const repoCheck = await runGit(input.cwd, ["rev-parse", "--is-inside-work-tree"])

  if (repoCheck.exitCode !== 0) {
    throw new Error("Current directory is not a git repository.")
  }

  const addArgs = input.files && input.files.length > 0
    ? ["add", "--", ...input.files]
    : ["add", "-A"]

  const addResult = await runGit(input.cwd, addArgs)

  if (addResult.exitCode !== 0) {
    throw new Error(addResult.stderr.trim() || addResult.stdout.trim() || "git add failed.")
  }

  const stagedChanges = await runGit(input.cwd, ["diff", "--cached", "--quiet"])

  if (stagedChanges.exitCode === 0) {
    throw new Error("No changes to commit.")
  }

  const commitMessage = normalizeCommitMessage(input.message, input.taskId)
  const commitResult = await runGit(input.cwd, ["commit", "-m", commitMessage])

  if (commitResult.exitCode !== 0) {
    throw new Error(
      commitResult.stderr.trim() || commitResult.stdout.trim() || "git commit failed.",
    )
  }

  const statusResult = await runGit(input.cwd, ["status", "--short"])

  return {
    commitMessage,
    status: statusResult.stdout.trim(),
  }
}
