type BashPolicyDecision = "allow" | "block-direct-commit" | "block-push";
declare function classifyBashCommand(command: string): BashPolicyDecision;

export { type BashPolicyDecision, classifyBashCommand };
