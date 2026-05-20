interface GitResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
interface GitRunner {
    (cwd: string, args: string[]): Promise<GitResult>;
}
interface ControlledCommitInput {
    cwd: string;
    message: string;
    files?: string[];
    taskId?: string;
    runGit?: GitRunner;
}
declare const defaultGitRunner: GitRunner;
declare function createControlledCommit(input: ControlledCommitInput): Promise<{
    commitMessage: string;
    status: string;
}>;

export { type ControlledCommitInput, type GitResult, type GitRunner, createControlledCommit, defaultGitRunner };
