interface ControlledCommitInput {
    cwd: string;
    message: string;
    files?: string[];
    taskId?: string;
}
declare function createControlledCommit(input: ControlledCommitInput): Promise<{
    commitMessage: string;
    status: string;
}>;

export { type ControlledCommitInput, createControlledCommit };
