import { describe, expect, it } from "vitest"
import {
  createControlledCommit,
  type GitResult,
  type GitRunner,
} from "../../../src/modules/commit/controlled-commit.js"

interface FakeGitCall {
  cwd: string
  args: string[]
}

interface FakeGitOptions {
  responses?: Partial<Record<string, GitResult>>
  defaultResponse?: GitResult
}

function fakeGitRunner(options: FakeGitOptions = {}): {
  runGit: GitRunner
  calls: FakeGitCall[]
} {
  const calls: FakeGitCall[] = []
  const responses = options.responses ?? {}
  const defaultResponse: GitResult = options.defaultResponse ?? {
    stdout: "",
    stderr: "",
    exitCode: 0,
  }

  const runGit: GitRunner = async (cwd, args) => {
    calls.push({ cwd, args: [...args] })
    const key = args[0] ?? ""
    return responses[key] ?? defaultResponse
  }

  return { runGit, calls }
}

describe("createControlledCommit (unit, injected git runner)", () => {
  it("orchestrates rev-parse, add, diff, commit, status through the injected runner", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "[main abc] feat: add note\n", stderr: "", exitCode: 0 },
        status: { stdout: " M other.txt\n", stderr: "", exitCode: 0 },
      },
    })

    const result = await createControlledCommit({
      cwd: "/tmp/fake-repo",
      files: ["note.txt"],
      message: "feat: add note",
      runGit,
    })

    expect(result.commitMessage).toBe("feat: add note")
    expect(result.status).toBe("M other.txt")
    expect(calls.map((call) => call.args[0])).toEqual([
      "rev-parse",
      "add",
      "diff",
      "commit",
      "status",
    ])
    const commitCall = calls.find((call) => call.args[0] === "commit")
    expect(commitCall?.args).toEqual(["commit", "-m", "feat: add note"])
    const addCall = calls.find((call) => call.args[0] === "add")
    expect(addCall?.args).toEqual(["add", "--", "note.txt"])
  })

  it("uses git add -A when no files are provided", async () => {
    const { runGit, calls } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "", stderr: "", exitCode: 0 },
        status: { stdout: "", stderr: "", exitCode: 0 },
      },
    })

    await createControlledCommit({
      cwd: "/tmp/fake-repo",
      message: "chore: stage everything",
      runGit,
    })

    const addCall = calls.find((call) => call.args[0] === "add")
    expect(addCall?.args).toEqual(["add", "-A"])
  })

  it("throws when the cwd is not a git repository", async () => {
    const { runGit } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "", stderr: "not a repo", exitCode: 128 },
      },
    })

    await expect(
      createControlledCommit({
        cwd: "/tmp/not-a-repo",
        message: "feat: nope",
        runGit,
      }),
    ).rejects.toThrow(/not a git repository/i)
  })

  it("throws when there are no staged changes", async () => {
    const { runGit } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 0 },
      },
    })

    await expect(
      createControlledCommit({
        cwd: "/tmp/fake-repo",
        message: "chore: empty commit",
        runGit,
      }),
    ).rejects.toThrow(/no changes to commit/i)
  })

  it("surfaces commit failure stderr from the injected runner", async () => {
    const { runGit } = fakeGitRunner({
      responses: {
        "rev-parse": { stdout: "true\n", stderr: "", exitCode: 0 },
        add: { stdout: "", stderr: "", exitCode: 0 },
        diff: { stdout: "", stderr: "", exitCode: 1 },
        commit: { stdout: "", stderr: "blocked by hook\n", exitCode: 1 },
      },
    })

    await expect(
      createControlledCommit({
        cwd: "/tmp/fake-repo",
        files: ["note.txt"],
        message: "fix: trigger hook",
        runGit,
      }),
    ).rejects.toThrow(/blocked by hook/i)
  })
})
